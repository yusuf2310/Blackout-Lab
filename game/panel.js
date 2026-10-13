// The instrument rack on the right: circuit trace, probability meters, lab notes.
// Redrawn from the engine's snapshot.

import { GATE_INFO, ROLE_NAME, ROLE_WORDS, roomsOf } from './levels.js';

const ROW = 36;
const TOP = 12;
const LABEL_W = 70;
const COL = 36;
const READ_W = 92;
const MIN_COLS = 4;

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const pct = (p) => `${Math.round(p * 100)}%`;

// Whole-number percentages for a set of probabilities, rounded so they add up to their total.
function shares(ps) {
  const raw = ps.map((p) => p * 100);
  const out = raw.map(Math.floor);
  const short = Math.round(raw.reduce((a, b) => a + b, 0)) - out.reduce((a, b) => a + b, 0);
  const byRemainder = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < short; k += 1) out[byRemainder[k % byRemainder.length][1]] += 1;
  return out;
}
const KET = { 0: '|0⟩', 1: '|1⟩', '+': '|+⟩', '-': '|−⟩' };

// What one qubit looks like right now, in words and in a short ket.
export function describe(snap, qi) {
  const d = snap.definite[qi];
  if (d !== null) return { kind: 'definite', ket: KET[d], p1: d };
  const inGroup = snap.groups.find((g) => g.includes(qi));
  if (inGroup) return { kind: 'entangled', ket: '⋈', p1: snap.p1[qi], partners: inGroup.filter((k) => k !== qi) };
  const x = snap.bloch[qi][0];
  const ket = x > 0.99 ? KET['+'] : x < -0.99 ? KET['-'] : 'ψ';
  return { kind: 'superposed', ket, p1: snap.p1[qi] };
}

function layoutColumns(ops, n) {
  const next = new Array(n).fill(0);
  const cols = [];
  for (const op of ops) {
    const lo = Math.min(...op.qubits);
    const hi = Math.max(...op.qubits);
    let col = 0;
    for (let q = lo; q <= hi; q += 1) col = Math.max(col, next[q]);
    for (let q = lo; q <= hi; q += 1) next[q] = col + 1;
    cols.push(col);
  }
  return { cols, count: Math.max(0, ...next) };
}

function gateBox(x, y, text, cls) {
  return `<g class="gate ${cls}"><rect x="${x - 13}" y="${y - 13}" width="26" height="26" rx="5"/><text x="${x}" y="${y + 0.5}">${esc(text)}</text></g>`;
}

function opSvg(op, x, yOf) {
  const y = yOf(op.qubits[op.qubits.length - 1]);
  if (op.kind === 'measure') {
    return (
      `<g class="gate g-measure"><rect x="${x - 13}" y="${y - 13}" width="26" height="26" rx="5"/>` +
      `<path d="M${x - 8} ${y + 5} A 8 8 0 0 1 ${x + 8} ${y + 5}" /><line x1="${x}" y1="${y + 5}" x2="${x + 6}" y2="${y - 6}"/>` +
      `<circle class="result" cx="${x + 12}" cy="${y - 12}" r="7"/><text class="result-text" x="${x + 12}" y="${y - 11.5}">${op.result}</text></g>`
    );
  }
  if (op.kind === 'reset') return gateBox(x, y, KET[0], 'g-reset');
  if (op.kind === 'noise') return gateBox(x, y, `!${op.gate.toUpperCase()}`, 'g-noise');
  const auto = op.kind === 'auto' ? ' g-auto' : '';
  if (op.gate === 'cx') {
    const yc = yOf(op.qubits[0]);
    return (
      `<g class="gate g-cx${auto}"><line x1="${x}" y1="${yc}" x2="${x}" y2="${y}"/><circle class="ctrl" cx="${x}" cy="${yc}" r="4.5"/>` +
      `<circle class="targ" cx="${x}" cy="${y}" r="9.5"/><line x1="${x - 9.5}" y1="${y}" x2="${x + 9.5}" y2="${y}"/><line x1="${x}" y1="${y - 9.5}" x2="${x}" y2="${y + 9.5}"/></g>`
    );
  }
  return gateBox(x, y, op.gate.toUpperCase(), `g-${op.gate}${auto}`);
}

