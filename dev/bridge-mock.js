// A JavaScript stand-in for engine/bridge.py, for running the game with no Python
// at all (dev/index.html?engine=js and the single-file preview). It is NOT part
// of the Qollab upload: on Qollab every one of these calls is answered by Qiskit.
//
// It mirrors the Python engine call for call and field for field, and
// tests/test_mock_matches_qiskit.py checks the two against each other.

const EPS = 1e-9;
const GATE_QUBITS = { h: 1, x: 1, z: 1, cx: 2 };
const INIT_GATES = { 0: [], 1: ['x'], '+': ['h'], '-': ['x', 'h'] };
const R = Math.SQRT1_2;
const MEASURED_BY = {
  torch: 'flashlight on',
  lock: 'the door lock read',
  machine: 'the machine measured',
  box: 'opening the box showed',
};

let random = Math.random;
let lab = null;
let noise = { p1: 0, p2: 0 };
let noiseOn = true;

function makeLab(qubits) {
  const n = qubits.length;
  if (n < 1 || n > 10) throw new Error('a floor needs between 1 and 10 qubits');
  const self = {
    n,
    labels: qubits.map((q) => String(q.id)),
    init: qubits.map((q) => String(q.init === undefined ? '0' : q.init)),
    re: new Float64Array(1 << n),
    im: new Float64Array(1 << n),
    meta: [],
    noise: { p1: 0, p2: 0 },
  };
  self.re[0] = 1;
  self.init.forEach((init, q) => {
    if (!(init in INIT_GATES)) throw new Error(`unknown starting state '${init}'`);
    for (const name of INIT_GATES[init]) gate(self, name, [q], 'init');
  });
  return self;
}

function valid(s, name, qubits) {
  name = String(name).toLowerCase();
  if (!(name in GATE_QUBITS)) throw new Error(`ValueError: unknown gate '${name}'`);
  qubits = check(s, qubits);
  if (qubits.length !== GATE_QUBITS[name]) throw new Error(`ValueError: ${name} acts on ${GATE_QUBITS[name]} qubit(s)`);
  return [name, qubits];
}

function auto(s, ops) {
  for (const op of ops || []) {
    const [name, qubits] = valid(s, op.gate, op.qubits);
    gate(s, name, qubits, 'auto');
  }
}

