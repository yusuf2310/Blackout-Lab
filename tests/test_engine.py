"""Engine tests: run with ``python -m pytest`` from the project root."""

import json

import numpy as np
import pytest
from qiskit import QuantumCircuit
from qiskit.providers.basic_provider import BasicSimulator
from qiskit.providers.fake_provider import GenericBackendV2
from qiskit.quantum_info import Statevector, random_statevector

from engine import bridge, calibrate
from engine.quantum import Lab


def lab(*inits, seed=1, noise=None):
    names = "ABCDEFGH"
    return Lab([{"id": names[i], "init": s} for i, s in enumerate(inits)], seed=seed, noise=noise)


def test_starting_states():
    snap = lab("0", "1", "+", "-").snapshot()
    assert snap["definite"] == [0, 1, None, None]
    assert snap["p1"] == pytest.approx([0, 1, 0.5, 0.5])
    assert snap["bloch"][2][0] == pytest.approx(1) and snap["bloch"][3][0] == pytest.approx(-1)
    assert snap["ops"] == [] and snap["groups"] == []


def test_hadamard_then_torch_is_a_fair_coin():
    ones = 0
    for seed in range(400):
        q = lab("0", seed=seed)
        q.apply("h", [0])
        assert q.snapshot()["definite"] == [None]
        event = q.measure(0)
        assert event["random"] and event["p1"] == pytest.approx(0.5)
        assert q.snapshot()["definite"] == [event["result"]]
        ones += event["result"]
    assert 160 < ones < 240


def test_measuring_a_definite_qubit_adds_nothing_unless_forced():
    q = lab("1")
    assert q.measure(0) is None and q.snapshot()["ops"] == []
    assert q.measure(0, force=True)["result"] == 1
    assert [op["gate"] for op in q.snapshot()["ops"]] == ["measure"]


def test_interference_h_h_and_h_z_h():
    q = lab("0", "0", "-")
    q.apply("h", [0])
    q.apply("h", [0])
    q.apply("h", [1])
    q.apply("z", [1])
    assert q.snapshot()["p1"][1] == pytest.approx(0.5)  # Z leaves the odds untouched
    q.apply("h", [1])
    q.apply("h", [2])
    assert q.snapshot()["definite"] == [0, 1, 1]


def test_bell_pair_collapses_together():
    for seed in range(40):
        q = lab("0", "0", "0", seed=seed)
        q.apply("h", [0])
        q.apply("cx", [0, 1])
        snap = q.snapshot()
        assert snap["groups"] == [[0, 1]] and snap["definite"] == [None, None, 0]
        assert snap["joint"][0]["dist"] == [{"bits": "00", "p": pytest.approx(0.5)}, {"bits": "11", "p": pytest.approx(0.5)}]
        result = q.measure(1)["result"]
        snap = q.snapshot()
        assert snap["definite"] == [result, result, 0] and snap["groups"] == []


def test_anticorrelated_pair_and_ghz():
    q = lab("0", "0", "1", "0", seed=5)
    q.apply("h", [0])
    for target in (1, 2, 3):
        q.apply("cx", [0, target])
    snap = q.snapshot()
    assert snap["groups"] == [[0, 1, 2, 3]]
    assert {row["bits"] for row in snap["joint"][0]["dist"]} == {"0010", "1101"}
    result = q.measure(3)["result"]
    assert q.snapshot()["definite"] == [result, result, 1 - result, result]


def test_two_separate_entangled_groups():
    q = lab("0", "0", "0", "0")
    q.apply("h", [0])
    q.apply("cx", [0, 2])
    q.apply("h", [1])
    q.apply("cx", [1, 3])
    assert q.snapshot()["groups"] == [[0, 2], [1, 3]]


def test_reset_clears_a_lock_lamp():
    q = lab("0", "0", seed=3)
    q.apply("x", [0])
    q.apply("cx", [0, 1])
    q.reset(1)
    snap = q.snapshot()
    assert snap["definite"] == [1, 0] and snap["ops"][-1]["gate"] == "reset"


def test_circuit_history_reproduces_the_state():
    q = lab("+", "1", "0")
    q.apply("z", [0])
    q.apply("cx", [0, 2])
    q.apply("h", [1])
    assert Statevector(q.circuit).equiv(q.state)
    scope: dict = {}
    exec(q.code(), scope)  # the code shown to the player builds the same circuit
    assert isinstance(scope["qc"], QuantumCircuit) and Statevector(scope["qc"]).equiv(q.state)


