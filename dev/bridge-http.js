// Local development only: the same seven functions as engine/bridge.py, reached
// over HTTP through dev/server.py, so the game runs against real CPython Qiskit.
// The object shape matches what Qollab hands to main.js (`fn.callPromising`).

async function post(name, args) {
  const res = await fetch(`/api/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
  });
  if (!res.ok) throw new Error(`dev server answered ${res.status}`);
  return res.text();
}

const remote = (name) => ({
  callPromising: (...args) => post(name, name === 'calibrate' ? [null, ...args.slice(1)] : args),
});

export const info = remote('info');
export const load_level = remote('load_level');
export const apply_gate = remote('apply_gate');
export const measure = remote('measure');
export const reset_qubits = remote('reset_qubits');
export const auto_gates = remote('auto_gates');
export const set_noise = remote('set_noise');
export const calibrate = remote('calibrate');
