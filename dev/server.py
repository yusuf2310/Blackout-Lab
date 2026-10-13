"""Local development server: the game in your browser, Qiskit in this process.

    python dev/server.py            # http://localhost:8000/dev/
    python dev/server.py --noisy 0.02   # pretend the backend flips 2% of read-outs

It serves the project folder and answers ``POST /api/<function>`` by calling
the function of that name in ``engine/bridge.py``, which is exactly what Qollab
does through ``.callPromising``. Not part of the Qollab upload.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from qiskit.providers.basic_provider import BasicSimulator  # noqa: E402

from engine import bridge  # noqa: E402

API = {"info", "load_level", "apply_gate", "measure", "reset_qubits", "auto_gates", "set_noise", "calibrate"}


class NoisyBasic(BasicSimulator):
    """BasicSimulator whose read-outs flip with a fixed chance: a stand-in for a noisy device."""

    flip = 0.0

    def run(self, run_input, **options):
        job = super().run(run_input, **options)
        counts = job.result().get_counts()
        rng = random.Random(7)
        noisy: dict[str, int] = {}
        for key, shots in counts.items():
            for _ in range(shots):
                bits = "".join(("1" if b == "0" else "0") if rng.random() < self.flip else b for b in key)
                noisy[bits] = noisy.get(bits, 0) + 1

        class _Result:
            def get_counts(self):
                return noisy

        class _Job:
            def result(self):
                return _Result()

        return _Job()


BACKEND = BasicSimulator()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        name = self.path.rsplit("/", 1)[-1]
        if not self.path.startswith("/api/") or name not in API:
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")) or 0)
        args = json.loads(body or b"{}").get("args", [])
        if name == "calibrate":
            args = [BACKEND, *args[1:]]
        payload = getattr(bridge, name)(*args).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):  # keep the terminal quiet
        pass


def main() -> None:
    global BACKEND
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--noisy", type=float, default=0.0, help="read-out flip chance of the pretend backend")
    args = parser.parse_args()
    if args.noisy > 0:
        BACKEND = NoisyBasic()
        BACKEND.flip = args.noisy
    print(f"Blackout Lab dev server: http://localhost:{args.port}/dev/  (Ctrl+C to stop)")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