def test_code_listing_marks_measurements_and_noise():
    q = lab("0", seed=2, noise={"p1": 0.5, "p2": 0})
    fired = [q.apply("x", [0]) for _ in range(40)]
    assert 8 < sum(1 for f in fired if f) < 32
    q.apply("h", [0])
    q.measure(0)
    code = q.code()
    assert "hardware noise hit A" in code and "qc.measure(0, 0)" in code
    snap = q.snapshot()
    assert snap["stats"]["gates"] == 41 and snap["stats"]["noise"] == sum(1 for f in fired if f) + sum(
        1 for op in snap["ops"][-3:] if op["kind"] == "noise"
    )


def test_bad_requests_are_rejected():
    q = lab("0", "0")
    with pytest.raises(ValueError):
        q.apply("cx", [0, 0])
    with pytest.raises(ValueError):
        q.apply("t", [0])
    with pytest.raises(ValueError):
        q.apply("h", [5])


# -- the single backend job ---------------------------------------------------


def test_self_test_is_perfect_on_an_ideal_simulator():
    report = calibrate.run(BasicSimulator(), shots=300)
    assert report["ideal"] and report["p1"] == 0 and report["p2"] == 0
    assert report["x_ok"] == 1 and report["interference_ok"] == 1 and report["bell_agree"] == 1 and report["ghz_agree"] == 1
    assert 0.35 < report["plus_one"] < 0.65 and report["shots"] == 300


def test_self_test_compiles_small_for_a_big_device():
    backend = GenericBackendV2(num_qubits=27, seed=11)
    compiled = calibrate.compile_for(backend, calibrate.build_circuit())
    assert compiled.num_qubits == 8
    report = calibrate.run(backend, shots=200)
    assert report["shots"] == 200 and 0 <= report["p2"] <= calibrate.MAX_P2


def test_analyse_reads_noise_and_key_formats():
    # qubit order in a key is right-to-left: this key has q0=1 q1=1 q3=q4 q5=q6=q7
    good = "00000011"
    assert calibrate.analyse({good: 100})["ideal"]
    noisy = calibrate.analyse({good: 90, "00000010": 4, "00010011": 6})  # 4 failed X flips, 6 broken Bell pairs
    assert noisy["x_ok"] == pytest.approx(0.96) and noisy["bell_agree"] == pytest.approx(0.94)
    assert noisy["p1"] == pytest.approx(0.02) and noisy["p2"] == pytest.approx(0.06) and not noisy["ideal"]
    assert calibrate.analyse({"0x3": 10})["ideal"] and calibrate.analyse({"0000 0011": 10})["ideal"]


class SpyBackend(BasicSimulator):
    runs = 0

    def run(self, *args, **kwargs):
        SpyBackend.runs += 1
        return super().run(*args, **kwargs)


def test_bridge_round_trip_and_one_job_per_run():
    bridge._calibration = None
    SpyBackend.runs = 0
    spy = SpyBackend()
    first = json.loads(bridge.calibrate(spy, 100))
    again = json.loads(bridge.calibrate(spy, 100))
    assert first["ok"] and again["ok"] and SpyBackend.runs == 1

    state = json.loads(bridge.load_level(json.dumps({"qubits": [{"id": "Q", "init": "0"}, {"id": "A", "init": "0"}], "seed": 4})))
    assert state["ok"] and state["state"]["labels"] == ["Q", "A"]
    json.loads(bridge.apply_gate(json.dumps({"gate": "h", "qubits": [0]})))
    out = json.loads(bridge.apply_gate(json.dumps({"gate": "cx", "qubits": [0, 1]})))
    assert out["state"]["groups"] == [[0, 1]] and out["glitch"] is None
    seen = json.loads(bridge.measure(json.dumps({"qubits": [1, 0]})))
    assert len(seen["measured"]) == 1  # the partner is already definite by the time it is asked
    bad = json.loads(bridge.apply_gate(json.dumps({"gate": "nope", "qubits": [0]})))
    assert bad["ok"] is False and "unknown gate" in bad["error"]
    assert json.loads(bridge.info())["qiskit"]


def test_a_failed_job_is_not_retried():
    class Broken:
        name = "broken"
        calls = 0

        def run(self, *a, **k):
            Broken.calls += 1
            raise ConnectionError("queue is down")

    bridge._calibration = None
    broken = Broken()
    assert json.loads(bridge.calibrate(broken, 50))["ok"] is False
    assert json.loads(bridge.calibrate(broken, 50))["ok"] is False
    assert Broken.calls == 1
    bridge._calibration = None