function evolve(s, name, qubits) {
  const { re, im } = s;
  const size = 1 << s.n;
  const bit = 1 << qubits[qubits.length - 1];
  if (name === 'cx') {
    const ctrl = 1 << qubits[0];
    for (let i = 0; i < size; i += 1) {
      if (i & ctrl && !(i & bit)) {
        const j = i | bit;
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    return;
  }
  for (let i = 0; i < size; i += 1) {
    if (i & bit) continue;
    const j = i | bit;
    const ar = re[i];
    const ai = im[i];
    const br = re[j];
    const bi = im[j];
    if (name === 'h') {
      re[i] = (ar + br) * R;
      im[i] = (ai + bi) * R;
      re[j] = (ar - br) * R;
      im[j] = (ai - bi) * R;
    } else if (name === 'x') {
      re[i] = br;
      im[i] = bi;
      re[j] = ar;
      im[j] = ai;
    } else if (name === 'z') {
      re[j] = -br;
      im[j] = -bi;
    } else if (name === 'y') {
      re[i] = bi;
      im[i] = -br;
      re[j] = -ai;
      im[j] = ar;
    }
  }
}

function gate(s, name, qubits, kind) {
  evolve(s, name, qubits);
  s.meta.push({ kind, gate: name, qubits: qubits.slice() });
}

function check(s, qubits) {
  const out = qubits.map((q) => Number(q));
  if (new Set(out).size !== out.length || out.some((q) => !Number.isInteger(q) || q < 0 || q >= s.n)) {
    throw new Error(`ValueError: bad qubits [${out}]`);
  }
  return out;
}

function pOne(s, q) {
  let p = 0;
  const bit = 1 << q;
  for (let i = 0; i < 1 << s.n; i += 1) if (i & bit) p += s.re[i] * s.re[i] + s.im[i] * s.im[i];
  return p;
}

function collapse(s, q, outcome) {
  const bit = 1 << q;
  let norm = 0;
  for (let i = 0; i < 1 << s.n; i += 1) {
    if (!!(i & bit) !== !!outcome) {
      s.re[i] = 0;
      s.im[i] = 0;
    } else norm += s.re[i] * s.re[i] + s.im[i] * s.im[i];
  }
  norm = Math.sqrt(norm);
  for (let i = 0; i < 1 << s.n; i += 1) {
    s.re[i] /= norm;
    s.im[i] /= norm;
  }
}

function applyGate(s, name, qubits) {
  [name, qubits] = valid(s, name, qubits);
  gate(s, name, qubits, 'gate');
  const chance = qubits.length === 2 ? s.noise.p2 : s.noise.p1;
  if (chance > 0 && random() < chance) {
    const victim = qubits[Math.floor(random() * qubits.length)];
    const pauli = 'xyz'[Math.floor(random() * 3)];
    gate(s, pauli, [victim], 'noise');
    return { qubit: victim, label: s.labels[victim], pauli, after: name };
  }
  return null;
}

function measure(s, q, force, by) {
  [q] = check(s, [q]);
  const p1 = pOne(s, q);
  const definite = p1 < EPS || p1 > 1 - EPS;
  if (definite && !force) return null;
  const outcome = definite ? Number(p1 > 0.5) : Number(random() < p1);
  collapse(s, q, outcome);
  s.meta.push({ kind: 'measure', gate: 'measure', qubits: [q], result: outcome, p1, by });
  return { qubit: q, label: s.labels[q], result: outcome, p1, random: !definite, by };
}

function reset(s, q) {
  [q] = check(s, [q]);
  const p1 = pOne(s, q);
  const outcome = p1 > EPS && p1 < 1 - EPS ? Number(random() < p1) : Number(p1 > 0.5);
  collapse(s, q, outcome);
  if (outcome) evolve(s, 'x', [q]);
  s.meta.push({ kind: 'reset', gate: 'reset', qubits: [q] });
}

// Purity of the reduced state of a set of qubits: 1 means the set has a state of its own.
function purityOf(s, subset) {
  const rest = [];
  for (let q = 0; q < s.n; q += 1) if (!subset.includes(q)) rest.push(q);
  const dimS = 1 << subset.length;
  const dimR = 1 << rest.length;
  const index = (a, b) => {
    let i = 0;
    subset.forEach((q, k) => {
      if ((a >> k) & 1) i |= 1 << q;
    });
    rest.forEach((q, k) => {
      if ((b >> k) & 1) i |= 1 << q;
    });
    return i;
  };
  let purity = 0;
  for (let a = 0; a < dimS; a += 1) {
    for (let c = 0; c < dimS; c += 1) {
      let xr = 0;
      let xi = 0;
      for (let b = 0; b < dimR; b += 1) {
        const i = index(a, b);
        const j = index(c, b);
        xr += s.re[i] * s.re[j] + s.im[i] * s.im[j];
        xi += s.im[i] * s.re[j] - s.re[i] * s.im[j];
      }
      purity += xr * xr + xi * xi;
    }
  }
  return purity;
}

function reducedOf(s) {
  const out = [];
  for (let q = 0; q < s.n; q += 1) {
    const bit = 1 << q;
    let r00 = 0;
    let r11 = 0;
    let xr = 0;
    let xi = 0;
    for (let i = 0; i < 1 << s.n; i += 1) {
      if (i & bit) continue;
      const j = i | bit;
      r00 += s.re[i] * s.re[i] + s.im[i] * s.im[i];
      r11 += s.re[j] * s.re[j] + s.im[j] * s.im[j];
      xr += s.re[i] * s.re[j] + s.im[i] * s.im[j];
      xi += s.im[i] * s.re[j] - s.re[i] * s.im[j];
    }
    out.push({ x: 2 * xr, y: -2 * xi, z: r00 - r11, purity: r00 * r00 + r11 * r11 + 2 * (xr * xr + xi * xi) });
  }
  return out;
}

function combinations(items, size) {
  if (size === 0) return [[]];
  const out = [];
  items.forEach((item, i) => {
    for (const tail of combinations(items.slice(i + 1), size - 1)) out.push([item, ...tail]);
  });
  return out;
}

function groupsOf(s, reduced) {
  let left = [];
  for (let q = 0; q < s.n; q += 1) if (reduced[q].purity < 1 - 1e-7) left.push(q);
  const groups = [];
  while (left.length) {
    const [first, ...others] = left;
    let group = left.slice();
    for (let size = 1; size < others.length; size += 1) {
      const found = combinations(others, size).find((c) => Math.abs(purityOf(s, [first, ...c]) - 1) < 1e-7);
      if (found) {
        group = [first, ...found];
        break;
      }
    }
    groups.push(group.slice().sort((a, b) => a - b));
    left = left.filter((q) => !group.includes(q));
  }
  return groups.sort((a, b) => a[0] - b[0]);
}

function jointOf(s, group) {
  const probs = new Array(1 << group.length).fill(0);
  for (let i = 0; i < 1 << s.n; i += 1) {
    let k = 0;
    group.forEach((q, pos) => {
      if ((i >> q) & 1) k |= 1 << pos;
    });
    probs[k] += s.re[i] * s.re[i] + s.im[i] * s.im[i];
  }
  const rows = [];
  probs.forEach((p, index) => {
    if (p > 1e-9) rows.push({ bits: group.map((_, k) => (index >> k) & 1).join(''), p });
  });
  const key = (r) => Math.round(r.p * 1e9);
  return rows.sort((a, b) => key(b) - key(a) || (a.bits < b.bits ? -1 : 1));
}

function codeOf(s) {
  const lines = [
    'from qiskit import QuantumCircuit',
    '',
    `# qubits: ${s.labels.map((label, i) => `${i}=${label}`).join(', ')}`,
    `qc = QuantumCircuit(${s.n}, ${s.n})`,
  ];
  for (const m of s.meta) {
    const q = m.qubits;
    const label = s.labels[q[q.length - 1]];
    if (m.kind === 'measure') lines.push(`qc.measure(${q[0]}, ${q[0]})  # ${MEASURED_BY[m.by] || m.by} ${label}: read ${m.result}`);
    else if (m.kind === 'reset') lines.push(`qc.reset(${q[0]})  # ${label} cleared to 0`);
    else {
      let call = `qc.${m.gate}(${q.join(', ')})`;
      if (m.kind === 'init') call += `  # ${label} starts in |${s.init[q[0]]}>`;
      else if (m.kind === 'noise') call += `  # hardware noise hit ${label}`;
      else if (m.kind === 'auto') call += '  # done by the floor itself';
      lines.push(call);
    }
  }
  return lines.join('\n');
}

// Circuit depth the way Qiskit counts it: every instruction, measurements and resets included.
function depthOf(s) {
  const level = new Array(s.n).fill(0);
  for (const m of s.meta) {
    const d = Math.max(...m.qubits.map((q) => level[q])) + 1;
    for (const q of m.qubits) level[q] = d;
  }
  return Math.max(0, ...level);
}

function snapshot(s) {
  const reduced = reducedOf(s);
  const round6 = (v) => Math.round(v * 1e6) / 1e6 + 0;
  const raw = reduced.map((r) => Math.min(Math.max((1 - r.z) / 2, 0), 1));
  const definite = raw.map((p) => (p < 1e-6 ? 0 : p > 1 - 1e-6 ? 1 : null));
  const groups = groupsOf(s, reduced);
  return {
    labels: s.labels,
    init: s.init,
    p1: raw.map((p, q) => (definite[q] === null ? p : definite[q])),
    definite,
    bloch: reduced.map((r) => [round6(r.x), round6(r.y), round6(r.z)]),
    purity: reduced.map((r) => round6(r.purity)),
    groups,
    joint: groups.map((g) => ({ qubits: g, dist: jointOf(s, g) })),
    ops: s.meta
      .filter((m) => m.kind !== 'init')
      .map((m) => (m.kind === 'measure' ? { kind: m.kind, gate: m.gate, qubits: m.qubits, result: m.result, by: m.by } : { kind: m.kind, gate: m.gate, qubits: m.qubits })),
    code: codeOf(s),
    stats: {
      gates: s.meta.filter((m) => m.kind === 'gate').length,
      measurements: s.meta.filter((m) => m.kind === 'measure').length,
      noise: s.meta.filter((m) => m.kind === 'noise').length,
      depth: depthOf(s),
    },
  };
}

const activeNoise = () => (noiseOn ? { ...noise } : { p1: 0, p2: 0 });

function reply(fn) {
  try {
    return JSON.stringify({ ok: true, ...(fn() || {}) });
  } catch (err) {
    return JSON.stringify({ ok: false, error: String((err && err.message) || err) });
  }
}

function needLab() {
  if (!lab) throw new Error('RuntimeError: no floor loaded yet');
  return lab;
}

const api = {
  info: () => reply(() => ({ engine: 'JavaScript stand-in engine', qiskit: null, python: null, preview: true })),
  load_level: (specJson) =>
    reply(() => {
      const spec = JSON.parse(specJson);
      lab = makeLab(spec.qubits);
      auto(lab, spec.prep);
      lab.noise = activeNoise();
      return { state: snapshot(lab) };
    }),
  apply_gate: (reqJson) =>
    reply(() => {
      const req = JSON.parse(reqJson);
      const glitch = applyGate(needLab(), req.gate, req.qubits);
      return { state: snapshot(lab), glitch };
    }),
  measure: (reqJson) =>
    reply(() => {
      const req = JSON.parse(reqJson);
      const events = req.qubits.map((q) => measure(needLab(), q, !!req.force, String(req.by || 'torch'))).filter(Boolean);
      return { state: snapshot(lab), measured: events };
    }),
  reset_qubits: (reqJson) =>
    reply(() => {
      for (const q of JSON.parse(reqJson).qubits) reset(needLab(), q);
      return { state: snapshot(lab) };
    }),
  auto_gates: (reqJson) =>
    reply(() => {
      const req = JSON.parse(reqJson);
      for (const q of req.reset || []) reset(needLab(), q);
      auto(lab, req.ops);
      return { state: snapshot(lab) };
    }),
  set_noise: (reqJson) =>
    reply(() => {
      noiseOn = !!JSON.parse(reqJson).enabled;
      if (lab) lab.noise = activeNoise();
      return { enabled: noiseOn, noise: activeNoise() };
    }),
  calibrate: () => JSON.stringify({ ok: false, preview: true, error: 'no quantum backend in this build' }),
};

const wrap = (fn) => ({ callPromising: async (...args) => fn(...args) });

export const info = wrap(api.info);
export const load_level = wrap(api.load_level);
export const apply_gate = wrap(api.apply_gate);
export const measure_ = wrap(api.measure);
export { measure_ as measure };
export const reset_qubits = wrap(api.reset_qubits);
export const auto_gates = wrap(api.auto_gates);
export const set_noise = wrap(api.set_noise);
export const calibrate = wrap(api.calibrate);

// Test hooks (used by tests/mock_driver.mjs only).
export const __test = {
  setRandom(fn) {
    random = fn || Math.random;
  },
  setNoise(p1, p2) {
    noise = { p1, p2 };
  },
};
