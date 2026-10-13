"""The one job this game sends to the quantum computer picked in "Select QPU".

When the lab powers up, the chosen backend runs a self-test: the same five
small experiments the player is about to do by hand, side by side in ONE
circuit (IonQ backends on Qollab accept one job per run).

    qubit 0      X                 a certain flip           -> should read 1
    qubit 1      H, Z, H           interference (HZH = X)   -> should read 1
    qubit 2      H                 superposition            -> 50 / 50
    qubits 3-4   H, CX             Bell pair                -> always agree
    qubits 5-7   H, CX, CX         three-way GHZ state      -> all agree

On an ideal simulator the four "should" lines hold on every shot. On a noise
model or on hardware they do not, and how often they fail becomes the error
chance of every gate the player applies for the rest of the run
(``Lab.apply``). The machine you pick decides how the game's physics behaves.

The error chances are rough: they lump gate error and read-out error together.
They are meant to make noise something a player can see, not to benchmark a
device.
"""

from __future__ import annotations

import time
from typing import Any

from qiskit import QuantumCircuit, transpile

N_QUBITS = 8
DEFAULT_SHOTS = 200
MAX_SHOTS = 2000
# Ceilings that keep a very noisy backend playable.
MAX_P1 = 0.05
MAX_P2 = 0.10

IONQ_GATES = {"h", "x", "z", "cx", "measure"}  # all native "QIS" gates on IonQ
_NOT_GATES = {"measure", "reset", "delay", "barrier", "if_else", "while_loop", "for_loop", "switch_case"}


def build_circuit() -> QuantumCircuit:
    """The self-test circuit: 8 qubits, every one measured at the end."""
    qc = QuantumCircuit(N_QUBITS, N_QUBITS, name="blackout_lab_self_test")
    qc.x(0)
    qc.h(1)
    qc.z(1)
    qc.h(1)
    qc.h(2)
    qc.h(3)
    qc.cx(3, 4)
    qc.h(5)
    qc.cx(5, 6)
    qc.cx(6, 7)
    qc.measure(range(N_QUBITS), range(N_QUBITS))
    return qc


def backend_name(backend: Any) -> str:
    """Backend name whether ``name`` is an attribute (V2) or a method (V1)."""
    try:
        name = getattr(backend, "name", None)
        if callable(name):
            name = name()
        return str(name) if name else type(backend).__name__
    except Exception:  # noqa: BLE001
        return "backend"


def is_ionq(backend: Any) -> bool:
    return type(backend).__module__.startswith("qiskit_ionq") or "ionq" in backend_name(backend).lower()


def _trim(circuit: QuantumCircuit, n: int) -> QuantumCircuit:
    """Drop idle device qubits when the compiled circuit stayed on the first ``n``.

    Compiling for a 156-qubit device model gives a 156-qubit circuit; this
    keeps the simulation at the 8 qubits that are actually used.
    """
    if circuit.num_qubits <= n:
        return circuit
    out = QuantumCircuit(n, circuit.num_clbits, name=circuit.name)
    for inst in circuit.data:
        qubits = [circuit.find_bit(q).index for q in inst.qubits]
        if any(q >= n for q in qubits):
            return circuit
        clbits = [circuit.find_bit(c).index for c in inst.clbits]
        out.append(inst.operation, qubits, clbits)
    return out


def compile_for(backend: Any, circuit: QuantumCircuit) -> QuantumCircuit:
    """Compile the self-test for ``backend`` without ever failing the run."""
    if is_ionq(backend):
        # h, x, z and cx are accepted as-is and IonQ compiles them itself.
        return circuit
    n = circuit.num_qubits
    try:
        compiled = transpile(
            circuit, backend=backend, optimization_level=1, initial_layout=list(range(n)), seed_transpiler=7
        )
        return _trim(compiled, n)
    except Exception:  # noqa: BLE001
        pass
    try:
        names = [g for g in (getattr(backend, "operation_names", None) or []) if g not in _NOT_GATES]
        if names:
            return transpile(circuit, basis_gates=names, optimization_level=1, seed_transpiler=7)
    except Exception:  # noqa: BLE001
        pass
    return circuit


def _settle(value: Any) -> Any:
    """Wait for ``value`` if the runtime handed back a JavaScript promise."""
    if hasattr(value, "then") and not hasattr(value, "result") and not hasattr(value, "get_counts"):
        from pyodide.ffi import run_sync  # only reachable inside Qollab's browser runtime

        return run_sync(value)
    return value


def _bit_rows(counts: Any) -> list[tuple[list[int], int]]:
    """Counts as (bits, shots) rows, ``bits[i]`` being the value of qubit ``i``."""
    if hasattr(counts, "to_py"):
        counts = counts.to_py()
    rows = []
    for key, value in dict(counts).items():
        key = str(key).replace(" ", "")
        if key.lower().startswith("0x"):
            key = format(int(key, 16), "b")
        key = key.zfill(N_QUBITS)[-N_QUBITS:]
        rows.append(([int(ch) for ch in reversed(key)], int(round(float(value)))))
    return rows


def analyse(counts: Any) -> dict:
    """Turn the self-test counts into pass rates and per-gate error chances."""
    rows = _bit_rows(counts)
    shots = sum(v for _, v in rows)
    if shots <= 0:
        raise ValueError("the backend returned no shots")

    def share(test) -> float:
        return sum(v for bits, v in rows if test(bits)) / shots

    x_ok = share(lambda b: b[0] == 1)
    interference_ok = share(lambda b: b[1] == 1)
    plus_one = share(lambda b: b[2] == 1)
    bell_agree = share(lambda b: b[3] == b[4])
    ghz_agree = share(lambda b: b[5] == b[6] == b[7])
    p1 = min(((1 - x_ok) + (1 - interference_ok)) / 2, MAX_P1)
    p2 = min(1 - bell_agree, MAX_P2)
    return {
        "shots": shots,
        "x_ok": x_ok,
        "interference_ok": interference_ok,
        "plus_one": plus_one,
        "bell_agree": bell_agree,
        "ghz_agree": ghz_agree,
        "p1": p1,
        "p2": p2,
        "ideal": p1 == 0 and p2 == 0 and ghz_agree == 1,
    }


def run(backend: Any, shots: int = DEFAULT_SHOTS) -> dict:
    """Send the self-test as a single job and return its analysis."""
    shots = int(min(max(int(shots), 20), MAX_SHOTS))
    started = time.time()
    circuit = compile_for(backend, build_circuit())
    job = _settle(backend.run(circuit, shots=shots))  # the ONLY backend.run of a run
    result = _settle(job.result())
    report = analyse(_settle(result.get_counts()))
    report.update(
        backend=backend_name(backend),
        requested_shots=shots,
        seconds=round(time.time() - started, 2),
        compiled_qubits=int(circuit.num_qubits),
        compiled_depth=int(circuit.depth()),
    )
    return report
