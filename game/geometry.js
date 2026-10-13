// Shapes shared by the game logic and the renderer, so that what the flashlight
// "sees" is exactly what is drawn.

import { PLATFORM_H } from './levels.js';

export const TORCH = { range: 330, half: 0.33, dwell: 0.45 };
export const PLAYER = { w: 18, h: 32 };

// Rectangle of a platform parked in state 0 (lowered) or 1 (raised).
export function slotRect(p, state) {
  return { x: p.x, y: state ? p.y1 : p.y0, w: p.w, h: PLATFORM_H };
}

export function doorRect(door) {
  return { x: door.x - 22, y: door.y - 70, w: 44, h: 70 };
}

// The lock panel beside the door: this is what the flashlight has to light.
// Three rows: the key, the lamps, and the name of the qubit behind each lamp.
export function lockRect(door) {
  const n = Math.max(1, door.lock.length);
  const w = 30 + n * 20;
  return { x: door.x - 32 - w, y: door.y - 84, w, h: 66 };
}

export function lampPos(door, i) {
  const r = lockRect(door);
  return { x: r.x + 36 + i * 20, keyY: r.y + 16, lockY: r.y + 41 };
}

// A terminal is a screen on the wall at head height with a keyboard shelf
// under it. `term.y` is the floor the player stands on to use it.
export function screenRect(term) {
  if (term.box) return boxRect(term);
  return { x: term.x - 15, y: term.y - 66, w: 30, h: 21 };
}

// The Professor's box sits on the floor; its canister port is on the front.
export function boxRect(term) {
  return { x: term.x - 16, y: term.y - 26, w: 32, h: 26 };
}

// A sealed qubit's housing stands on the floor beside its terminal.
export function cryoRect(term) {
  const side = term.cryoSide || 1;
  return { x: term.x + side * 30 - 7, y: term.y - 32, w: 14, h: 32 };
}

export function canisterRect(c) {
  return { x: c.x - 5, y: c.y - 20, w: 10, h: 20 };
}

export function center(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

export function handOf(player) {
  return { x: player.x + PLAYER.w / 2 + player.facing * 5, y: player.y + 14 };
}

function angleGap(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export function pointLit(hand, angle, x, y) {
  const dx = x - hand.x;
  const dy = y - hand.y;
  const dist = Math.hypot(dx, dy);
  if (dist > TORCH.range) return false;
  if (dist < 14) return true;
  return angleGap(Math.atan2(dy, dx), angle) <= TORCH.half;
}

// A rectangle counts as lit when its centre, or any two of its corners, are in the beam.
export function rectLit(hand, angle, r) {
  if (pointLit(hand, angle, r.x + r.w / 2, r.y + r.h / 2)) return true;
  const inset = 3;
  let hits = 0;
  for (const [x, y] of [
    [r.x + inset, r.y + inset],
    [r.x + r.w - inset, r.y + inset],
    [r.x + inset, r.y + r.h - inset],
    [r.x + r.w - inset, r.y + r.h - inset],
  ]) {
    if (pointLit(hand, angle, x, y)) hits += 1;
  }
  return hits >= 2;
}
