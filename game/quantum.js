// Thin async client for the Python engine (engine/bridge.py).
//
// `bridge` is the namespace of the Python module engine/bridge.py, loaded in main.js.
// On Qollab each of its members is a Python function proxy; `.callPromising(...)`
// runs it and resolves to its JSON string. Calls are queued so replies arrive in order.

function parse(out) {
  try {
    return JSON.parse(typeof out === 'string' ? out : String(out));
  } catch (err) {
    return { ok: false, error: 'The quantum engine sent an unreadable reply.' };
  }
}

function fail(err) {
  return { ok: false, error: String((err && err.message) || err) };
}

export function createQuantum(bridge) {
  let chain = Promise.resolve();

  function call(fn, ...args) {
    const run = async () => {
      try {
        return parse(await fn.callPromising(...args));
      } catch (err) {
        return fail(err);
      }
    };
    const next = chain.then(run, run);
    chain = next;
    return next;
  }

  return {
    info: () => call(bridge.info),
    loadLevel: (spec) => call(bridge.load_level, JSON.stringify(spec)),
    apply: (gate, qubits) => call(bridge.apply_gate, JSON.stringify({ gate, qubits })),
    measure: (qubits, force = false, by = 'torch') => call(bridge.measure, JSON.stringify({ qubits, force, by })),
    auto: (ops, reset = []) => call(bridge.auto_gates, JSON.stringify({ ops, reset })),
    reset: (qubits) => call(bridge.reset_qubits, JSON.stringify({ qubits })),
    setNoise: (enabled) => call(bridge.set_noise, JSON.stringify({ enabled })),
    calibrate: async (backend, shots) => {
      try {
        return parse(await bridge.calibrate.callPromising(backend, shots));
      } catch (err) {
        return fail(err);
      }
    },
  };
}