def test_noise_follows_the_calibration_switch():
    bridge._calibration = None
    bridge._noise.update(p1=0.03, p2=0.07)
    json.loads(bridge.load_level(json.dumps({"qubits": [{"id": "A", "init": "0"}]})))
    assert bridge._lab.noise == {"p1": 0.03, "p2": 0.07}
    assert json.loads(bridge.set_noise(json.dumps({"enabled": False})))["noise"] == {"p1": 0.0, "p2": 0.0}
    assert bridge._lab.noise == {"p1": 0.0, "p2": 0.0}
    bridge.set_noise(json.dumps({"enabled": True}))
    bridge._noise.update(p1=0.0, p2=0.0)
    np.testing.assert_allclose(list(bridge._active_noise().values()), [0, 0])


def test_groups_survive_a_change_of_basis():
    # GHZ with an extra H on every qubit: every pair looks uncorrelated, yet all three are entangled.
    q = lab("0", "0", "0", "0")
    q.apply("h", [0])
    q.apply("cx", [0, 1])
    q.apply("cx", [0, 2])
    for k in range(3):
        q.apply("h", [k])
    snap = q.snapshot()
    assert snap["groups"] == [[0, 1, 2]] and snap["definite"] == [None, None, None, 0]
    # A Bell pair whose sealed half got a second H is still entangled.
    q = lab("0", "0")
    q.apply("h", [0])
    q.apply("cx", [0, 1])
    q.apply("h", [0])
    assert q.snapshot()["groups"] == [[0, 1]]


# -- floors that start entangled, machines that measure, teleportation ---------


def test_a_floor_can_start_entangled_and_auto_gates_are_not_the_players():
    q = Lab(
        [{"id": "Q", "init": "0"}, {"id": "CAT", "init": "0"}],
        seed=1,
        prep=[{"gate": "h", "qubits": [0]}, {"gate": "cx", "qubits": [0, 1]}],
    )
    snap = q.snapshot()
    assert snap["groups"] == [[0, 1]] and snap["stats"]["gates"] == 0
    assert [op["kind"] for op in snap["ops"]] == ["auto", "auto"]
    # Schrödinger's lab: bringing the partner back and applying CNOT undoes the entanglement.
    q.apply("cx", [0, 1])
    snap = q.snapshot()
    assert snap["definite"] == [None, 0] and snap["groups"] == [] and snap["stats"]["gates"] == 1
    assert "done by the floor itself" in q.code()


def test_the_wrong_cnot_direction_leaves_the_cat_uncertain():
    q = Lab([{"id": "Q", "init": "0"}, {"id": "CAT", "init": "0"}], prep=[{"gate": "h", "qubits": [0]}, {"gate": "cx", "qubits": [0, 1]}])
    q.apply("cx", [1, 0])
    snap = q.snapshot()
    assert snap["definite"] == [0, None] and snap["p1"][1] == pytest.approx(0.5)


def test_measurements_record_what_measured_them():
    q = lab("+", "1")
    assert q.measure(0, by="torch")["by"] == "torch"
    q.measure(1, force=True, by="machine")
    code = q.code()
    assert "flashlight on A" in code and "the machine measured B: read 1" in code
    assert [op["by"] for op in q.snapshot()["ops"]] == ["torch", "machine"]


def teleport(seed, fix_x=True, fix_z=True):
    """Floor 6 end to end. Qubits: 0=Q (canister), 1=B (Bob), 2=M (Alice's key), 3=L (lock)."""
    q = Lab(
        [{"id": i, "init": "0"} for i in "QBML"],
        seed=seed,
        prep=[{"gate": "h", "qubits": [2]}, {"gate": "cx", "qubits": [2, 3]}],  # the key starts entangled with the lock
    )
    q.apply("h", [0])
    q.apply("cx", [0, 1])  # Bob shares a pair with the canister
    q.apply("cx", [2, 0])
    q.apply("h", [2])  # Alice's two gates
    m = q.measure(2, force=True, by="machine")["result"]
    c = q.measure(0, force=True, by="machine")["result"]
    if c and fix_x:
        q.apply("x", [1])
    if m and fix_z:
        q.apply("z", [1])
    q.auto([{"gate": "cx", "qubits": [1, 3]}, {"gate": "h", "qubits": [1]}])  # the lock's own check
    read = (q.measure(1, force=True, by="lock")["result"], q.measure(3, force=True, by="lock")["result"])
    return (m, c), read


