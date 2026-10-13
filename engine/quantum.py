"""The live quantum state of one floor.

Each floor of the game owns a handful of qubits: one per moving platform, one
per sealed terminal qubit and one per door-lock lamp. This module keeps them
in a Qiskit ``Statevector`` and records everything the player does in a real
``QuantumCircuit``, so the circuit drawn in the side panel is exactly the
circuit that produced the platforms on screen.

    gate at a terminal     -> ``Lab.apply``    (Statevector.evolve)
    flashlight on a qubit  -> ``Lab.measure``  (Born-rule sample, then collapse)
    wrong door key         -> ``Lab.reset``
    how a floor starts     -> ``Lab.auto``     (gates the floor applies by itself,
                                                such as a pair that begins entangled)

Nothing here knows about the game's geometry. ``Lab.snapshot`` returns plain
JSON-ready data that the JavaScript side turns into platforms and charts.
"""

from __future__ import annotations

import numpy as np
from qiskit import QuantumCircuit
from qiskit.circuit.library import CXGate, HGate, XGate, YGate, ZGate
from qiskit.quantum_info import Operator, Statevector, partial_trace

EPS = 1e-9

# Gates a terminal may offer, with the number of qubits each acts on.
GATES = {"h": (HGate, 1), "x": (XGate, 1), "z": (ZGate, 1), "cx": (CXGate, 2)}
_PAULIS = {"x": XGate, "y": YGate, "z": ZGate}

# How a floor's starting states are prepared from |0>.
INIT_GATES = {"0": [], "1": ["x"], "+": ["h"], "-": ["x", "h"]}

_PROJECTORS = (Operator(np.diag([1.0, 0.0])), Operator(np.diag([0.0, 1.0])))

# How a measurement is described in the code listing.
MEASURED_BY = {
    "torch": "flashlight on",
    "lock": "the door lock read",
    "machine": "the machine measured",
    "box": "opening the box showed",
}


