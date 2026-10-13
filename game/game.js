// Blackout Lab: game state, platformer physics and the rules that connect the
// flashlight, the terminals, the canister and the doors to the quantum engine.
//
// The quantum state itself lives in Python (engine/quantum.py). This file only
// ever asks the engine to apply a gate, measure, or reset, and then moves the
// platforms to wherever the returned snapshot says they are.

import { LEVELS, TERRACE, WORLD, PLATFORM_H, LIVES_PER_FLOOR, GATE_INFO, ROLE_WORDS, roomsOf } from './levels.js';
import { TORCH, PLAYER, slotRect, doorRect, lockRect, screenRect, center, handOf, rectLit } from './geometry.js';
import { STORY } from './story.js';
import { createQuantum } from './quantum.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createRenderer } from './render.js';
import { createPanel, describe } from './panel.js';
import { createUI, grabDom } from './ui.js';

const PHYS = { speed: 190, accel: 2200, gravity: 1900, jump: 620, coyote: 0.09, buffer: 0.11, maxFall: 900, step: 1 / 120 };
const SELF_TEST_SHOTS = 200;
const SKIP_AFTER = 12;
const MIN_REMARK = 2.5;
const LONG_TOAST = 5.2;
const CRANK_X = TERRACE.scene.generator.x - 53;

// The terrace has no qubits, so the rack is handed an empty snapshot there.
const NO_QUBITS = {
  labels: [],
  init: [],
  p1: [],
  definite: [],
  bloch: [],
  purity: [],
  groups: [],
  joint: [],
  ops: [],
  code: '# No qubits on the terrace.',
  stats: { gates: 0, measurements: 0, noise: 0, depth: 0 },
};