def test_teleportation_opens_the_lock_for_every_message():
    seen = set()
    for seed in range(60):
        message, read = teleport(seed)
        seen.add(message)
        assert read == (0, 0), (seed, message, read)
    assert seen == {(0, 0), (0, 1), (1, 0), (1, 1)}


def test_skipping_a_correction_is_caught_by_the_lock():
    for seed in range(60):
        (m, c), read = teleport(seed, fix_x=False)
        assert (read == (0, 0)) == (c == 0)
        (m, c), read = teleport(seed, fix_z=False)
        assert (read == (0, 0)) == (m == 0)


# The next three tests check floor 6 without the game engine at all: plain Qiskit
# circuits and the raw amplitudes, so a mistake in engine/quantum.py could not hide one here.


def alice_and_bob():
    """Floor 6 up to Alice's measurement. Qubits: 0=Q (canister), 1=B (Bob), 2=M (Alice's key), 3=L (lock)."""
    qc = QuantumCircuit(4)
    qc.h(2)
    qc.cx(2, 3)  # the floor: key M starts entangled with the lock's qubit L
    qc.h(0)
    qc.cx(0, 1)  # Bob's terminal: H on Q, CNOT Q to B
    qc.cx(2, 0)
    qc.h(2)  # Alice's teleporter: CNOT M to Q, H on M
    return qc


def test_plain_qiskit_teleport_always_opens_the_lock():
    qc = alice_and_bob()
    qc.cx(0, 1)  # "X on B if Q reads 1", written as a controlled gate instead of a measurement
    qc.cz(2, 1)  # "Z on B if M reads 1"
    qc.cx(1, 3)
    qc.h(1)  # the lock's check: CNOT B to L, H on B
    assert Statevector(qc).probabilities([1, 3]) == pytest.approx([1, 0, 0, 0])  # B, L read 0 0 every time


def test_plain_qiskit_each_note_needs_exactly_its_own_fix():
    amps = Statevector(alice_and_bob()).data.reshape(2, 2, 2, 2)  # axes: L, M, B, Q
    for m in (0, 1):
        for q in (0, 1):
            branch = amps[:, m, :, q].reshape(4)  # what B and L hold when the note says M=m, Q=q
            assert np.vdot(branch, branch).real == pytest.approx(0.25)  # each note is equally likely
            for fix_x in (0, 1):
                for fix_z in (0, 1):
                    lock = QuantumCircuit(2)  # 0=B, 1=L
                    if fix_x:
                        lock.x(0)
                    if fix_z:
                        lock.z(0)
                    lock.cx(0, 1)
                    lock.h(0)
                    opens = Statevector(branch * 2).evolve(lock).probabilities()[0]
                    assert opens == pytest.approx(1.0 if (fix_x, fix_z) == (q, m) else 0.0), (m, q, fix_x, fix_z)


def test_plain_qiskit_teleport_carries_any_state():
    for seed in range(12):
        psi = random_statevector(2, seed=seed)  # an arbitrary key, in place of the entangled one
        qc = QuantumCircuit(3)  # 0=M, 1=Q, 2=B
        qc.h(1)
        qc.cx(1, 2)
        qc.cx(0, 1)
        qc.h(0)
        amps = Statevector.from_label("00").tensor(psi).evolve(qc).data.reshape(2, 2, 2)  # axes: B, Q, M
        for m in (0, 1):
            for q in (0, 1):
                bob = amps[:, q, m] * 2
                if q:
                    bob = bob[::-1]  # X
                if m:
                    bob = bob * np.array([1, -1])  # Z
                assert abs(np.vdot(psi.data, bob)) ** 2 == pytest.approx(1.0), (seed, m, q)


def test_bridge_auto_gates_reprepare_a_key():
    spec = {"qubits": [{"id": "M", "init": "0"}, {"id": "L", "init": "0"}], "prep": [{"gate": "h", "qubits": [0]}, {"gate": "cx", "qubits": [0, 1]}]}
    assert json.loads(bridge.load_level(json.dumps(spec)))["state"]["groups"] == [[0, 1]]
    json.loads(bridge.measure(json.dumps({"qubits": [0, 1], "force": True, "by": "lock"})))
    out = json.loads(bridge.auto_gates(json.dumps({"reset": [0, 1], "ops": spec["prep"]})))
    assert out["ok"] and out["state"]["groups"] == [[0, 1]] and out["state"]["stats"]["gates"] == 0