const MEASURED_BY = { torch: 'Flashlight observed', lock: 'Door lock read', machine: 'Machine measured', box: 'Box opened on' };

function opWords(op, labels) {
  const names = op.qubits.map((q) => labels[q]);
  if (op.kind === 'measure') return `${MEASURED_BY[op.by] || 'Measured'} ${names[0]}: found in state ${op.result}`;
  if (op.kind === 'reset') return `${names[0]} reset to state 0`;
  if (op.kind === 'noise') return `Hardware noise: stray ${op.gate.toUpperCase()} on ${names[0]}`;
  const who = op.kind === 'auto' ? 'The floor applied ' : '';
  if (op.gate === 'cx') return `${who}CNOT, control ${names[0]}, target ${names[1]}`;
  return `${who}${op.gate.toUpperCase()} on ${names[0]}`;
}

export function createPanel(dom) {
  let level = null;
  let rows = []; // probability rows, one per qubit
  let lamps = new Set();
  let lastOps = -1;
  let lastSnap = null;
  let expanded = false;
  const log = [];
  const circuitModule = dom.circuitGates.closest('.module');
  const home = { parent: circuitModule.parentElement, next: circuitModule.nextElementSibling };

  const look = (q) => (lamps.has(q.id) ? 'door' : q.role);

  function setLevel(next, index, total) {
    level = next;
    lastOps = -1;
    log.length = 0;
    lamps = new Set(roomsOf(level).flatMap((room) => (room.door ? room.door.lock : [])));
    dom.probs.innerHTML = level.qubits.length ? '' : '<p class="fine">No qubits up here.</p>';
    rows = level.qubits.map((q) => {
      const row = document.createElement('div');
      row.className = 'prob-row';
      const what = lamps.has(q.id) && q.role !== 'door' ? `${ROLE_NAME[q.role]}, read by the exit lock` : ROLE_NAME[q.role];
      row.innerHTML =
        `<span class="q-chip q-${look(q)}" title="${esc(what)}">${esc(q.id)}</span>` +
        `<span class="track" aria-hidden="true"><span class="seg seg0"></span><span class="seg seg1"></span></span>` +
        `<span class="prob-text"></span>`;
      dom.probs.appendChild(row);
      return {
        row,
        seg0: row.querySelector('.seg0'),
        seg1: row.querySelector('.seg1'),
        text: row.querySelector('.prob-text'),
        role: q.role,
      };
    });
    dom.floorTag.textContent = level.tag || `Floor ${index + 1} of ${total}`;
    dom.goal.textContent = level.goal;
    dom.concept.textContent = level.concept;
    dom.gateList.innerHTML = level.gates
      .map((g) => `<li><span class="gate-chip">${esc(GATE_INFO[g].symbol)}</span><span><b>${esc(GATE_INFO[g].name)}.</b> ${esc(GATE_INFO[g].text)}</span></li>`)
      .join('');
    setHints(0);
    renderLog();
  }

  function setHints(shown) {
    if (!level) return;
    dom.hints.innerHTML = level.hints
      .slice(0, shown)
      .map((h) => `<li>${esc(h)}</li>`)
      .join('');
    const left = level.hints.length - shown;
    dom.hintButton.hidden = level.hints.length === 0;
    dom.hintButton.disabled = left <= 0;
    dom.hintButton.textContent = left <= 0 ? 'All hints shown' : shown === 0 ? 'Show a hint (H)' : `Next hint (${left} left)`;
  }

  function renderCircuit(snap) {
    const n = snap.labels.length;
    const { cols, count } = layoutColumns(snap.ops, n);
    const room = expanded
      ? Math.floor(((dom.circuitGates.parentElement.clientWidth || 0) - LABEL_W - READ_W) / COL)
      : Math.ceil((dom.circuitGates.clientWidth || 0) / COL);
    const nCols = Math.max(MIN_COLS, count + 1, room);
    const height = TOP * 2 + n * ROW;
    const yOf = (q) => TOP + q * ROW + ROW / 2;
    const svg = (w, extra, body) => `<svg class="circuit-svg" width="${w}" height="${height}" viewBox="0 0 ${w} ${height}" ${extra}>${body}</svg>`;
    const states = snap.labels.map((_, q) => describe(snap, q));

    let left = '';
    let mid = '';
    let right = '';
    for (let q = 0; q < n; q += 1) {
      const y = yOf(q);
      const role = level.qubits[q].role;
      const d = states[q];
      left += `<text class="wire-id q-${look(level.qubits[q])}" x="8" y="${y + 0.5}">${esc(snap.labels[q])}</text>`;
      left += `<text class="wire-init" x="40" y="${y + 0.5}">${KET[snap.init[q]]}</text>`;
      left += `<line class="wire" x1="${LABEL_W - 6}" y1="${y}" x2="${LABEL_W}" y2="${y}"/>`;
      mid += `<line class="wire wire-${d.kind}" x1="0" y1="${y}" x2="${nCols * COL}" y2="${y}"/>`;
      const word = d.kind === 'definite' ? (ROLE_WORDS[role] ? ROLE_WORDS[role][d.p1] : '') : `${pct(d.p1)} 1`;
      right += `<line class="wire wire-${d.kind}" x1="0" y1="${y}" x2="6" y2="${y}"/>`;
      right += `<g class="readout r-${d.kind} ${d.kind === 'definite' ? `r-${d.p1}` : ''}"><rect x="6" y="${y - 11}" width="36" height="22" rx="11"/>`;
      right += `<text class="r-ket" x="24" y="${y + 0.5}">${d.ket}</text><text class="r-word" x="47" y="${y + 0.5}">${word}</text></g>`;
    }
    snap.ops.forEach((op, i) => {
      mid += opSvg(op, cols[i] * COL + COL / 2, yOf);
    });

    const picture = 'role="img" aria-labelledby="circuit-desc"';
    if (!n) {
      dom.circuitLabels.innerHTML = '';
      dom.circuitGates.innerHTML = '<p class="fine circuit-empty">No circuit up here.</p>';
      dom.circuitReadout.innerHTML = '';
    } else if (expanded) {
      // One drawing of the whole circuit, shrunk if it is wider than the space it has.
      const width = LABEL_W + nCols * COL + READ_W;
      const whole = `${left}<g transform="translate(${LABEL_W} 0)">${mid}</g><g transform="translate(${LABEL_W + nCols * COL} 0)">${right}</g>`;
      dom.circuitLabels.innerHTML = '';
      dom.circuitGates.innerHTML = svg(width, `${picture} data-fit="1"`, whole);
      dom.circuitReadout.innerHTML = '';
    } else {
      dom.circuitLabels.innerHTML = svg(LABEL_W, 'aria-hidden="true"', left);
      dom.circuitGates.innerHTML = svg(nCols * COL, picture, mid);
      dom.circuitReadout.innerHTML = svg(READ_W, 'aria-hidden="true"', right);
    }
    const steps = snap.ops.map((op) => `<li>${esc(opWords(op, snap.labels))}</li>`).join('');
    const now = snap.labels.map((name, q) => `${name}: ${states[q].kind === 'definite' ? `state ${states[q].p1}` : `${states[q].kind}, ${pct(states[q].p1)} chance of state 1`}`).join('; ');
    dom.circuitDesc.innerHTML = n
      ? `${snap.ops.length ? `Circuit so far, ${snap.ops.length} steps:<ol>${steps}</ol>` : 'Circuit so far: no gates applied yet. '}State now: ${esc(now)}.`
      : 'No circuit here: there are no qubits on the terrace.';
    if (snap.ops.length !== lastOps) {
      dom.circuitGates.scrollLeft = expanded ? 0 : Math.max(0, (count + 1) * COL - dom.circuitGates.clientWidth);
      lastOps = snap.ops.length;
    }
    dom.code.textContent = snap.code;
    dom.stats.textContent = `${snap.stats.gates} gate${snap.stats.gates === 1 ? '' : 's'} · ${snap.stats.measurements} measurement${snap.stats.measurements === 1 ? '' : 's'} · depth ${snap.stats.depth}`;
  }

  function renderProbs(snap) {
    rows.forEach((r, q) => {
      const d = describe(snap, q);
      const p1 = snap.p1[q];
      r.seg0.style.width = `${(1 - p1) * 100}%`;
      r.seg1.style.width = `${p1 * 100}%`;
      r.row.className = `prob-row is-${d.kind}`;
      const names = ROLE_WORDS[r.role];
      const [zero, one] = shares([1 - p1, p1]);
      if (d.kind === 'definite') {
        r.text.textContent = names ? `${d.p1} · ${names[d.p1]} · 100%` : `${d.p1} · 100%`;
      } else {
        r.text.textContent = `0: ${zero}%  1: ${one}%`;
      }
      r.row.setAttribute(
        'aria-label',
        d.kind === 'definite'
          ? `${snap.labels[q]} is definitely in state ${d.p1}`
          : `${snap.labels[q]}: ${zero}% chance of state 0, ${one}% chance of state 1${d.kind === 'entangled' ? ', entangled' : ''}`
      );
    });
    dom.joint.innerHTML = snap.joint
      .map((j) => {
        const names = j.qubits.map((q) => snap.labels[q]);
        const head = names.map((name) => `<b>${esc(name)}</b>`).join('');
        const whole = shares(j.dist.map((row) => row.p));
        const body = j.dist
          .map(
            (row, i) =>
              `<div class="joint-row"><span class="bits">${row.bits
                .split('')
                .map((b) => `<i class="bit b${b}">${b}</i>`)
                .join('')}</span><span class="track"><span class="seg segj" style="width:${row.p * 100}%"></span></span><span class="prob-text">${whole[i]}%</span></div>`
          )
          .join('');
        return `<div class="joint"><p class="joint-title">Entangled: ${esc(names.join(', '))} collapse together</p><div class="joint-head"><span class="bits">${head}</span></div>${body}</div>`;
      })
      .join('');
  }

  // Expanded, the circuit moves under the game, where it has the full width.
  function setExpanded(on) {
    expanded = on;
    if (on) dom.dockPlay.closest('.left').appendChild(circuitModule);
    else home.parent.insertBefore(circuitModule, home.next);
    circuitModule.classList.toggle('is-expanded', on);
    dom.circuitExpand.textContent = on ? 'Collapse' : 'Expand';
    dom.circuitExpand.setAttribute('aria-expanded', on ? 'true' : 'false');
    lastOps = -1;
    if (level && lastSnap) renderCircuit(lastSnap);
  }
  dom.circuitExpand.addEventListener('click', (ev) => {
    setExpanded(!expanded);
    if (ev.detail > 0) dom.game.focus({ preventScroll: true }); // a mouse click hands the keys back to the game
  });

  function renderLog() {
    dom.log.innerHTML = log.length
      ? log.map((e) => `<li class="log-${e.kind}">${esc(e.text)}</li>`).join('')
      : '<li class="log-quiet">Nothing has happened yet.</li>';
  }

  return {
    setLevel,
    setHints,
    render(snap) {
      if (!level || !snap) return;
      lastSnap = snap;
      renderCircuit(snap);
      renderProbs(snap);
    },
    log(text, kind) {
      log.unshift({ text, kind: kind || 'info' });
      if (log.length > 8) log.length = 8;
      renderLog();
    },
  };
}
