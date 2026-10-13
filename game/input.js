// Keyboard, mouse and touch input. Everything in the game can be done from the
// keyboard alone; the mouse (or a finger) is only a second way to aim the flashlight.

const KEYS = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  jump: ['Space', 'ArrowUp', 'KeyW'],
  tiltUp: ['KeyI'],
  tiltDown: ['KeyK'],
  use: ['KeyE', 'Enter'],
  torch: ['KeyF'],
  pause: ['KeyP', 'Escape'],
  restart: ['KeyR'],
  mute: ['KeyM'],
  hint: ['KeyH'],
};

const ACTION_OF = {};
for (const action of Object.keys(KEYS)) for (const code of KEYS[action]) ACTION_OF[code] = action;

export function createInput(canvas, world) {
  const held = {}; // action -> true while down
  const pressed = {};
  const pointer = { x: 0, y: 0, active: false, moved: false };
  let enabled = true;

  function isTyping(target) {
    if (!target || !target.tagName) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function onKey(down, ev) {
    const action = ACTION_OF[ev.code];
    if (!action || ev.ctrlKey || ev.metaKey || ev.altKey || isTyping(ev.target)) return;
    const onControl = ev.target && ev.target.closest && ev.target.closest('button, a, summary, [role="button"]');
    if (onControl && (ev.code === 'Enter' || ev.code === 'Space')) return;
    if (!enabled && action !== 'pause' && action !== 'mute') return;
    if (['left', 'right', 'jump', 'tiltUp', 'tiltDown'].includes(action) || ev.code === 'Space') ev.preventDefault();
    if (down && !ev.repeat) pressed[action] = true;
    held[action] = down;
  }

  const keydown = (ev) => onKey(true, ev);
  const keyup = (ev) => onKey(false, ev);
  const blur = () => {
    for (const key of Object.keys(held)) held[key] = false;
  };

  function toWorld(ev) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    pointer.x = ((ev.clientX - rect.left) / rect.width) * world.w;
    pointer.y = ((ev.clientY - rect.top) / rect.height) * world.h;
    pointer.active = true;
    pointer.moved = true;
  }

  window.addEventListener('keydown', keydown);
  window.addEventListener('keyup', keyup);
  window.addEventListener('blur', blur);
  canvas.addEventListener('pointermove', toWorld);
  canvas.addEventListener('pointerdown', (ev) => {
    toWorld(ev);
    if (canvas.focus) canvas.focus({ preventScroll: true });
  });

  return {
    held,
    pointer,
    take(action) {
      const was = !!pressed[action];
      pressed[action] = false;
      return was;
    },
    clearPresses() {
      for (const key of Object.keys(pressed)) pressed[key] = false;
    },
    setHeld(action, down) {
      if (down && !held[action]) pressed[action] = true;
      held[action] = down;
    },
    setEnabled(value) {
      enabled = value;
      if (!value) blur();
    },
  };
}
