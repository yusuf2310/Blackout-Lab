// Replays a script of engine calls on the JavaScript stand-in (dev/bridge-mock.js)
// and prints the snapshot after each call. Used by test_mock_matches_qiskit.py.
import { readFileSync } from 'node:fs';
import * as mock from '../dev/bridge-mock.js';

const script = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = [];
for (const run of script) {
  const snaps = [];
  for (const step of run) {
    // Force every random draw to reproduce the outcome Qiskit sampled.
    const forced = (step.outcomes || []).slice();
    mock.__test.setRandom(() => (forced.shift() === 1 ? 0 : 0.999999));
    let reply;
    if (step.op === 'load') reply = await mock.load_level.callPromising(JSON.stringify({ qubits: step.qubits, prep: step.prep }));
    else if (step.op === 'auto') reply = await mock.auto_gates.callPromising(JSON.stringify({ ops: step.ops, reset: step.reset }));
    else if (step.op === 'apply') reply = await mock.apply_gate.callPromising(JSON.stringify({ gate: step.gate, qubits: step.qubits }));
    else if (step.op === 'measure') reply = await mock.measure.callPromising(JSON.stringify({ qubits: step.qubits, force: step.force, by: step.by }));
    else reply = await mock.reset_qubits.callPromising(JSON.stringify({ qubits: step.qubits }));
    snaps.push(JSON.parse(reply));
  }
  out.push(snaps);
}
console.log(JSON.stringify(out));
