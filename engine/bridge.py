"""What the page calls. Every function takes and returns JSON strings.

On Qollab, ``main.js`` imports this module (``import * as bridge from
'engine.bridge'``) and calls each function with ``.callPromising``. Locally,
``dev/server.py`` exposes the same functions over HTTP so the identical game
code runs against CPython Qiskit.

Every function answers ``{"ok": true, ...}`` or ``{"ok": false, "error": ...}``
and never raises, so an engine error cannot freeze the game loop.
"""

from __future__ import annotations

import json
import platform
import traceback

import qiskit

from . import calibrate as cal
from .quantum import Lab

_lab: Lab | None = None
_calibration: dict | None = None  # result of the single backend job of this run
_noise = {"p1": 0.0, "p2": 0.0}
_noise_on = True


def _reply(fn) -> str:
    try:
        payload = fn() or {}
        return json.dumps({"ok": True, **payload})
    except Exception as exc:  # noqa: BLE001 - report, never raise into JS
        return json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()[-1500:]})


def _active_noise() -> dict:
    return dict(_noise) if _noise_on else {"p1": 0.0, "p2": 0.0}


def _need_lab() -> Lab:
    if _lab is None:
        raise RuntimeError("no floor loaded yet")
    return _lab


def info() -> str:
    """Versions, shown on the title screen."""
    return _reply(
        lambda: {"engine": f"Qiskit {qiskit.__version__}", "qiskit": qiskit.__version__, "python": platform.python_version()}
    )


def load_level(spec_json: str) -> str:
    """Start a floor.

    ``spec`` is ``{"qubits": [{"id": "A", "init": "0"}, ...], "prep": [{"gate": "cx", "qubits": [0, 1]}, ...]}``.
    ``prep`` (optional) lists gates the floor applies before play, for example a pair that starts entangled.
    """

    def go():
        global _lab
        spec = json.loads(spec_json)
        _lab = Lab(spec["qubits"], seed=spec.get("seed"), noise=_active_noise(), prep=spec.get("prep"))
        return {"state": _lab.snapshot()}

    return _reply(go)


def apply_gate(req_json: str) -> str:
    """Apply ``{"gate": "h" | "x" | "z" | "cx", "qubits": [...]}`` (cx is [control, target])."""

    def go():
        req = json.loads(req_json)
        lab = _need_lab()
        glitch = lab.apply(req["gate"], req["qubits"])
        return {"state": lab.snapshot(), "glitch": glitch}

    return _reply(go)


def measure(req_json: str) -> str:
    """Measure ``{"qubits": [...]}`` one by one and collapse the state.

    ``by`` says what is measuring: "torch" (default), "lock", "machine" or "box".
    """

    def go():
        req = json.loads(req_json)
        lab = _need_lab()
        force = bool(req.get("force", False))
        by = str(req.get("by", "torch"))
        events = [e for e in (lab.measure(q, force=force, by=by) for q in req["qubits"]) if e]
        return {"state": lab.snapshot(), "measured": events}

    return _reply(go)


def reset_qubits(req_json: str) -> str:
    """Clear ``{"qubits": [...]}`` back to |0> (a refused door key)."""

    def go():
        req = json.loads(req_json)
        lab = _need_lab()
        for q in req["qubits"]:
            lab.reset(q)
        return {"state": lab.snapshot()}

    return _reply(go)


def auto_gates(req_json: str) -> str:
    """Gates the floor applies itself: ``{"reset": [...], "ops": [{"gate": .., "qubits": [..]}]}``.

    Used for a lock's own check and for preparing a fresh key after a refused one.
    """

    def go():
        req = json.loads(req_json)
        lab = _need_lab()
        for q in req.get("reset", []):
            lab.reset(q)
        lab.auto(req.get("ops", []))
        return {"state": lab.snapshot()}

    return _reply(go)


def set_noise(req_json: str) -> str:
    """Turn the calibrated hardware noise on or off: ``{"enabled": bool}``."""

    def go():
        global _noise_on
        _noise_on = bool(json.loads(req_json).get("enabled", True))
        if _lab is not None:
            _lab.set_noise(_active_noise())
        return {"enabled": _noise_on, "noise": _active_noise()}

    return _reply(go)


def calibrate(backend, shots=cal.DEFAULT_SHOTS) -> str:
    """Run the lab self-test on ``backend``: the one job of this run.

    A second call returns the first result and never reaches the backend, so
    the game cannot break IonQ's one-job-per-run rule.
    """

    def go():
        global _calibration
        if _calibration is None:
            target = backend
            if target is None or isinstance(target, str):  # local development only
                from qiskit.providers.basic_provider import BasicSimulator

                target = BasicSimulator()
            _calibration = {"error": "the self-test did not finish"}  # set first: no retry can send a second job
            try:
                _calibration = cal.run(target, int(shots))
            except Exception as exc:  # noqa: BLE001
                _calibration = {"error": f"{type(exc).__name__}: {exc}", "backend": cal.backend_name(target)}
            if "error" not in _calibration:
                _noise.update(p1=_calibration["p1"], p2=_calibration["p2"])
                if _lab is not None:
                    _lab.set_noise(_active_noise())
        if "error" in _calibration:
            raise RuntimeError(_calibration["error"])
        return {"report": _calibration, "noise_on": _noise_on}

    return _reply(go)
