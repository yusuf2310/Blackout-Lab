// Everything on the page that is not the canvas or the instrument rack:
// overlay screens, the console strip (prompt and terminal), status bar, toasts.

import { GATE_INFO } from './levels.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const pct1 = (p) => `${(p * 100).toFixed(p > 0 && p < 0.1 ? 1 : 0)}%`;
// The two shares of a 0 / 1 split, to one decimal, always adding up to 100.
const split = (pOne) => {
  const one = Math.round(pOne * 1000);
  const show = (tenths) => `${tenths % 10 ? (tenths / 10).toFixed(1) : tenths / 10}%`;
  return `${show(1000 - one)} / ${show(one)}`;
};
const SCREENS = ['title', 'pause', 'complete', 'over', 'win', 'error'];

export function grabDom() {
  const ids = [
    'lab', 'viewport', 'game', 'overlay', 'toast', 'touch', 'prompt', 'dock-play', 'dock-terminal', 'term-title', 'term-ops',
    'term-status', 'term-close', 'hud-floor', 'hud-name', 'hud-lives', 'hud-torch', 'hud-backend', 'btn-restart', 'btn-pause', 'btn-sound', 'note', 'opt-floor',
    'boot', 'boot-status', 'selftest', 'selftest-caption', 'selftest-body', 'selftest-pause', 'selftest-pause-caption',
    'selftest-pause-body', 'btn-start', 'btn-skip', 'btn-floors', 'title-floors', 'opt-lives', 'opt-noise', 'opt-noise-note', 'btn-resume',
    'btn-restart-2', 'btn-quit', 'complete-eyebrow', 'complete-h', 'complete-stars', 'complete-star-list', 'complete-takeaway',
    'complete-stats', 'btn-next', 'btn-replay', 'btn-retry', 'btn-over-quit', 'win-stars', 'win-stats', 'win-floors', 'btn-home', 'error-text',
    'btn-error-retry', 'circuit-labels', 'circuit-gates', 'circuit-readout', 'circuit-desc', 'stats', 'code', 'copy-code', 'probs', 'joint', 'floor-tag', 'goal', 'concept',
    'gate-list', 'hints', 'hint-button', 'log', 'live', 'engine-name', 'about', 'circuit-expand',
  ];
  const dom = {};
  for (const id of ids) {
    const key = id.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
    dom[key] = document.getElementById(id);
    if (!dom[key]) throw new Error(`index.html is missing #${id}`);
  }
  for (const name of SCREENS) dom[`screen_${name}`] = document.getElementById(`screen-${name}`);
  return dom;
}

// A pixel heart, drawn from a 9 x 8 grid: o outline, r fill, w highlight.
const HEART = ['.oo...oo.', 'orro.orro', 'orwrorrro', 'orrrrrrro', '.orrrrro.', '..orrro..', '...oro...', '....o....'];

