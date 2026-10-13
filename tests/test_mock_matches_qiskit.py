"""The JavaScript stand-in engine must agree with Qiskit, step for step.

Random floors are played on the real engine; the same calls, with the same
measurement outcomes forced, are replayed on dev/bridge-mock.js through Node.
Skipped when Node is not installed.
"""

import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

from engine import bridge

ROOT = Path(__file__).resolve().parent.parent
NAMES = "QABRCDE"


def _play(rng: random.Random) -> tuple[list[dict], list[dict]]:
    n = rng.randint(2, 6)
    qubits = [{"id": NAMES[i], "init": rng.choice("01+-")} for i in range(n)]
    prep = [{"gate": "h", "qubits": [0]}, {"gate": "cx", "qubits": [0, 1]}] if rng.random() < 0.5 else []
    steps = [{"op": "load", "qubits": qubits, "prep": prep}]
    replies = [json.loads(bridge.load_level(json.dumps({"qubits": qubits, "prep": prep, "seed": rng.randint(0, 10**6)})))]
    for _ in range(40):
        state = replies[-1]["state"]
        roll = rng.random()
        if roll < 0.2:
            q = rng.randrange(n)
            force = rng.random() < 0.3
            by = rng.choice(["torch", "lock", "machine", "box"])
            reply = json.loads(bridge.measure(json.dumps({"qubits": [q], "force": force, "by": by})))
            outcomes = [e["result"] for e in reply["measured"] if e["random"]]
            steps.append({"op": "measure", "qubits": [q], "force": force, "by": by, "outcomes": outcomes})
        elif roll < 0.23 and any(d is not None for d in state["definite"]):
            # the floor clears a definite qubit and re-entangles it, as a lock does after a refused key
            q = rng.choice([i for i, d in enumerate(state["definite"]) if d is not None])
            other = rng.choice([i for i in range(n) if i != q])
            ops = [{"gate": "h", "qubits": [q]}, {"gate": "cx", "qubits": [q, other]}]
            reply = json.loads(bridge.auto_gates(json.dumps({"reset": [q], "ops": ops})))
            steps.append({"op": "auto", "reset": [q], "ops": ops})
        elif roll < 0.25 and any(d is not None for d in state["definite"]):
            q = rng.choice([i for i, d in enumerate(state["definite"]) if d is not None])
            reply = json.loads(bridge.reset_qubits(json.dumps({"qubits": [q]})))
            steps.append({"op": "reset", "qubits": [q]})
        else:
            gate = rng.choice(["h", "h", "x", "z", "cx", "cx", "cx"])
            qs = rng.sample(range(n), 2 if gate == "cx" else 1)
            reply = json.loads(bridge.apply_gate(json.dumps({"gate": gate, "qubits": qs})))
            steps.append({"op": "apply", "gate": gate, "qubits": qs})
        assert reply["ok"], reply
        replies.append(reply)
    return steps, replies


def _same(a, b, path="state"):
    if isinstance(a, float) or isinstance(b, float):
        assert a == pytest.approx(b, abs=1e-6), path
    elif isinstance(a, dict):
        assert a.keys() == b.keys(), path
        for key in a:
            _same(a[key], b[key], f"{path}.{key}")
    elif isinstance(a, list):
        assert len(a) == len(b), f"{path}: {a} vs {b}"
        for i, (x, y) in enumerate(zip(a, b)):
            _same(x, y, f"{path}[{i}]")
    else:
        assert a == b, f"{path}: {a!r} vs {b!r}"


@pytest.mark.skipif(shutil.which("node") is None, reason="Node is not installed")
def test_mock_engine_matches_qiskit(tmp_path):
    bridge._noise.update(p1=0.0, p2=0.0)
    rng = random.Random(2026)
    runs = [_play(rng) for _ in range(25)]
    script = tmp_path / "script.json"
    script.write_text(json.dumps([steps for steps, _ in runs]))
    done = subprocess.run(
        ["node", str(ROOT / "tests" / "mock_driver.mjs"), str(script)], capture_output=True, text=True, timeout=120
    )
    assert done.returncode == 0, done.stderr
    mock_runs = json.loads(done.stdout)
    checked = 0
    for (steps, replies), mock_replies in zip(runs, mock_runs):
        for step, real, mock in zip(steps, replies, mock_replies):
            assert mock["ok"], (step, mock)
            _same(real["state"], mock["state"], f"after {step}")
            if step["op"] == "measure":
                _same(real["measured"], mock["measured"], f"events of {step}")
            checked += 1
    assert checked == 25 * 41