const count = (n, one, many) => (n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`);
const list = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);
const esc = (s) => String(s).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
const overlap = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function startGame({ bridge, backend, backendName: givenName }) {
  let backendName = givenName;
  const dom = grabDom();
  const Q = createQuantum(bridge);
  const audio = createAudio();
  const renderer = createRenderer(dom.game);
  const panel = createPanel(dom);
  const input = createInput(dom.game, WORLD);

  const G = {
    mode: 'boot', // boot | title | loading | play | terminal | dialogue | cutscene | paused | falling | complete | over | win | error
    t: 0,
    epoch: 0,
    levelIndex: 0,
    level: null,
    q: null,
    qIndex: {},
    rooms: [],
    roomIndex: 0,
    room: null, // the room on screen
    platforms: [],
    door: null,
    canister: null,
    player: { x: 0, y: 0, vx: 0, vy: 0, facing: 1, onGround: false, coyote: 0, buffer: 0, anim: 0, standing: null, visible: true },
    torch: { on: true, active: false, lowered: false, angle: 0, tilt: 0.15, useMouse: false, battery: 'ok', flickT: 3, flickLeft: 0 },
    dialogue: null,
    bubbles: [],
    fx: [],
    floaters: [],
    shake: 0,
    lives: LIVES_PER_FLOOR,
    infinite: false,
    noiseOn: true,
    report: null,
    stats: null,
    results: [],
    hints: 0,
    engine: 'Qiskit',
    flags: {},
    floorTime: 0, // seconds of play on this attempt
    bonusDone: false,
    scene: null,
    pausedFrom: 'play',
    hasKey: false,
    busy: false,
    terminal: null,
    fallT: 0,
    bootWait: -1,
    calibrating: false,
    started: false,
  };

  const ui = createUI(dom, {
    start: () => startRun(),
    skip: () => startRun(),
    pause: () => pause(),
    resume: () => resume(),
    restart: () => restartFloor(),
    quit: () => toTitle(),
    next: () => nextFloor(),
    replay: () => loadLevel(G.levelIndex),
    retry: () => startRun(),
    home: () => toTitle(),
    errorRetry: () => loadLevel(G.levelIndex),
    skipTo: (index) => {
      audio.unlock();
      G.started = true;
      G.results = [];
      ui.showSkip(false);
      loadLevel(index);
    },
    jump: (index) => {
      G.started = true;
      loadLevel(index);
    },
    sound: () => toggleSound(),
    hint: () => showHint(),
    closeTerminal: () => closeTerminal(),
    applyOp: (i) => applyOp(i),
    option: (name, value) => setOption(name, value),
    touchHold: (action, down) => input.setHeld(action, down),
    touchTap: (action) => {
      input.setHeld(action, true);
      input.setHeld(action, false);
    },
  });
  ui.setFloors(LEVELS.map((level, i) => `${i + 1}. ${level.name}`), `Ending: ${TERRACE.name}`);

  // -- small helpers --------------------------------------------------------

  function say(text, kind, toastToo) {
    panel.log(text, kind);
    ui.announce(text);
    if (toastToo) {
      const look = kind === 'bad' ? 'bad' : kind === 'good' ? 'good' : kind === 'quantum' ? 'quantum' : 'info';
      ui.toast(text, look, typeof toastToo === 'number' ? toastToo : undefined);
    }
  }

  const LIVE_MODES = ['play', 'terminal', 'dialogue', 'cutscene'];
  function setMode(mode) {
    G.mode = mode;
    input.setEnabled(LIVE_MODES.includes(mode));
    ui.setPlaying(LIVE_MODES.includes(mode));
    input.clearPresses();
  }

  const roleOf = (qi) => G.level.qubits[qi].role;
  const carrying = () => !!(G.canister && G.canister.carried);
  const story = () => STORY[G.level.id] || {};

  function valueWords(qi, value) {
    const words = ROLE_WORDS[roleOf(qi)];
    return words ? `state ${value} (${words[value]})` : `state ${value}`;
  }

  function stateSentence(snap, qi) {
    const name = snap.labels[qi];
    const d = describe(snap, qi);
    const words = ROLE_WORDS[roleOf(qi)] || ['0', '1'];
    if (d.kind === 'definite') return `${name} is in ${valueWords(qi, d.p1)}.`;
    if (d.kind === 'entangled') return `${name} is entangled with ${list(d.partners.map((k) => snap.labels[k]))}: they will collapse together.`;
    return `${name} is in superposition ${d.ket}: ${Math.round((1 - d.p1) * 100)}% ${words[0]}, ${Math.round(d.p1 * 100)}% ${words[1]}.`;
  }

  function updateHud() {
    ui.setHud({
      floorText: (G.level && G.level.tag) || `Floor ${G.levelIndex + 1} of ${LEVELS.length}`,
      name: G.level ? G.level.name : '',
      lives: G.lives,
      maxLives: LIVES_PER_FLOOR,
      infinite: G.infinite,
      torch: G.level && G.level.outdoor ? 'ok' : G.torch.battery,
    });
  }

  function backendChip() {
    if (!G.report) return `${backendName} · ideal physics`;
    if (G.report.ideal) return `${G.report.backend} · no noise measured`;
    return `${G.report.backend} · CNOT error ${(G.report.p2 * 100).toFixed(1)}%${G.noiseOn ? '' : ' (off)'}`;
  }

  function addRing(pt, color, size) {
    if (pt) G.fx.push({ type: 'ring', x: pt.x, y: pt.y, t: 0, dur: 0.55, color, size });
  }

  function addFloater(pt, text, color) {
    if (pt) G.floaters.push({ x: pt.x, y: pt.y, text, color, t: 0, dur: 1.5 });
  }

  // -- story plumbing ---------------------------------------------------------

  // The player thinks out loud. A line already showing gets at least MIN_REMARK
  // seconds before the next one takes its place.
  function remark(text, extra) {
    const showing = G.bubbles.find((b) => b.anchor === 'player' && !(b.wait > 0));
    const wait = showing ? Math.max(0, MIN_REMARK - showing.t) : 0;
    if (showing) showing.dur = showing.t + wait;
    G.bubbles = G.bubbles.filter((b) => b.anchor !== 'player' || (b === showing && wait > 0));
    G.bubbles.push({ anchor: 'player', text, t: 0, wait, dur: Math.max(4.5, text.length * 0.075) + (extra || 0) });
    panel.log(`You: ${text}`, 'info');
    ui.announce(text);
  }

  function anchorNamed(at) {
    if (at && typeof at === 'object') return at;
    const npc = G.room.npcs.find((n) => n.id === at);
    if (npc) return { x: npc.x, y: npc.y - 44 };
    if (at === 'box') {
      const box = G.room.terminals.find((t) => t.box);
      if (box) return G.flags.opened ? { x: box.x + 3, y: box.y - 42 } : { x: box.x, y: box.y - 34 };
    }
    return null;
  }

  function bubble(at, text) {
    const anchor = anchorNamed(at);
    if (!anchor) return;
    G.bubbles.push({ anchor, text, t: 0, dur: Math.max(2.2, text.length * 0.07) });
    if (text.length > 12) panel.log(text, 'info');
  }

  function talkLines(speaker, lines, then, anchor) {
    G.dialogue = { speaker, lines, index: 0, then: then || null, anchor };
    setMode('dialogue');
    showLine();
  }

  function showLine() {
    const d = G.dialogue;
    const text = d.lines[d.index];
    const more = d.index < d.lines.length - 1;
    ui.setPrompt(`<b>${esc(d.speaker)}:</b> ${esc(text)} <span class="fine">${more ? 'E: next' : 'E: close'}</span>`);
    panel.log(`${d.speaker}: ${text}`, 'info');
    ui.announce(`${d.speaker}: ${text}`);
  }

  function advanceDialogue(skip) {
    const d = G.dialogue;
    if (!d) return;
    if (!skip && d.index < d.lines.length - 1) {
      d.index += 1;
      audio.play('click');
      showLine();
      return;
    }
    G.dialogue = null;
    setMode('play');
    if (d.then) d.then();
  }

  function storyCtx(npc) {
    const idx = (id) => G.qIndex[id];
    return {
      flags: G.flags,
      definite: (id) => G.q.definite[idx(id)],
      p1: (id) => G.q.p1[idx(id)],
      carrying: carrying(),
      doorOpen: !!(G.door && G.door.open),
      say: (who, lines, then) => talkLines(who, lines, then, npc ? { x: npc.x, y: npc.y - 44 } : 'player'),
      remark,
      bubble,
      setNote: (text) => ui.setNote(text),
      giveKey() {
        G.hasKey = true;
        if (G.door) {
          G.door.unlocked = true;
          G.door.open = true;
          addRing(center(doorRect(G.door)), '#7dffa8', 60);
        }
        audio.play('unlock');
        say('You have the key. The exit is unlocked.', 'good', true);
      },
      async measure(ids, by) {
        const epoch = G.epoch;
        const before = G.q;
        const res = await Q.measure(ids.map(idx), true, by);
        if (epoch !== G.epoch || !res.ok) return [];
        applySnapshot(res.state);
        reportCollapse(before, res.state, res.measured);
        if (by === 'box') {
          const r = res.state.definite[idx(ids[0])];
          say(r ? 'The box is open. The atom had decayed.' : 'The box is open. The atom is intact and the cat is alive.', r ? 'bad' : 'good');
        }
        return ids.map((id) => res.state.definite[idx(id)]);
      },
      restart: () => reprepare('The experiment was reset to its starting entanglement.'),
    };
  }

  async function reprepare(message) {
    const epoch = G.epoch;
    const reset = G.level.qubits.map((q, i) => (q.role === 'platform' ? -1 : i)).filter((i) => i >= 0);
    const res = await Q.auto(prepOps(), reset);
    if (epoch !== G.epoch || !res.ok) return;
    applySnapshot(res.state);
    if (message) say(message, 'info', true);
  }

  function prepOps() {
    return (G.level.prep || []).map((op) => ({ gate: op.gate, qubits: op.q.map((id) => G.qIndex[id]) }));
  }

  // -- floors ---------------------------------------------------------------

  function placePlayer(x, surfaceY) {
    const pl = G.player;
    pl.x = x;
    pl.y = surfaceY - PLAYER.h;
    pl.vx = 0;
    pl.vy = 0;
    pl.onGround = true;
    pl.standing = null;
    pl.visible = true;
  }

  function buildFloor(level) {
    G.level = level;
    G.qIndex = {};
    level.qubits.forEach((q, i) => {
      G.qIndex[q.id] = i;
    });
    const canQubit = level.qubits.find((q) => q.role === 'canister');
    G.canister = null;
    G.door = null;
    G.rooms = roomsOf(level).map((room) => {
      const built = {
        id: room.id,
        name: room.name,
        spawn: room.spawn,
        solids: room.solids,
        decor: room.decor || [],
        platforms: (room.platforms || []).map((p) => ({
          ...p,
          qi: G.qIndex[p.q],
          state: 0,
          p1: 0,
          y: p.y0,
          targetY: p.y0,
          flash: 0,
          exposure: 0,
          pending: false,
        })),
        terminals: (room.terminals || []).map((t) => {
          const surface = room.solids.find((s) => t.x >= s.x && t.x <= s.x + s.w && Math.abs(s.y - t.y) < 1);
          const fitsRight = surface ? t.x + 40 <= surface.x + surface.w : true;
          return {
            ...t,
            ops: t.ops.map((op) => ({ ...op, qi: op.q.map((id) => G.qIndex[id]), needsCanister: !!canQubit && op.q.includes(canQubit.id) })),
            sealedQi: t.sealed ? G.qIndex[t.sealed] : -1,
            cryoSide: fitsRight ? 1 : -1,
            near: false,
          };
        }),
        npcs: (room.npcs || []).map((n) => ({ ...n, near: false })),
        portals: (room.portals || []).map((p) => ({ ...p, near: false })),
        battery: room.battery ? { ...room.battery, taken: false } : null,
        door: null,
      };
      if (room.door) {
        built.door = {
          ...room.door,
          lockQi: room.door.lock.map((id) => G.qIndex[id]),
          open: !room.door.key && !room.door.item,
          unlocked: !room.door.key && !room.door.item,
          exposure: 0,
          armed: true,
          pending: false,
          lastRead: null,
          deniedT: 0,
          near: false,
        };
        G.door = built.door;
      }
      if (room.canister) G.canister = { ...room.canister, qi: G.qIndex[room.canister.q], carried: false, roomId: room.id };
      return built;
    });
    G.platforms = G.rooms.flatMap((r) => r.platforms);
    G.roomIndex = 0;
    G.room = G.rooms[0];
    placePlayer(G.room.spawn.x, G.room.spawn.y);
    G.player.facing = 1;
    G.fx = [];
    G.floaters = [];
    G.bubbles = [];
    G.dialogue = null;
    G.shake = 0;
    G.flags = {};
    G.floorTime = 0;
    G.bonusDone = false;
    G.scene = null;
    G.hasKey = false;
    G.torch.on = true;
    G.torch.tilt = 0.15;
    G.torch.battery = level.torch || 'ok';
    G.torch.flickT = 0.5; // a failing flashlight stutters as soon as the floor starts
    G.torch.flickLeft = 0;
    G.terminal = null;
    G.busy = false;
  }

  async function loadLevel(index, opts) {
    if (index >= LEVELS.length) return loadTerrace();
    const level = LEVELS[index];
    const epoch = (G.epoch += 1);
    const backdrop = !!(opts && opts.backdrop);
    const carry = opts && opts.carry;
    if (G.terminal) ui.closeTerminal();
    G.levelIndex = index;
    buildFloor(level);
    ui.setNote(null);
    if (!backdrop) setMode('loading');
    const res = await Q.loadLevel({ qubits: level.qubits.map((q) => ({ id: q.id, init: q.init })), prep: prepOps() });
    if (epoch !== G.epoch) return false;
    if (!res.ok) {
      setMode('error');
      ui.showError(`The quantum engine could not start this floor. ${res.error}`);
      return false;
    }
    const falls = carry && G.stats ? G.stats.falls : 0;
    G.stats = { gates: 0, looks: 0, unlucky: 0, denied: 0, falls, noise: 0 };
    if (!carry) {
      G.lives = LIVES_PER_FLOOR;
      G.hints = 0;
    }
    if (!backdrop) ui.setAbout(false);
    panel.setLevel(level, index, LEVELS.length);
    panel.setHints(G.hints);
    applySnapshot(res.state);
    updateHud();
    if (backdrop) return true;
    ui.showScreen(null);
    setMode('play');
    if (carry === 'fall') {
      say(`You fell. The floor reset to its starting state. Lives left: ${G.infinite ? 'unlimited' : G.lives}.`, 'bad', true);
    } else if (carry === 'restart') {
      say('Floor restarted: platforms and circuit are back to their starting states.', 'info', true);
    } else {
      say(`Floor ${index + 1}: ${level.name}. ${level.goal}`, 'info');
    }
    // The opening line is said every time the floor starts, restarts and falls included.
    for (const line of story().intro || []) remark(line, story().introHold);
    return true;
  }

  function applySnapshot(snap) {
    G.q = snap;
    for (const p of G.platforms) {
      const now = snap.definite[p.qi];
      p.p1 = snap.p1[p.qi];
      if (now === null) {
        if (p.state !== null) p.exposure = 0;
        p.state = null;
      } else {
        if (p.state === null) {
          p.y = now ? p.y1 : p.y0; // it materialises where it collapsed
          p.flash = 1;
        }
        p.state = now;
        p.targetY = now ? p.y1 : p.y0;
      }
    }
    panel.render(snap);
  }

  function enterRoom(portal) {
    const index = G.rooms.findIndex((r) => r.id === portal.to);
    if (index < 0) return;
    G.roomIndex = index;
    G.room = G.rooms[index];
    placePlayer(portal.arrive.x, portal.arrive.y);
    G.fx = [];
    G.floaters = [];
    G.bubbles = [];
    audio.play('click');
    say(`You step through the door into ${G.room.name}.`, 'info');
  }

  // -- terminals: gates ---------------------------------------------------

  function useTerminal(term) {
    if (term.port && !carrying()) {
      say(
        term.box
          ? 'The box has a canister port and nothing else. Bring the canister.'
          : `${term.id} is a dead terminal. Only its canister port works: bring the canister.`,
        'info',
        true
      );
      return;
    }
    G.terminal = term;
    setMode('terminal');
    ui.openTerminal(term, carrying());
    audio.play('click');
    ui.announce(`${term.id} open. ${term.ops.length} gate${term.ops.length === 1 ? '' : 's'} available.`);
  }

  function closeTerminal() {
    if (!G.terminal) return;
    G.terminal = null;
    ui.closeTerminal();
    setMode('play');
  }

  async function machineMeasure(term, op) {
    const epoch = G.epoch;
    const before = G.q;
    G.busy = true;
    ui.setTerminalBusy(true, carrying());
    const res = await Q.measure(op.qi, true, 'machine');
    G.busy = false;
    if (epoch !== G.epoch) return;
    ui.setTerminalBusy(false, carrying());
    if (!res.ok) {
      ui.setTerminalStatus(`The measurement failed. ${res.error}`, 'bad');
      return;
    }
    applySnapshot(res.state);
    reportCollapse(before, res.state, res.measured);
    const results = {};
    op.q.forEach((id, i) => {
      results[id] = res.state.definite[op.qi[i]];
    });
    const text = `The machine measured ${list(op.q.map((id) => `${id} = ${results[id]}`))}. Those are ordinary bits now.`;
    audio.play('collapse1');
    say(text, 'quantum');
    ui.setTerminalStatus(text, 'quantum');
    if (story().onMachine) story().onMachine(storyCtx(null), results);
  }

  function endsWith(snap, qi, gates) {
    const last = snap.ops.filter((op) => op.kind !== 'noise' && op.qubits.includes(qi)).slice(-gates.length);
    return last.length === gates.length && snap.definite[qi] !== null && last.every((op, i) => op.kind === 'gate' && op.gate === gates[i]);
  }

  async function applyOp(i) {
    const term = G.terminal;
    if (!term || G.busy || !term.ops[i]) return;
    const op = term.ops[i];
    if (op.needsCanister && !carrying()) {
      ui.setTerminalStatus('That gate acts on the canister qubit. Bring the canister here first.', 'bad');
      return;
    }
    if (op.gate === 'measure') {
      await machineMeasure(term, op);
      return;
    }
    const qis = op.qi;
    const target = qis[qis.length - 1];
    const epoch = G.epoch;
    const before = G.q;
    G.busy = true;
    ui.setTerminalBusy(true, carrying());
    const res = await Q.apply(op.gate, qis);
    G.busy = false;
    if (epoch !== G.epoch) return;
    ui.setTerminalBusy(false, carrying());
    if (!res.ok) {
      ui.setTerminalStatus(`That gate did not go through. ${res.error}`, 'bad');
      return;
    }
    G.stats.gates += 1;
    applySnapshot(res.state);
    const bonus = G.level.bonus;
    if (bonus && bonus.sequences && bonus.sequences.some((s) => target === G.qIndex[s.q] && endsWith(res.state, target, s.gates))) G.bonusDone = true;

    const from = center(screenRect(term));
    const to = renderer.anchorOf(G, target);
    if (to) G.fx.push({ type: 'spark', from, to, t: 0, dur: 0.45, color: op.gate === 'cx' ? '#ff8adf' : '#5ee6ff' });
    const wasDefinite = before.definite[target] !== null;
    const nowDefinite = res.state.definite[target] !== null;
    audio.play(wasDefinite && !nowDefinite ? 'superpose' : 'gate');

    const info = GATE_INFO[op.gate];
    const what = op.gate === 'cx' ? `CNOT ${op.q[0]} to ${op.q[1]}` : `${info.symbol} on ${op.q[0]}`;
    let text = `${what}. ${stateSentence(res.state, target)}`;
    if (op.gate === 'z' && !nowDefinite) text = `${what}. The odds did not move, but the phase flipped. ${stateSentence(res.state, target)}`;
    if (op.gate === 'cx' && wasDefinite && nowDefinite && before.definite[target] === res.state.definite[target]) {
      text = `${what}. ${op.q[0]} is in state 0, so nothing flipped. ${stateSentence(res.state, target)}`;
    }
    say(text, nowDefinite ? 'info' : 'quantum');
    ui.setTerminalStatus(text, nowDefinite ? '' : 'quantum');

    if (res.glitch) {
      G.stats.noise += 1;
      const g = res.glitch;
      const note = `Hardware noise: a stray ${g.pauli.toUpperCase()} error hit ${g.label}. Real quantum computers do this; it is not your mistake. ${stateSentence(res.state, g.qubit)}`;
      say(note, 'bad', true);
      ui.setTerminalStatus(note, 'bad');
      addRing(renderer.anchorOf(G, g.qubit), '#ff8585', 40);
      audio.play('glitch');
    }
  }

  // -- measurement: flashlight and locks ---------------------------------------

  function reportCollapse(before, snap, measured) {
    const seen = new Set(measured.map((e) => e.qubit));
    for (const e of measured) {
      if (!e.random) continue;
      if (e.by === 'torch') G.stats.looks += 1;
      const platform = G.platforms.find((p) => p.qi === e.qubit);
      const pt = renderer.anchorOf(G, e.qubit);
      addRing(pt, '#ffd98a', 52);
      addFloater(pt, `${e.label} → ${e.result}`, e.result ? '#ffd98a' : '#8fb3ff');
      audio.play(e.result ? 'collapse1' : 'collapse0');
      G.shake = 0.5;
      if (platform && platform.need !== e.result) G.stats.unlucky += 1;
      const value = valueWords(e.qubit, e.result);
      let text = `${e.label} was measured: it collapsed to ${value}.`;
      if (e.by === 'torch') text = `Flashlight on ${e.label}: it collapsed to ${value}.`;
      if (e.by === 'lock') text = `The lock observed ${e.label}: it collapsed to ${value}.`;
      const partners = [];
      for (let q = 0; q < snap.definite.length; q += 1) {
        if (!seen.has(q) && before.definite[q] === null && snap.definite[q] !== null) {
          partners.push(q);
          seen.add(q);
          addRing(renderer.anchorOf(G, q), '#ff8adf', 40);
          addFloater(renderer.anchorOf(G, q), `${snap.labels[q]} → ${snap.definite[q]}`, '#ff8adf');
        }
      }
      if (partners.length) {
        text += ` Entangled partner${partners.length > 1 ? 's' : ''} collapsed with it: ${list(partners.map((q) => `${snap.labels[q]} = ${snap.definite[q]}`))}.`;
      }
      say(text, 'quantum');
    }
  }

  async function observe(platforms, by) {
    const epoch = G.epoch;
    const before = G.q;
    for (const p of platforms) p.pending = true;
    const res = await Q.measure(platforms.map((p) => p.qi), false, by);
    if (epoch !== G.epoch) return;
    for (const p of platforms) {
      p.pending = false;
      p.exposure = 0;
    }
    if (!res.ok) {
      ui.toast(`The measurement failed. ${res.error}`, 'bad');
      return;
    }
    applySnapshot(res.state);
    reportCollapse(before, res.state, res.measured);
  }

  function updateTorch(dt) {
    const pl = G.player;
    const t = G.torch;
    const dead = t.battery === 'dead';
    if (input.pointer.moved) {
      t.useMouse = true;
      input.pointer.moved = false;
    }
    if (G.mode === 'play') {
      const tilt = (input.held.tiltUp ? 1 : 0) - (input.held.tiltDown ? 1 : 0);
      if (tilt) {
        t.useMouse = false;
        t.tilt = Math.max(-1.35, Math.min(1.35, t.tilt + tilt * 1.2 * dt));
      }
      if (input.take('torch')) {
        if (dead) {
          if (story().onDeadTorch) story().onDeadTorch(storyCtx(null));
        } else {
          t.on = !t.on;
          audio.play('click');
          ui.announce(t.on ? 'Flashlight on.' : 'Flashlight off.');
        }
      }
      if (t.useMouse) {
        const hand = handOf(pl);
        const dx = input.pointer.x - hand.x;
        const dy = input.pointer.y - hand.y;
        if (Math.hypot(dx, dy) > 6) {
          if (Math.abs(dx) > 8) pl.facing = dx >= 0 ? 1 : -1;
          t.angle = Math.atan2(dy, dx);
        }
      } else {
        t.angle = pl.facing > 0 ? -t.tilt : Math.PI + t.tilt;
      }
    }
    let blink = false;
    if (t.battery === 'low' && G.mode === 'play') {
      t.flickT -= dt;
      if (t.flickT <= 0) {
        t.flickLeft = 0.5;
        t.flickT = 2.6 + Math.random() * 3;
      }
      if (t.flickLeft > 0) {
        t.flickLeft -= dt;
        blink = Math.sin(t.flickLeft * 55) > -0.1;
      }
    }
    t.lowered = G.mode !== 'play';
    t.active = t.on && !t.lowered && !dead && !blink;

    if (G.mode !== 'play' || !G.q) return;
    const hand = handOf(pl);
    const ready = [];
    for (const p of G.room.platforms) {
      if (p.state !== null || p.pending) {
        if (p.state !== null) p.exposure = 0;
        continue;
      }
      const lit = t.active && (rectLit(hand, t.angle, slotRect(p, 0)) || rectLit(hand, t.angle, slotRect(p, 1)));
      p.exposure = lit ? p.exposure + dt : 0;
      if (p.exposure >= TORCH.dwell) ready.push(p);
    }
    if (ready.length) observe(ready, 'torch');
  }

  // -- the exit -----------------------------------------------------------------

  async function tryDoor() {
    const d = G.door;
    const epoch = G.epoch;
    if (d.pending || d.unlocked) return;
    d.pending = true;
    let snap = G.q;
    const bitsOf = (s) => d.lockQi.map((q) => (s.definite[q] === null ? '?' : s.definite[q])).join('');
    if (d.check || bitsOf(snap).includes('?') || bitsOf(snap) !== d.lastRead) {
      if (d.check) {
        const res = await Q.auto(d.check.map((op) => ({ gate: op.gate, qubits: op.q.map((id) => G.qIndex[id]) })));
        if (epoch !== G.epoch) return;
        if (res.ok) applySnapshot(res.state);
      }
      const before = G.q;
      const res = await Q.measure(d.lockQi, true, 'lock');
      if (epoch !== G.epoch) return;
      if (!res.ok) {
        d.pending = false;
        ui.toast(`The lock could not be read. ${res.error}`, 'bad');
        return;
      }
      applySnapshot(res.state);
      reportCollapse(before, res.state, res.measured);
      snap = res.state;
    }
    const bits = bitsOf(snap);
    const spaced = (s) => s.split('').join(' ');
    d.lastRead = bits;
    if (bits === d.key) {
      d.unlocked = true;
      d.open = true;
      audio.play('unlock');
      addRing(center(lockRect(d)), '#7dffa8', 60);
      say(`The lock read ${spaced(bits)}. Key accepted: the exit is open.`, 'good', true);
    } else {
      G.stats.denied += 1;
      d.deniedT = 1.2;
      audio.play('denied');
      if (d.reprep) {
        say(`The lock read ${spaced(bits)} but needs ${spaced(d.key)}. Refused, and the key was used up. A fresh one is being prepared: the whole transfer has to be done again.`, 'bad', true);
        if (story().onRefused) story().onRefused(storyCtx(null));
        await reprepare(null);
        if (epoch !== G.epoch) return;
        d.lastRead = null;
      } else {
        const ones = d.lockQi.filter((q) => snap.definite[q] === 1);
        say(`The lock read ${spaced(bits)} but the key is ${spaced(d.key)}. Refused${ones.length ? ', and the lamps were reset to state 0' : ''}.`, 'bad', true);
        if (ones.length) {
          const res = await Q.reset(ones);
          if (epoch !== G.epoch) return;
          if (res.ok) {
            applySnapshot(res.state);
            d.lastRead = bitsOf(res.state);
          }
        }
      }
    }
    d.pending = false;
  }

  function updateDoor(dt) {
    const d = G.room.door;
    if (!d) return;
    const pl = G.player;
    if (d.deniedT > 0) d.deniedT -= dt;
    if (d.key && !d.unlocked && !d.byHand) {
      const lit = G.torch.active && rectLit(handOf(pl), G.torch.angle, lockRect(d));
      if (!lit) {
        d.exposure = 0;
        d.armed = true;
      } else if (d.armed && !d.pending) {
        d.exposure += dt;
        if (d.exposure >= TORCH.dwell) {
          d.armed = false;
          d.exposure = 0;
          tryDoor();
        }
      }
    }
    if (d.open && pl.onGround && overlap({ x: pl.x, y: pl.y, w: PLAYER.w, h: PLAYER.h }, doorRect(d))) completeFloor();
  }

  // -- things in reach --------------------------------------------------------------

  function findInteract() {
    const pl = G.player;
    const room = G.room;
    for (const t of room.terminals) t.near = false;
    for (const n of room.npcs) n.near = false;
    for (const p of room.portals) p.near = false;
    if (room.door) room.door.near = false;
    if (!pl.onGround) return null;
    const cx = pl.x + PLAYER.w / 2;
    const feet = pl.y + PLAYER.h;
    let best = null;
    const offer = (type, obj, x, y, reach) => {
      if (Math.abs(feet - y) > 6) return;
      const d = Math.abs(cx - x);
      if (d < reach && (!best || d < best.d)) best = { type, obj, d };
    };
    for (const t of room.terminals) offer(t.box && G.flags.opened ? 'cat' : 'terminal', t, t.x, t.y, 26);
    for (const n of room.npcs) offer('npc', n, n.x, n.y, 34);
    for (const p of room.portals) offer('portal', p, p.x, p.y, 22);
    const d = room.door;
    if (d && d.key && !d.unlocked) {
      const left = lockRect(d).x;
      const right = d.x + 22;
      offer('lock', d, (left + right) / 2, d.y, (right - left) / 2 + 8);
    }
    if (best) best.obj.near = true;
    return best;
  }

  function pickUps() {
    const pl = G.player;
    const cx = pl.x + PLAYER.w / 2;
    const feet = pl.y + PLAYER.h;
    const c = G.canister;
    if (c && !c.carried && c.roomId === G.room.id && Math.abs(cx - c.x) < 16 && Math.abs(feet - c.y) < 8) {
      c.carried = true;
      audio.play('gate');
      say(`You picked up the canister. It holds the sealed qubit ${c.q}.`, 'info', LONG_TOAST);
      if (story().onCanister) story().onCanister(storyCtx(null));
    }
    const b = G.room.battery;
    if (!b || b.taken) return;
    if (b.diesOnArrival && G.torch.battery === 'low' && pl.onGround && Math.abs(feet - b.y) < 2) {
      G.torch.battery = 'dead';
      audio.play('denied');
      updateHud();
      panel.log('Your flashlight has died.', 'bad');
      if (story().onBatteryDead) story().onBatteryDead(storyCtx(null));
    }
    if (Math.abs(cx - b.x) < 18 && Math.abs(feet - b.y) < 8) {
      b.taken = true;
      G.torch.battery = 'ok';
      G.torch.on = true;
      audio.play('unlock');
      say('New battery fitted. The flashlight is steady again.', 'good', LONG_TOAST);
      updateHud();
      if (story().onBattery) story().onBattery(storyCtx(null));
    }
  }

  function petCat() {
    const at = anchorNamed('box');
    if (!at) return;
    audio.play('meow');
    G.bubbles = G.bubbles.filter((b) => !b.cat);
    G.bubbles.push({ anchor: at, text: '*meow*', cat: true, t: 0, dur: 1.8 });
    panel.log('You pet the cat. Meow.', 'info');
    ui.announce('Meow.');
  }

  // -- platformer physics -----------------------------------------------------

  function slabs() {
    const out = [];
    for (const s of G.room.solids) if (s.kind === 'stand') out.push(s);
    for (const p of G.room.platforms) if (p.state !== null) out.push({ x: p.x, y: p.y, w: p.w, h: PLATFORM_H, platform: p });
    return out;
  }

  function physicsStep(dt) {
    const pl = G.player;
    for (const p of G.platforms) {
      if (p.state === null) continue;
      const before = p.y;
      const gap = p.targetY - p.y;
      p.y += Math.sign(gap) * Math.min(Math.abs(gap), 300 * dt);
      if (pl.standing === p) pl.y += p.y - before;
    }
    const want = G.mode === 'play' ? (input.held.right ? 1 : 0) - (input.held.left ? 1 : 0) : 0;
    const targetV = want * PHYS.speed;
    const dv = targetV - pl.vx;
    pl.vx += Math.sign(dv) * Math.min(Math.abs(dv), PHYS.accel * dt);
    if (want && !G.torch.useMouse) pl.facing = want;
    if (Math.abs(pl.vx) > 5) pl.anim += dt;

    pl.coyote = pl.onGround ? PHYS.coyote : pl.coyote - dt;
    pl.buffer -= dt;
    if (G.mode === 'play' && input.take('jump')) pl.buffer = PHYS.buffer;
    if (pl.buffer > 0 && pl.coyote > 0) {
      pl.vy = -PHYS.jump;
      pl.buffer = 0;
      pl.coyote = 0;
      pl.onGround = false;
      pl.standing = null;
      audio.play('jump');
    }
    pl.vy = Math.min(PHYS.maxFall, pl.vy + PHYS.gravity * dt);

    pl.x += pl.vx * dt;
    for (const s of G.room.solids) {
      if (s.kind !== 'ground') continue;
      if (overlap({ x: pl.x, y: pl.y, w: PLAYER.w, h: PLAYER.h - 1 }, s)) {
        pl.x = pl.vx > 0 ? s.x - PLAYER.w : s.x + s.w;
        pl.vx = 0;
      }
    }
    pl.x = Math.max(0, Math.min((G.level.outdoor ? CRANK_X + PLAYER.w / 2 : WORLD.w) - PLAYER.w, pl.x));

    const feetBefore = pl.y + PLAYER.h;
    const wasOnGround = pl.onGround;
    pl.y += pl.vy * dt;
    pl.onGround = false;
    pl.standing = null;
    for (const s of G.room.solids) {
      if (s.kind !== 'ground') continue;
      if (overlap({ x: pl.x, y: pl.y, w: PLAYER.w, h: PLAYER.h }, s)) {
        if (pl.vy >= 0 && feetBefore <= s.y + 2) {
          pl.y = s.y - PLAYER.h;
          pl.onGround = true;
          pl.vy = 0;
        } else if (pl.vy < 0) {
          pl.y = s.y + s.h;
          pl.vy = 0;
        }
      }
    }
    if (pl.vy >= 0 && !pl.onGround) {
      const feet = pl.y + PLAYER.h;
      for (const s of slabs()) {
        if (pl.x + PLAYER.w > s.x && pl.x < s.x + s.w && feetBefore <= s.y + 2 && feet >= s.y) {
          pl.y = s.y - PLAYER.h;
          pl.vy = 0;
          pl.onGround = true;
          pl.standing = s.platform || null;
          break;
        }
      }
    }
    if (pl.onGround && !wasOnGround) audio.play('land');
  }

  function loseLife() {
    audio.play('fall');
    G.stats.falls += 1;
    if (!G.infinite) G.lives -= 1;
    G.player.visible = false;
    G.fallT = 0.7;
    updateHud();
    setMode('falling');
  }

  function afterFall() {
    if (G.lives <= 0 && !G.infinite) {
      setMode('over');
      ui.showScreen('over');
      ui.announce('Out of lives. You start again from floor 1.');
      return;
    }
    loadLevel(G.levelIndex, { carry: 'fall' });
  }

  // -- flow -------------------------------------------------------------------

  function completeFloor() {
    if (G.mode !== 'play') return;
    const level = G.level;
    const s = G.stats;
    const earned = [
      { got: true, text: 'Reached the exit' },
      { got: s.falls === 0, text: 'No falls' },
      { got: G.hints === 0, text: 'No hints' },
    ];
    const bonus = level.bonus;
    if (bonus) earned.push({ got: bonus.seconds ? G.floorTime <= bonus.seconds : G.bonusDone, text: bonus.text });
    const stars = earned.filter((e) => e.got).length;
    const of = earned.length;
    G.results[G.levelIndex] = { stars, of, ...s, hints: G.hints };
    const last = G.levelIndex === LEVELS.length - 1;
    setMode('complete');
    audio.play(last ? 'win' : 'unlock');
    const parts = [
      `${count(s.gates, 'gate', 'gates')} (fewest possible: ${level.shortest})`,
      count(s.looks, 'observation', 'observations'),
      count(s.unlucky, 'unlucky collapse', 'unlucky collapses'),
    ];
    if (bonus && bonus.seconds) {
      const secs = Math.round(G.floorTime);
      parts.push(`time ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`);
    }
    if (s.noise) parts.push(`${s.noise} noise error${s.noise === 1 ? '' : 's'}`);
    ui.showComplete({
      name: level.name,
      index: G.levelIndex,
      total: LEVELS.length,
      stars,
      of,
      earned,
      takeaway: level.takeaway,
      stats: `${parts.join(' · ')}.`,
      last,
    });
    ui.announce(`Floor ${G.levelIndex + 1} cleared with ${stars} of ${of} stars. ${level.takeaway}`);
  }

  function nextFloor() {
    loadLevel(G.levelIndex + 1);
  }

  // -- the terrace: an epilogue with no qubits ---------------------------------

  function loadTerrace() {
    const s = TERRACE.scene;
    G.epoch += 1;
    if (G.terminal) ui.closeTerminal();
    G.levelIndex = LEVELS.length;
    buildFloor(TERRACE);
    ui.setNote(null);
    ui.setAbout(false);
    G.stats = { gates: 0, looks: 0, unlucky: 0, denied: 0, falls: 0, noise: 0 };
    G.lives = LIVES_PER_FLOOR;
    G.hints = 0;
    const walker = (id, name, delay) => ({ id, kind: id, name, x: s.door.x, target: s.line[id], delay, out: false, moving: false, anim: 0 });
    G.scene = {
      phase: 'walk', // walk | crank | power | arrive | talk1 | talk2 | meow | gone | fade
      t: 0,
      crank: 0, // angle of the crank handle
      tick: 0,
      fromX: 0,
      power: 0,
      fade: 0,
      doorOpen: false,
      alarm: false,
      near: false,
      skip: false,
      rest: 0,
      line: null,
      actors: [walker('professor', 'Professor', 0.5), walker('bob', 'Bob', 1.5), walker('alice', 'Alice', 2.5)],
      cat: { x: s.door.x, y: s.door.y, target: s.line.cat, delay: 3.5, state: 'inside', vy: 0, anim: 0 },
    };
    panel.setLevel(TERRACE, G.levelIndex, LEVELS.length);
    applySnapshot(NO_QUBITS);
    updateHud();
    ui.showScreen(null);
    setMode('play');
    say(`${TERRACE.name}. ${TERRACE.goal}`, 'info');
    return true;
  }

  function scenePhase(phase) {
    G.scene.phase = phase;
    G.scene.t = 0;
    G.scene.skip = false;
  }

  function sceneLine(who, text, follow) {
    G.scene.line = { who, text, follow };
    ui.setPrompt(`<b>${esc(who)}:</b> ${esc(text)}`);
    panel.log(`${who}: ${text}`, 'info');
    ui.announce(`${who}: ${text}`);
  }

  function updateTerrace(dt) {
    const sc = G.scene;
    const s = TERRACE.scene;
    const pl = G.player;
    if (input.take('pause')) {
      pause();
      return;
    }
    if (input.take('restart')) {
      restartFloor();
      return;
    }
    input.take('hint');
    input.take('torch');
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(PHYS.step, left);
      physicsStep(step);
      left -= step;
    }
    G.torch.active = false;
    G.torch.lowered = true;
    if (G.mode === 'play' && Math.abs(pl.vx) > 5) pl.facing = Math.sign(pl.vx);
    const used = input.take('use');
    const skip = G.mode === 'cutscene' && (used || input.take('jump') || sc.skip);
    sc.skip = false;
    sc.t += dt;
    if (sc.phase !== 'walk' && sc.phase !== 'crank') sc.crank += dt * 11; // the flywheel keeps spinning

    if (sc.phase === 'walk') {
      sc.near = pl.onGround && pl.x + PLAYER.w / 2 > CRANK_X - 30;
      if (sc.near && used) {
        setMode('cutscene');
        scenePhase('crank');
        sc.near = false;
        sc.fromX = pl.x;
        pl.vx = 0;
        pl.facing = 1;
        say('You lean into the crank of the generator.', 'info');
        ui.setPrompt('You lean into the crank.');
      } else {
        ui.setPrompt(sc.near ? 'Press <b>E</b> to crank the generator.' : esc(TERRACE.goal));
      }
    } else if (sc.phase === 'crank') {
      pl.x = sc.fromX + (CRANK_X - PLAYER.w / 2 - sc.fromX) * Math.min(1, sc.t / 0.25);
      sc.crank += dt * (4 + sc.t * 3.5);
      sc.tick -= dt;
      if (sc.tick <= 0) {
        audio.play('crank');
        sc.tick = Math.max(0.12, 0.34 - sc.t * 0.09);
      }
      if (sc.t >= 2.4) {
        scenePhase('power');
        audio.play('power');
        say('The generator catches. The lights are coming back on.', 'good', true);
        ui.setPrompt('The generator catches. The lights are coming back on.');
      }
    } else if (sc.phase === 'power') {
      sc.power = Math.min(1, sc.t / 2.2);
      if (sc.t >= 3.2) {
        scenePhase('arrive');
        sc.doorOpen = true;
        pl.facing = -1;
        audio.play('click');
        say('The stair door opens. The Professor, Bob, Alice and the cat come out onto the terrace.', 'info');
        ui.setPrompt('Someone is coming up the stairs.');
      }
    } else if (sc.phase === 'arrive') {
      let settled = true;
      for (const a of sc.actors) {
        if (sc.t < a.delay) {
          settled = false;
          continue;
        }
        a.out = true;
        const gap = a.target - a.x;
        const move = Math.min(Math.abs(gap), 125 * dt);
        a.moving = move > 0.001;
        a.x += Math.sign(gap) * move;
        if (a.moving) {
          a.anim += dt;
          settled = false;
        }
      }
      const cat = sc.cat;
      if (sc.t >= cat.delay && cat.state !== 'sit') {
        cat.state = 'trot';
        const move = Math.min(cat.target - cat.x, 190 * dt);
        cat.x += move;
        cat.anim += dt;
        if (move <= 0.001) cat.state = 'sit';
      }
      if (cat.state !== 'sit') settled = false;
      sc.rest = settled ? sc.rest + dt : 0;
      if (sc.rest > 0.6) {
        scenePhase('talk1');
        sceneLine('Professor', 'You restored power! Hurray!', 'professor');
      }
    } else if (sc.phase === 'talk1') {
      if (sc.t >= 3.4 || skip) {
        scenePhase('talk2');
        sceneLine('Alice', 'Can we now test the cat teleportation protocol?', 'alice');
      }
    } else if (sc.phase === 'talk2') {
      if (sc.t >= 4.4 || skip) {
        scenePhase('meow');
        audio.play('meow');
        sceneLine('Cat', 'MEOW', 'cat');
      }
    } else if (sc.phase === 'meow') {
      const cat = sc.cat;
      pl.facing = cat.x > pl.x ? 1 : -1; // everyone watches her go
      if (cat.state === 'sit' && sc.t >= 1.1) cat.state = 'run';
      if (cat.state === 'run') {
        cat.x += 300 * dt;
        cat.anim += dt;
        if (cat.x >= s.edge - 150) sc.alarm = true;
        if (cat.x >= s.edge - 46) {
          cat.state = 'jump';
          cat.vy = -430;
          audio.play('jump');
        }
      } else if (cat.state === 'jump') {
        cat.x += 230 * dt;
        cat.vy += 1100 * dt;
        cat.y += cat.vy * dt;
        cat.anim += dt;
        if (cat.y > s.door.y + 20) sc.line = null;
        if (cat.y > WORLD.h + 40) {
          cat.state = 'gone';
          scenePhase('gone');
          panel.log('The cat has had enough of being experimented on.', 'info');
          ui.announce('The cat jumps off the roof. The cat has had enough of being experimented on.');
          ui.setPrompt('The cat has had enough of being experimented on.');
        }
      }
    } else if (sc.phase === 'gone') {
      if (sc.t >= 1.3) scenePhase('fade');
    } else if (sc.phase === 'fade') {
      sc.fade = Math.min(1, sc.t / 1.8);
      if (sc.t >= 2.3) finishEnding();
    }
  }

  function finishEnding() {
    const done = G.results.filter(Boolean);
    const sum = (key) => done.reduce((total, r) => total + (r[key] || 0), 0);
    const run = done.length
      ? `${count(sum('gates'), 'gate', 'gates')}, ${count(sum('looks'), 'observation', 'observations')} and ${count(sum('falls'), 'fall', 'falls')} across the ${done.length} of ${LEVELS.length} floors you cleared. `
      : '';
    // Stars are counted against the whole game, so a skipped floor shows as stars not earned.
    const possible = LEVELS.reduce((n, level) => n + 3 + (level.bonus ? 1 : 0), 0);
    setMode('win');
    audio.play('win');
    ui.showWin({
      stars: sum('stars'),
      of: done.length ? possible : 0,
      stats: `${run}Physics: ${G.engine}. Self-test backend: ${G.report ? G.report.backend : 'not run'}.`,
    });
    ui.announce('Thank you for playing.');
  }

  function startRun() {
    audio.unlock();
    G.started = true;
    G.results = [];
    ui.showSkip(false);
    loadLevel(0);
  }

  function restartFloor() {
    if (!['play', 'terminal', 'dialogue', 'cutscene', 'paused'].includes(G.mode)) return;
    loadLevel(G.levelIndex, { carry: 'restart' });
  }

  function pause() {
    if (G.mode === 'terminal') closeTerminal();
    if (G.mode !== 'play' && G.mode !== 'cutscene') return;
    G.pausedFrom = G.mode;
    setMode('paused');
    ui.setOptions({ lives: G.infinite, noise: G.noiseOn, floor: G.levelIndex });
    ui.showScreen('pause');
  }

  function resume() {
    if (G.mode !== 'paused') return;
    ui.showScreen(null);
    setMode(G.pausedFrom);
  }

  async function toTitle() {
    const fromRoof = !!(G.level && G.level.outdoor);
    G.epoch += 1;
    setMode('title');
    ui.showScreen('title');
    ui.setAbout(true);
    ui.setPrompt('The lab is ready. Enter the building when you are.');
    if (!fromRoof) return;
    await loadLevel(0, { backdrop: true });
    G.torch.active = true;
    G.torch.angle = -0.22;
  }

  function toggleSound() {
    const muted = !audio.isMuted();
    audio.setMuted(muted);
    ui.setSound(!muted);
  }

  function showHint() {
    if (!G.level || G.hints >= G.level.hints.length) return;
    G.hints += 1;
    panel.setHints(G.hints);
    ui.announce(`Hint ${G.hints}: ${G.level.hints[G.hints - 1]}`);
  }

  async function setOption(name, value) {
    if (name === 'lives') {
      G.infinite = value;
      updateHud();
    } else if (name === 'noise') {
      G.noiseOn = value;
      await Q.setNoise(value);
      ui.setHud({ backendText: backendChip() });
    }
  }

  function interactPrompt(hit) {
    if (!hit) return '';
    if (hit.type === 'npc') return `Press <b>E</b> to talk to ${esc(hit.obj.name)}.`;
    if (hit.type === 'portal') return `Press <b>E</b> to go through the door marked ${esc(hit.obj.label)}.`;
    if (hit.type === 'lock') return 'Press <b>E</b> to try the lock.';
    if (hit.type === 'cat') return 'Press <b>E</b> to pet the cat.';
    const term = hit.obj;
    if (term.port && !carrying()) {
      return term.box ? 'The box has a canister port. You need the canister.' : `${esc(term.id)}: a dead terminal with a working canister port. You need the canister.`;
    }
    return `Press <b>E</b> to use ${term.port ? esc(term.id) : `terminal ${esc(term.id)}`}.`;
  }

  function updatePrompt(hit) {
    if (G.mode !== 'play') return;
    const ghosts = G.room.platforms.filter((p) => p.state === null);
    const lit = ghosts.find((p) => p.exposure > 0);
    const ghost = ghosts[0];
    const d = G.room.door;
    const act = interactPrompt(hit);
    const orAct = act ? ` ${act}` : '';
    const station = G.room.battery;
    if (lit) ui.setPrompt(`Observing <b>${lit.q}</b>. Hold the light steady.`);
    else if (station && !station.taken && G.torch.battery === 'dead') {
      ui.setPrompt(`Your flashlight is dead. The <b>battery station</b> is at the left end of this ledge: walk up to it.${orAct}`);
    } else if (act && !ghost) ui.setPrompt(act);
    else if (ghost && G.torch.battery === 'dead') ui.setPrompt(`<b>${ghost.q}</b> is in superposition and you have no light to observe it. Make it certain with gates.${orAct}`);
    else if (ghost && !G.torch.on) ui.setPrompt(`<b>${ghost.q}</b> is in superposition and your flashlight is off. <b>F</b> switches it on.${orAct}`);
    else if (ghost) ui.setPrompt(`<b>${ghost.q}</b> is in superposition. Aim the flashlight at a dotted outline to observe it (mouse, or <b>I</b> / <b>K</b>).${orAct}`);
    else if (d && d.item && !d.open && G.player.x > d.x - 220) ui.setPrompt('The exit is locked, and this lock takes an ordinary key.');
    else if (d && d.key && !d.unlocked && G.player.x > d.x - 220) {
      const byHand = d.byHand || G.torch.battery === 'dead';
      ui.setPrompt(
        byHand
          ? 'The exit is locked. Press <b>E</b> at the <b>lock panel</b> to test the key.'
          : 'The exit is locked. Shine the flashlight on the <b>lock panel</b> beside it, or press <b>E</b> there.'
      );
    }
    else if (d && d.open && (d.key || d.item)) ui.setPrompt('The exit is open. Walk through it.');
    else ui.setPrompt(esc(station && station.taken && G.level.goalAfterBattery ? G.level.goalAfterBattery : G.level.goal));
  }

  function update(dt) {
    G.t += dt;
    if (G.mode === 'play' || G.mode === 'terminal' || G.mode === 'dialogue') G.floorTime += dt;
    for (const fx of G.fx) fx.t += dt;
    for (const f of G.floaters) f.t += dt;
    for (const b of G.bubbles) {
      if (b.wait > 0) b.wait -= dt;
      else b.t += dt;
    }
    G.fx = G.fx.filter((fx) => fx.t < fx.dur);
    G.floaters = G.floaters.filter((f) => f.t < f.dur);
    G.bubbles = G.bubbles.filter((b) => b.t < b.dur);
    G.shake = Math.max(0, G.shake - dt * 3);
    for (const p of G.platforms) p.flash = Math.max(0, p.flash - dt * 2.2);

    if (G.mode === 'boot' && G.calibrating) {
      G.bootWait += dt;
      if (G.bootWait > SKIP_AFTER) ui.showSkip(true);
    }
    if (input.take('mute')) toggleSound();

    if (G.mode === 'falling') {
      G.fallT -= dt;
      if (G.fallT <= 0) afterFall();
      return;
    }
    if (G.mode === 'paused') {
      if (input.take('pause')) resume();
      return;
    }
    if (G.mode === 'terminal') {
      if (input.take('use')) closeTerminal();
      input.take('pause'); // only E leaves a terminal
      updateTorch(dt);
      return;
    }
    if (G.mode === 'dialogue') {
      if (input.take('pause')) advanceDialogue(true);
      else if (input.take('use') || input.take('jump')) advanceDialogue(false);
      updateTorch(dt);
      return;
    }
    if (G.level && G.level.outdoor && (G.mode === 'play' || G.mode === 'cutscene')) {
      updateTerrace(dt);
      return;
    }
    if (G.mode !== 'play' || !G.level) return;

    if (input.take('pause')) {
      pause();
      return;
    }
    if (input.take('restart')) {
      restartFloor();
      return;
    }
    if (input.take('hint')) showHint();

    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(PHYS.step, left);
      physicsStep(step);
      left -= step;
    }

    pickUps();
    const hit = findInteract();
    if (input.take('use') && hit) {
      if (hit.type === 'terminal') useTerminal(hit.obj);
      else if (hit.type === 'npc') {
        const talk = (story().talk || {})[hit.obj.id];
        if (talk) talk(storyCtx(hit.obj));
      } else if (hit.type === 'portal') {
        enterRoom(hit.obj);
        return;
      } else if (hit.type === 'lock') tryDoor();
      else if (hit.type === 'cat') petCat();
      if (G.mode !== 'play') return;
    }
    if (story().tick) story().tick(storyCtx(null), dt);
    updateTorch(dt);
    updateDoor(dt);
    if (G.player.y > WORLD.h + 30) loseLife();
    updatePrompt(hit);
  }

  // Browsers keep audio suspended until the page has had a click or a key press.
  for (const type of ['pointerdown', 'pointerup', 'click', 'touchend', 'keydown']) window.addEventListener(type, () => audio.unlock());

  dom.game.addEventListener('pointerdown', () => {
    if (G.mode === 'dialogue') advanceDialogue(false);
    else if (G.mode === 'cutscene' && G.scene) G.scene.skip = true;
  });

  window.addEventListener('keydown', (ev) => {
    if (G.mode !== 'terminal' || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (ev.code !== 'ArrowRight' && ev.code !== 'ArrowLeft') return;
    const buttons = Array.from(dom.termOps.querySelectorAll('button:not(:disabled)'));
    if (!buttons.length) return;
    const at = buttons.indexOf(document.activeElement);
    const next = (at + (ev.code === 'ArrowRight' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[at < 0 ? 0 : next].focus();
    ev.preventDefault();
  });

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    try {
      update(dt);
      renderer.draw(G);
      ui.tick(dt);
    } catch (err) {
      console.log(`Blackout Lab frame error: ${err && err.stack ? err.stack : err}`);
    }
    requestAnimationFrame(frame);
  }

  function watchSize() {
    renderer.resize();
    if (window.ResizeObserver) new ResizeObserver(() => renderer.resize()).observe(dom.viewport);
    window.addEventListener('resize', () => renderer.resize());
  }

  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

  async function boot() {
    watchSize();
    ui.showScreen('title');
    ui.setAbout(true);
    ui.showTouch(!!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches));
    ui.setHud({ backendText: `${backendName} · self-test pending` });
    requestAnimationFrame(frame);

    const info = await Q.info();
    if (!info.ok) {
      ui.setBoot(`The quantum engine did not load. ${info.error} Press Stop, then Run, to try again.`, 'error');
      return;
    }
    dom.engineName.textContent = info.engine;
    G.engine = info.engine;
    await loadLevel(0, { backdrop: true });
    if (G.mode === 'error') return;
    G.torch.active = true;
    G.torch.angle = -0.22;

    if (info.preview) {
      backendName = 'no backend';
      ui.setBoot('Preview build: the physics here is a small JavaScript simulator, so there is no backend to self-test. On Qollab the game runs on Qiskit and tests the machine you pick.');
      ui.setHud({ backendText: 'preview · ideal physics' });
      setMode('title');
      ui.setPrompt('The lab is ready. Enter the building when you are.');
      ui.enableStart('Enter the building');
      return;
    }

    ui.setBoot(`${info.engine} is ready. Running the lab self-test on ${backendName}: one job, ${SELF_TEST_SHOTS} shots.`);
    G.calibrating = true;
    G.bootWait = 0;
    await nextFrame();
    await nextFrame();
    const res = await Q.calibrate(backend, SELF_TEST_SHOTS);
    G.calibrating = false;
    ui.showSkip(false);
    if (res.ok) {
      G.report = res.report;
      ui.setSelfTest(res.report);
      const verdict = res.report.ideal
        ? 'Every check passed on every shot, so gates in the game are exact.'
        : 'This machine is noisy: now and then a gate in the game will misfire at the measured rate.';
      ui.setBoot(`Self-test done on ${res.report.backend}. ${verdict}`);
      if (G.started && !res.report.ideal) say(`The self-test arrived from ${res.report.backend}: gates can now misfire.`, 'info', true);
    } else {
      ui.setBoot(`The self-test could not run on ${backendName} (${res.error}). The game continues with ideal physics.`);
    }
    ui.setHud({ backendText: backendChip() });
    if (!G.started) {
      setMode('title');
      ui.setPrompt('The lab is ready. Enter the building when you are.');
      ui.enableStart('Enter the building');
    }
  }

  return { boot, state: G };
}