function heartSvg(full) {
  const colour = full ? { o: '#3a0812', r: '#f0364f', w: '#ffd9df' } : { o: '#2a3a58', r: '#111a2b', w: '#111a2b' };
  let cells = '';
  HEART.forEach((row, y) => {
    row.split('').forEach((ch, x) => {
      if (ch !== '.') cells += `<rect x="${x * 2}" y="${y * 2}" width="2" height="2" fill="${colour[ch]}"/>`;
    });
  });
  return `<svg class="heart" width="18" height="16" viewBox="0 0 18 16" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}

const TORCH_TEXT = { low: 'Flashlight: low battery', dead: 'Flashlight: dead' };

function starsHtml(got, of) {
  return '★'.repeat(got) + `<span class="off">${'★'.repeat(of - got)}</span>`;
}

export function createUI(dom, handlers) {
  let screen = 'title';
  let toastLeft = 0;
  let terminal = null;

  function focusLater(el) {
    if (el && el.focus) requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }

  function showScreen(name) {
    screen = name;
    dom.overlay.hidden = !name;
    if (name) dom.toast.hidden = true;
    for (const s of SCREENS) dom[`screen_${s}`].hidden = s !== name;
    if (name) {
      const first = dom[`screen_${name}`].querySelector('.primary:not(:disabled)') || dom[`screen_${name}`].querySelector('button:not(:disabled)');
      focusLater(first);
    } else {
      focusLater(dom.game);
    }
  }

  function selfTestRows(report) {
    const row = (name, value, cls) => `<tr><th scope="row">${esc(name)}</th><td class="${cls || ''}">${esc(value)}</td></tr>`;
    const pass = (v) => (v >= 0.9995 ? 't-pass' : 't-warn');
    return (
      row('X: a certain flip reads 1', pct1(report.x_ok), pass(report.x_ok)) +
      row('H, Z, H: interference reads 1', pct1(report.interference_ok), pass(report.interference_ok)) +
      row('H: superposition, 0 / 1', split(report.plus_one)) +
      row('Bell pair: both agree', pct1(report.bell_agree), pass(report.bell_agree)) +
      row('GHZ trio: all agree', pct1(report.ghz_agree), pass(report.ghz_agree)) +
      row('Error chance used in the game', report.ideal ? 'none: ideal' : `1-qubit ${pct1(report.p1)}, CNOT ${pct1(report.p2)}`, report.ideal ? 't-pass' : 't-warn')
    );
  }

  function setSelfTest(report) {
    const caption = `Lab self-test on ${report.backend}: ${report.shots} shots, ${report.seconds} s`;
    for (const [table, cap, body] of [
      [dom.selftest, dom.selftestCaption, dom.selftestBody],
      [dom.selftestPause, dom.selftestPauseCaption, dom.selftestPauseBody],
    ]) {
      cap.textContent = caption;
      body.innerHTML = selfTestRows(report);
      table.hidden = false;
    }
    dom.optNoiseNote.textContent = report.ideal ? '(this backend measured none)' : `(1-qubit ${pct1(report.p1)}, CNOT ${pct1(report.p2)})`;
  }

  function setHud({ floorText, name, lives, maxLives, infinite, backendText, torch }) {
    if (floorText !== undefined) dom.hudFloor.textContent = floorText;
    if (name !== undefined) dom.hudName.textContent = name;
    if (backendText !== undefined) dom.hudBackend.textContent = backendText;
    if (torch !== undefined) {
      dom.hudTorch.hidden = !TORCH_TEXT[torch];
      dom.hudTorch.textContent = TORCH_TEXT[torch] || '';
    }
    if (lives !== undefined) {
      dom.hudLives.setAttribute('aria-label', infinite ? 'Lives: unlimited' : `Lives: ${lives} of ${maxLives}`);
      dom.hudLives.innerHTML = infinite
        ? `${heartSvg(true)} &infin;`
        : Array.from({ length: maxLives }, (_, i) => heartSvg(i < lives)).join('');
    }
  }

  let promptHtml = '';
  function setPrompt(html) {
    if (html === promptHtml) return;
    promptHtml = html;
    dom.prompt.innerHTML = html;
  }

  function toast(text, kind, seconds) {
    dom.toast.textContent = text;
    dom.toast.className = `toast t-${kind || 'info'}`;
    dom.toast.hidden = false;
    toastLeft = seconds || 3.2;
  }

  function announce(text) {
    dom.live.textContent = '';
    dom.live.textContent = text;
  }

  function opLabel(op) {
    if (op.gate === 'cx') return `${op.q[0]} → ${op.q[1]}`;
    return op.q.join(', ');
  }

  function openTerminal(term, carrying) {
    terminal = term;
    dom.dockPlay.hidden = true;
    dom.dockTerminal.hidden = false;
    const kind = term.box ? 'Box port' : term.port ? `${term.id} · dead terminal, canister port only` : `Terminal ${term.id}`;
    dom.termTitle.textContent = `${kind}${term.sealed ? ` · holds sealed qubit ${term.sealed}` : ''} · flashlight lowered`;
    dom.termOps.innerHTML = term.ops
      .map((op, i) => {
        const info = GATE_INFO[op.gate];
        const locked = op.needsCanister && !carrying;
        const what = locked ? 'needs the canister' : op.gate === 'cx' ? 'control → target' : info.name;
        const on = op.gate === 'cx' ? `from ${op.q[0]} to ${op.q[1]}` : `on ${op.q.join(' and ')}`;
        return (
          `<button type="button" class="op-btn" data-op="${i}" data-locked="${locked ? 1 : 0}" title="${esc(info.text)}" aria-label="${esc(`${info.name} ${on}. ${locked ? 'Needs the canister. ' : ''}${info.text}`)}"${locked ? ' disabled' : ''}>` +
          `<span class="op-gate">${esc(info.symbol)}</span><span class="op-target">${esc(opLabel(op))}</span><span class="op-hint">${esc(what)}</span></button>`
        );
      })
      .join('');
    setTerminalStatus('Pick a gate. Nothing is observed while you are at the terminal.', '');
    focusLater(dom.termOps.querySelector('button:not(:disabled)') || dom.termClose);
  }

  function closeTerminal() {
    terminal = null;
    dom.dockTerminal.hidden = true;
    dom.dockPlay.hidden = false;
    focusLater(dom.game);
  }

  function setTerminalStatus(text, kind) {
    dom.termStatus.textContent = text;
    dom.termStatus.className = `term-status${kind ? ` is-${kind}` : ''}`;
  }

  let focusedOp;
  function setTerminalBusy(busy) {
    const active = document.activeElement;
    if (busy) focusedOp = active && active.dataset ? active.dataset.op : undefined;
    for (const b of dom.termOps.querySelectorAll('button')) b.disabled = busy || b.dataset.locked === '1';
    if (!busy && terminal) {
      const again = focusedOp !== undefined ? dom.termOps.querySelector(`button[data-op="${focusedOp}"]:not(:disabled)`) : null;
      const now = document.activeElement;
      if (again) again.focus({ preventScroll: true });
      else if (!now || now === document.body) focusLater(dom.termOps.querySelector('button:not(:disabled)') || dom.termClose);
    }
  }

  function showComplete({ name, index, total, stars, of, earned, takeaway, stats, last }) {
    dom.completeEyebrow.textContent = `Floor ${index + 1} of ${total} cleared`;
    dom.completeH.textContent = name;
    dom.completeStars.innerHTML = starsHtml(stars, of);
    dom.completeStars.setAttribute('aria-label', `${stars} of ${of} stars`);
    dom.completeStarList.innerHTML = earned.map((e) => `<li class="${e.got ? '' : 'missed'}">${esc(e.text)}</li>`).join('');
    dom.completeTakeaway.textContent = takeaway;
    dom.completeStats.textContent = stats;
    dom.btnNext.textContent = last ? 'Up to the terrace' : 'Next floor';
    showScreen('complete');
  }

  function showWin({ stars, of, stats }) {
    dom.winStars.hidden = !of;
    dom.winStars.textContent = `★ ${stars} of ${of} stars`;
    dom.winStats.textContent = stats;
    showScreen('win');
  }

  // -- wiring ---------------------------------------------------------------

  const instruments = Array.from(dom.about.parentElement.children).filter((el) => el !== dom.about);
  // A project link shows its own address as text. Until an address is filled in
  // (index.html), the line says so instead of offering a link that goes nowhere.
  for (const link of dom.about.querySelectorAll('a')) {
    const url = link.getAttribute('href');
    if (url) link.textContent = url.replace(/^https?:\/\//, '');
    else link.outerHTML = '<em>link not added yet</em>';
  }

  const click = (el, fn) => el.addEventListener('click', () => fn && fn());
  click(dom.btnStart, handlers.start);
  click(dom.btnSkip, handlers.skip);
  click(dom.btnPause, handlers.pause);
  click(dom.btnResume, handlers.resume);
  click(dom.btnRestart, handlers.restart);
  click(dom.btnRestart2, handlers.restart);
  click(dom.btnQuit, handlers.quit);
  click(dom.btnOverQuit, handlers.quit);
  click(dom.btnNext, handlers.next);
  click(dom.btnReplay, handlers.replay);
  click(dom.btnRetry, handlers.retry);
  click(dom.btnHome, handlers.home);
  dom.winFloors.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-floor]');
    if (btn) handlers.jump(Number(btn.dataset.floor));
  });
  click(dom.btnErrorRetry, handlers.errorRetry);
  click(dom.btnSound, handlers.sound);
  click(dom.hintButton, handlers.hint);
  click(dom.termClose, handlers.closeTerminal);
  dom.termOps.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-op]');
    if (btn && !btn.disabled) handlers.applyOp(Number(btn.dataset.op));
  });
  dom.optLives.addEventListener('change', () => handlers.option('lives', dom.optLives.checked));
  dom.optNoise.addEventListener('change', () => handlers.option('noise', dom.optNoise.checked));
  dom.btnFloors.addEventListener('click', () => {
    const open = dom.titleFloors.hidden;
    dom.titleFloors.hidden = !open;
    dom.btnFloors.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  dom.titleFloors.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-floor]');
    if (btn) handlers.skipTo(Number(btn.dataset.floor));
  });
  dom.optFloor.addEventListener('change', () => handlers.jump(Number(dom.optFloor.value)));
  dom.copyCode.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(dom.code.textContent);
      dom.copyCode.textContent = 'Copied';
    } catch (err) {
      const range = document.createRange();
      range.selectNodeContents(dom.code);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      dom.copyCode.textContent = 'Selected: press Ctrl+C';
    }
  });

  for (const btn of dom.touch.querySelectorAll('.touch-btn')) {
    const hold = btn.dataset.hold;
    const tap = btn.dataset.tap;
    const set = (down) => (ev) => {
      ev.preventDefault();
      btn.classList.toggle('is-down', down);
      if (hold) handlers.touchHold(hold, down);
      else if (down) handlers.touchTap(tap);
    };
    btn.addEventListener('pointerdown', set(true));
    btn.addEventListener('pointerup', set(false));
    btn.addEventListener('pointercancel', set(false));
    btn.addEventListener('pointerleave', set(false));
  }

  return {
    showScreen,
    screen: () => screen,
    setBoot(text, kind) {
      dom.bootStatus.textContent = text;
      dom.boot.classList.toggle('is-error', kind === 'error');
    },
    setSelfTest,
    enableStart(label) {
      dom.btnStart.disabled = false;
      dom.btnFloors.disabled = false;
      dom.btnStart.textContent = label;
      if (screen === 'title') focusLater(dom.btnStart);
    },
    showSkip(show) {
      dom.btnSkip.hidden = !show;
      if (show) dom.btnFloors.disabled = false;
    },
    setHud,
    setPrompt,
    toast,
    announce,
    openTerminal,
    closeTerminal,
    setTerminalStatus,
    setTerminalBusy,
    showComplete,
    showWin,
    showError(text) {
      dom.errorText.textContent = text;
      showScreen('error');
    },
    setPlaying(playing) {
      dom.btnPause.disabled = !playing;
      dom.btnRestart.disabled = !playing;
    },
    // The title screen swaps the instruments in the rack for a short "about" panel.
    setAbout(on) {
      for (const el of instruments) el.hidden = on;
      dom.about.hidden = !on;
    },
    setSound(on) {
      dom.btnSound.setAttribute('aria-pressed', on ? 'true' : 'false');
    },
    setOptions({ lives, noise, floor }) {
      dom.optLives.checked = lives;
      dom.optNoise.checked = noise;
      dom.optFloor.value = String(floor);
    },
    setFloors(names, ending) {
      dom.optFloor.innerHTML = [...names, ending].map((name, i) => `<option value="${i}">${esc(name)}</option>`).join('');
      const buttons = names.map((name, i) => `<button type="button" class="key-btn" data-floor="${i}">${esc(name)}</button>`).join('');
      dom.winFloors.innerHTML = buttons;
      dom.titleFloors.innerHTML = buttons;
    },
    setNote(text) {
      dom.note.hidden = !text;
      dom.note.textContent = text || '';
    },
    showTouch(show) {
      dom.touch.hidden = !show;
    },
    tick(dt) {
      if (toastLeft > 0) {
        toastLeft -= dt;
        if (toastLeft <= 0) dom.toast.hidden = true;
      }
    },
  };
}