class Lab:
    """Qubits of one floor: live state plus the circuit that produced it."""

    def __init__(
        self, qubits: list[dict], seed: int | None = None, noise: dict | None = None, prep: list[dict] | None = None
    ):
        if not 1 <= len(qubits) <= 10:
            raise ValueError("a floor needs between 1 and 10 qubits")
        self.labels = [str(q["id"]) for q in qubits]
        self.init = [str(q.get("init", "0")) for q in qubits]
        self.n = len(qubits)
        self.rng = np.random.default_rng(seed)
        self.noise = {"p1": 0.0, "p2": 0.0}
        self.state = Statevector.from_label("0" * self.n)
        self.circuit = QuantumCircuit(self.n, self.n)
        # One entry per instruction in ``self.circuit``, in the same order.
        self.meta: list[dict] = []
        for q, init in enumerate(self.init):
            if init not in INIT_GATES:
                raise ValueError(f"unknown starting state {init!r}")
            for name in INIT_GATES[init]:
                self._gate(name, [q], kind="init")
        self.auto(prep or [])
        self.set_noise(noise)

    # -- configuration ----------------------------------------------------

    def set_noise(self, noise: dict | None) -> None:
        """Error chance per one-qubit (p1) and two-qubit (p2) gate, 0 = ideal."""
        noise = noise or {}
        self.noise = {
            "p1": float(min(max(noise.get("p1", 0.0), 0.0), 0.5)),
            "p2": float(min(max(noise.get("p2", 0.0), 0.0), 0.5)),
        }

    # -- operations -------------------------------------------------------

    def _check(self, qubits: list[int]) -> list[int]:
        qubits = [int(q) for q in qubits]
        if len(set(qubits)) != len(qubits) or any(not 0 <= q < self.n for q in qubits):
            raise ValueError(f"bad qubits {qubits}")
        return qubits

    def _gate(self, name: str, qubits: list[int], kind: str, **extra) -> None:
        cls = _PAULIS[name] if kind == "noise" else GATES[name][0]
        gate = cls()
        self.state = self.state.evolve(gate, qubits)
        self.circuit.append(gate, qubits)
        self.meta.append({"kind": kind, "gate": name, "qubits": list(qubits), **extra})

    def _valid(self, gate: str, qubits: list[int]) -> tuple[str, list[int]]:
        gate = str(gate).lower()
        if gate not in GATES:
            raise ValueError(f"unknown gate {gate!r}")
        qubits = self._check(qubits)
        if len(qubits) != GATES[gate][1]:
            raise ValueError(f"{gate} acts on {GATES[gate][1]} qubit(s)")
        return gate, qubits

    def auto(self, ops: list[dict]) -> None:
        """Gates the floor applies by itself: a starting entanglement, a lock's own check.

        They are exact (no noise) and are not counted as the player's gates.
        """
        for op in ops:
            gate, qubits = self._valid(op["gate"], op["qubits"])
            self._gate(gate, qubits, kind="auto")

    def apply(self, gate: str, qubits: list[int]) -> dict | None:
        """Apply a gate chosen at a terminal. Returns the noise event, if one fired.

        Noise is a one-shot quantum-trajectory model: after the gate, with the
        calibrated error chance, one random Pauli hits one of the gate's qubits.
        """
        gate, qubits = self._valid(gate, qubits)
        self._gate(gate, qubits, kind="gate")
        chance = self.noise["p2"] if len(qubits) == 2 else self.noise["p1"]
        if chance > 0 and self.rng.random() < chance:
            victim = int(qubits[int(self.rng.integers(len(qubits)))])
            pauli = "xyz"[int(self.rng.integers(3))]
            self._gate(pauli, [victim], kind="noise")
            return {"qubit": victim, "label": self.labels[victim], "pauli": pauli, "after": gate}
        return None

    def p_one(self, qubit: int) -> float:
        """Probability that measuring ``qubit`` gives 1."""
        return float(self.state.probabilities([qubit])[1])

    def _collapse(self, qubit: int, outcome: int) -> None:
        projected = self.state.evolve(_PROJECTORS[outcome], [qubit])
        norm = float(np.linalg.norm(projected.data))
        if norm < EPS:
            raise ValueError("cannot collapse onto an outcome with zero probability")
        self.state = Statevector(projected.data / norm, dims=self.state.dims())

    def measure(self, qubit: int, force: bool = False, by: str = "torch") -> dict | None:
        """Measure one qubit in the computational basis and collapse the state.

        A qubit that is already definite is left alone (no instruction is
        added) unless ``force`` is set, which locks and machines use so that
        their read-out shows up on the circuit. ``by`` records what did the
        measuring: "torch", "lock", "machine" or "box".
        """
        (qubit,) = self._check([qubit])
        p1 = self.p_one(qubit)
        definite = p1 < EPS or p1 > 1 - EPS
        if definite and not force:
            return None
        outcome = int(p1 > 0.5) if definite else int(self.rng.random() < p1)
        self._collapse(qubit, outcome)
        self.circuit.measure(qubit, qubit)
        self.meta.append({"kind": "measure", "gate": "measure", "qubits": [qubit], "result": outcome, "p1": p1, "by": by})
        return {"qubit": qubit, "label": self.labels[qubit], "result": outcome, "p1": p1, "random": not definite, "by": by}

    def reset(self, qubit: int) -> None:
        """Return one qubit to |0> (measure it, then flip it back if it read 1)."""
        (qubit,) = self._check([qubit])
        p1 = self.p_one(qubit)
        outcome = int(self.rng.random() < p1) if EPS < p1 < 1 - EPS else int(p1 > 0.5)
        self._collapse(qubit, outcome)
        if outcome:
            self.state = self.state.evolve(XGate(), [qubit])
        self.circuit.reset(qubit)
        self.meta.append({"kind": "reset", "gate": "reset", "qubits": [qubit]})

    # -- read-outs --------------------------------------------------------

    def _reduced(self) -> list[dict]:
        """Bloch vector and purity of every single qubit."""
        out = []
        for q in range(self.n):
            rho = partial_trace(self.state, [k for k in range(self.n) if k != q]).data
            out.append(
                {
                    "x": float(2 * rho[0, 1].real),
                    "y": float(2 * rho[1, 0].imag),
                    "z": float((rho[0, 0] - rho[1, 1]).real),
                    "purity": float(np.trace(rho @ rho).real),
                }
            )
        return out

    def _groups(self, reduced: list[dict]) -> list[list[int]]:
        """Sets of qubits that are entangled with one another.

        The register as a whole is in a pure state, so a set of qubits has a
        state of its own exactly when its reduced state is pure. A qubit that is
        mixed on its own (purity < 1) is entangled with something: its group is
        the smallest set containing it whose reduced state is pure again.
        """
        from itertools import combinations

        def is_pure(subset: tuple[int, ...]) -> bool:
            if len(subset) == self.n:
                return True
            rest = [k for k in range(self.n) if k not in subset]
            return abs(partial_trace(self.state, rest).purity() - 1) < 1e-7

        left = [q for q in range(self.n) if reduced[q]["purity"] < 1 - 1e-7]
        groups = []
        while left:
            first, others = left[0], left[1:]
            group = tuple(left)
            for size in range(1, len(others)):
                found = next((c for c in combinations(others, size) if is_pure((first, *c))), None)
                if found:
                    group = (first, *found)
                    break
            groups.append(sorted(group))
            left = [q for q in left if q not in group]
        return sorted(groups)

    def _joint(self, group: list[int]) -> list[dict]:
        """Outcome probabilities of a group. ``bits[k]`` is the value of ``group[k]``."""
        probs = self.state.probabilities(group)
        rows = []
        for index, p in enumerate(probs):
            if p > 1e-9:
                bits = "".join(str((index >> k) & 1) for k in range(len(group)))
                rows.append({"bits": bits, "p": float(p)})
        return sorted(rows, key=lambda r: (-round(r["p"], 9), r["bits"]))

    def ops(self) -> list[dict]:
        """Everything done since the floor started, for the circuit drawing."""
        out = []
        for m in self.meta:
            if m["kind"] == "init":
                continue
            op = {"kind": m["kind"], "gate": m["gate"], "qubits": m["qubits"]}
            if m["kind"] == "measure":
                op["result"] = m["result"]
                op["by"] = m["by"]
            out.append(op)
        return out

    def code(self) -> str:
        """The floor's circuit as Qiskit code a player can paste and run."""
        names = ", ".join(f"{i}={label}" for i, label in enumerate(self.labels))
        lines = [
            "from qiskit import QuantumCircuit",
            "",
            f"# qubits: {names}",
            f"qc = QuantumCircuit({self.n}, {self.n})",
        ]
        for m in self.meta:
            q = m["qubits"]
            label = self.labels[q[-1]]
            if m["kind"] == "measure":
                lines.append(f"qc.measure({q[0]}, {q[0]})  # {MEASURED_BY.get(m['by'], m['by'])} {label}: read {m['result']}")
            elif m["kind"] == "reset":
                lines.append(f"qc.reset({q[0]})  # {label} cleared to 0")
            else:
                call = f"qc.{m['gate']}({', '.join(str(i) for i in q)})"
                if m["kind"] == "init":
                    call += f"  # {label} starts in |{self.init[q[0]]}>"
                elif m["kind"] == "noise":
                    call += f"  # hardware noise hit {label}"
                elif m["kind"] == "auto":
                    call += "  # done by the floor itself"
                lines.append(call)
        return "\n".join(lines)

    def snapshot(self) -> dict:
        """Everything the game needs to draw this floor's quantum state."""
        reduced = self._reduced()
        p1 = [min(max((1 - r["z"]) / 2, 0.0), 1.0) for r in reduced]
        definite = [0 if p < EPS * 1e3 else 1 if p > 1 - EPS * 1e3 else None for p in p1]
        groups = self._groups(reduced)
        player_ops = [m for m in self.meta if m["kind"] == "gate"]
        return {
            "labels": self.labels,
            "init": self.init,
            "p1": [0.0 if d == 0 else 1.0 if d == 1 else p for p, d in zip(p1, definite)],
            "definite": definite,
            "bloch": [[round(r["x"], 6), round(r["y"], 6), round(r["z"], 6)] for r in reduced],
            "purity": [round(r["purity"], 6) for r in reduced],
            "groups": groups,
            "joint": [{"qubits": g, "dist": self._joint(g)} for g in groups],
            "ops": self.ops(),
            "code": self.code(),
            "stats": {
                "gates": len(player_ops),
                "measurements": sum(1 for m in self.meta if m["kind"] == "measure"),
                "noise": sum(1 for m in self.meta if m["kind"] == "noise"),
                "depth": int(self.circuit.depth()),
            },
        }
