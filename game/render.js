// Canvas renderer. The room is drawn fully lit, then covered by a darkness
// mask with holes cut for the flashlight beam and for anything that glows. Things
// that give off their own light (LED strips, screens, superposed platforms,
// signs, speech bubbles) are drawn again on top, so they stay readable in the dark.

import { WORLD, PLATFORM_H } from './levels.js';
import { TORCH, PLAYER, slotRect, doorRect, lockRect, lampPos, screenRect, boxRect, cryoRect, canisterRect, center, handOf } from './geometry.js';

const C = {
  wallTop: '#1a2942',
  wallBottom: '#0d1626',
  seam: 'rgba(120,150,200,0.16)',
  concrete: '#33415a',
  concreteEdge: '#5a6d8f',
  steel: '#4a5a78',
  steelLight: '#8195b8',
  hazard: '#e0b040',
  ink: '#dbe7f5',
  dim: '#8fa3bd',
  torch: '#ffd98a',
  qubit: '#5ee6ff',
  link: '#ff7ad9',
  zero: '#8fb3ff',
  one: '#ffd98a',
  ok: '#7dffa8',
  bad: '#ff6b6b',
  dark: 'rgba(3,6,12,0.9)',
};

const SIGN_FONT = '"Big Shoulders Display", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const MONO_FONT = '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const BODY_FONT = '"Atkinson Hyperlegible", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

// How each character is dressed.
const PEOPLE = {
  professor: { hair: '#f1f1f1', skin: '#eac4a2', top: '#f4f4f0', legs: '#3a3f52', coat: true, glasses: true, wild: true },
  alice: { hair: '#a8452f', skin: '#f0c9a6', top: '#8a5fd0', legs: '#2f3e63', long: true },
  bob: { hair: '#1d1a1a', skin: '#c99670', top: '#3f9d6b', legs: '#3b3b4a' },
};

function rr(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const mask = document.createElement('canvas');
  const mctx = mask.getContext('2d');
  let scale = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = rect.width || WORLD.w;
    scale = Math.max(0.5, Math.min(2, (cssW / WORLD.w) * dpr));
    const w = Math.round(WORLD.w * scale);
    const h = Math.round(WORLD.h * scale);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      mask.width = w;
      mask.height = h;
    }
  }

  function label(text, x, y, color, size, align, font) {
    ctx.font = `700 ${size || 12}px ${font || MONO_FONT}`;
    ctx.textAlign = align || 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }

  function tag(text, x, y, color) {
    ctx.font = `700 11px ${MONO_FONT}`;
    const w = ctx.measureText(text).width + 8;
    ctx.fillStyle = 'rgba(7,11,20,0.82)';
    rr(ctx, x - w / 2, y - 8, w, 16, 4);
    ctx.fill();
    label(text, x, y + 0.5, color, 11);
  }

  // -- lit layer: the room itself ---------------------------------------------

  function drawWall(G) {
    const g = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    g.addColorStop(0, C.wallTop);
    g.addColorStop(1, C.wallBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.strokeStyle = C.seam;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 60; y < WORLD.h; y += 60) {
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(WORLD.w, y + 0.5);
      const shift = (y / 60) % 2 ? 0 : 60;
      for (let x = shift; x < WORLD.w; x += 120) {
        ctx.moveTo(x + 0.5, y - 60);
        ctx.lineTo(x + 0.5, y);
      }
    }
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = 'rgba(219,231,245,0.17)';
    ctx.font = `800 150px ${SIGN_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(G.levelIndex + 1).padStart(2, '0'), 250, 200);
    ctx.font = `700 22px ${SIGN_FONT}`;
    ctx.fillStyle = 'rgba(219,231,245,0.24)';
    ctx.fillText('FLOOR', 254, 78);
    ctx.restore();

    ctx.fillStyle = '#22314c';
    ctx.fillRect(0, 22, WORLD.w, 9);
    ctx.fillStyle = '#31456a';
    for (let x = 70; x < WORLD.w; x += 190) ctx.fillRect(x, 19, 12, 15);
  }

  function windows(G) {
    const out = [];
    const set = G.level.windows;
    if (set) return set.xs.map((x) => ({ x, y: set.y, w: 46, h: 84 }));
    for (let i = 0; i < 3; i += 1) out.push({ x: 170 + i * 250 + ((G.levelIndex * 37 + G.roomIndex * 80) % 60), y: 70, w: 46, h: 84 });
    return out;
  }

  function drawWindows(G, glowOnly) {
    for (const w of windows(G)) {
      if (!glowOnly) {
        ctx.fillStyle = '#0a1120';
        ctx.fillRect(w.x - 4, w.y - 4, w.w + 8, w.h + 8);
      }
      const g = ctx.createLinearGradient(0, w.y, 0, w.y + w.h);
      g.addColorStop(0, glowOnly ? 'rgba(70,100,170,0.30)' : '#25365c');
      g.addColorStop(1, glowOnly ? 'rgba(40,60,110,0.18)' : '#16223d');
      ctx.fillStyle = g;
      ctx.fillRect(w.x, w.y, w.w, w.h);
      ctx.fillStyle = glowOnly ? 'rgba(10,17,32,0.7)' : '#0a1120';
      ctx.fillRect(w.x + w.w / 2 - 1.5, w.y, 3, w.h);
      ctx.fillRect(w.x, w.y + w.h / 2 - 1.5, w.w, 3);
    }
  }

  function drawDecor(G) {
    for (const d of G.room.decor) {
      if (d.type === 'sign') {
        ctx.save();
        ctx.fillStyle = 'rgba(240,228,190,0.7)';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = `800 30px ${SIGN_FONT}`;
        d.lines.forEach((line, i) => ctx.fillText(line, d.x, d.y + i * 32));
        ctx.restore();
      } else if (d.type === 'candle') {
        ctx.fillStyle = '#3a4d72';
        ctx.fillRect(d.x - 9, d.y + 10, 18, 3); // bracket
        ctx.fillRect(d.x - 1, d.y + 13, 2, 8);
        ctx.fillStyle = '#efe6c8';
        ctx.fillRect(d.x - 3, d.y - 2, 6, 12);
      } else if (d.type === 'teleporter') {
        ctx.fillStyle = '#2c3d5e';
        ctx.fillRect(d.x - 34, d.y - 8, 68, 8);
        ctx.fillRect(d.x - 34, d.y - 84, 9, 76);
        ctx.fillRect(d.x + 25, d.y - 84, 9, 76);
        ctx.fillRect(d.x - 34, d.y - 92, 68, 10);
        ctx.fillStyle = '#42587f';
        for (let y = d.y - 76; y < d.y - 12; y += 12) {
          ctx.fillRect(d.x - 36, y, 13, 4);
          ctx.fillRect(d.x + 23, y, 13, 4);
        }
      }
    }
  }

  function drawSolids(G) {
    for (const s of G.room.solids) {
      if (s.kind === 'ground') {
        ctx.fillStyle = C.concrete;
        ctx.fillRect(s.x, s.y, s.w, s.h);
        ctx.fillStyle = C.concreteEdge;
        ctx.fillRect(s.x, s.y, s.w, 4);
        const edges = [];
        if (s.x + s.w < WORLD.w) edges.push(s.x + s.w - 6);
        if (s.x > 0) edges.push(s.x);
        for (const edgeX of edges) {
          for (let y = s.y + 8; y < Math.min(s.y + 64, s.y + s.h); y += 14) {
            ctx.fillStyle = C.hazard;
            ctx.fillRect(edgeX, y, 6, 7);
          }
        }
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        for (let y = s.y + 30; y < s.y + s.h; y += 34) ctx.fillRect(s.x, y, s.w, 2);
      } else {
        ctx.strokeStyle = '#2b3b59';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s.x + 10, 31);
        ctx.lineTo(s.x + 10, s.y);
        ctx.moveTo(s.x + s.w - 10, 31);
        ctx.lineTo(s.x + s.w - 10, s.y);
        ctx.stroke();
        ctx.fillStyle = C.steel;
        rr(ctx, s.x, s.y, s.w, s.h, 3);
        ctx.fill();
        ctx.fillStyle = C.steelLight;
        ctx.fillRect(s.x + 2, s.y, s.w - 4, 3);
      }
    }
  }

  function drawRails(p) {
    ctx.strokeStyle = '#2a3a58';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (const x of [p.x + 9, p.x + p.w - 9]) {
      ctx.moveTo(x, p.y1 - 14);
      ctx.lineTo(x, p.y0 + PLATFORM_H + 12);
    }
    ctx.stroke();
    ctx.fillStyle = '#3a4d72';
    for (const y of [p.y1, p.y0]) {
      ctx.fillRect(p.x + 4, y + PLATFORM_H, 10, 3);
      ctx.fillRect(p.x + p.w - 14, y + PLATFORM_H, 10, 3);
    }
  }

  function platformPath(p, x, y) {
    const w = p.w;
    const h = PLATFORM_H;
    ctx.beginPath();
    if (p.half === 'left') {
      ctx.moveTo(x, y);
      ctx.lineTo(x + w - 5, y);
      ctx.lineTo(x + w, y + 4);
      ctx.lineTo(x + w - 6, y + 8);
      ctx.lineTo(x + w - 1, y + h);
      ctx.lineTo(x, y + h);
    } else if (p.half === 'right') {
      ctx.moveTo(x + 6, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + 2, y + h);
      ctx.lineTo(x + 7, y + 8);
      ctx.lineTo(x, y + 4);
    } else {
      rr(ctx, x, y, w, h, 3);
      return;
    }
    ctx.closePath();
  }

  function drawPlatformBody(p) {
    ctx.fillStyle = '#566a8f';
    platformPath(p, p.x, p.y);
    ctx.fill();
    ctx.fillStyle = '#93a8cd';
    ctx.fillRect(p.x + 7, p.y, p.w - 14, 3);
    ctx.fillStyle = '#2a3855';
    ctx.fillRect(p.x + 8, p.y + PLATFORM_H - 4, p.w - 16, 2);
  }

  function drawBox(G, term) {
    const r = boxRect(term);
    const opened = !!G.flags.opened;
    const shake = !opened ? Math.sin(G.t * 23) * (Math.sin(G.t * 1.7) > 0.86 ? 1.2 : 0) : 0;
    ctx.save();
    ctx.translate(shake, 0);
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(r.x, r.y + 5, r.w, r.h - 5);
    ctx.fillStyle = '#5d4329';
    ctx.fillRect(r.x, r.y + 13, r.w, 2);
    ctx.fillRect(r.x + 6, r.y + 5, 2, r.h - 5);
    ctx.fillRect(r.x + r.w - 8, r.y + 5, 2, r.h - 5);
    ctx.fillStyle = '#8d6a45';
    if (opened) {
      ctx.save();
      ctx.translate(r.x + r.w, r.y + 5);
      ctx.rotate(-1.1);
      ctx.fillRect(-r.w - 1, -5, r.w + 2, 5);
      ctx.restore();
    } else ctx.fillRect(r.x - 1, r.y, r.w + 2, 6);
    ctx.fillStyle = '#16213a';
    ctx.beginPath();
    ctx.arc(r.x + r.w / 2, r.y + 19, 4.5, 0, Math.PI * 2);
    ctx.fill();
    if (opened) drawCat(r.x + r.w / 2 - 2, r.y + 6);
    ctx.restore();
  }

  const CAT = { fur: '#f0a04b', stripe: '#b9631c', chest: '#fbe3c0', eye: '#1d3b16' };

  function drawCat(x, y) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = CAT.fur;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); // tail
    ctx.moveTo(x - 6, y - 4);
    ctx.quadraticCurveTo(x - 13, y - 6, x - 11, y - 14);
    ctx.stroke();
    ctx.fillStyle = CAT.fur;
    ctx.beginPath();
    ctx.ellipse(x, y - 5, 7, 6, 0, 0, Math.PI * 2); // body
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 5, y - 12, 4.5, 0, Math.PI * 2); // head
    ctx.fill();
    ctx.beginPath(); // ears
    ctx.moveTo(x + 1.5, y - 14);
    ctx.lineTo(x + 2.5, y - 19);
    ctx.lineTo(x + 5, y - 15.5);
    ctx.moveTo(x + 5.5, y - 15.5);
    ctx.lineTo(x + 8, y - 19);
    ctx.lineTo(x + 9, y - 14);
    ctx.fill();
    ctx.fillStyle = CAT.chest;
    ctx.beginPath();
    ctx.ellipse(x + 4, y - 5, 2.6, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = CAT.stripe;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); // tabby stripes
    for (const dx of [-4, -1.5]) {
      ctx.moveTo(x + dx, y - 10);
      ctx.lineTo(x + dx - 0.5, y - 6.5);
    }
    ctx.stroke();
    ctx.fillStyle = CAT.eye;
    ctx.fillRect(x + 3.2, y - 13.2, 1.6, 1.8);
    ctx.fillRect(x + 6.2, y - 13.2, 1.6, 1.8);
    ctx.restore();
  }

  function drawCatRun(x, y, stride, tilt) {
    ctx.save();
    ctx.translate(x, y - 8);
    ctx.rotate(tilt);
    ctx.lineCap = 'round';
    ctx.strokeStyle = CAT.fur;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); // tail, streaming behind
    ctx.moveTo(-9, -1);
    ctx.quadraticCurveTo(-16, -3, -19, -8);
    ctx.stroke();
    ctx.lineWidth = 2.2;
    ctx.beginPath(); // legs
    ctx.moveTo(6, 2);
    ctx.lineTo(7 + stride * 6, 8);
    ctx.moveTo(4, 2);
    ctx.lineTo(4 - stride * 4, 8);
    ctx.moveTo(-6, 2);
    ctx.lineTo(-7 - stride * 6, 8);
    ctx.moveTo(-4, 2);
    ctx.lineTo(-4 + stride * 4, 8);
    ctx.stroke();
    ctx.fillStyle = CAT.fur;
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 4.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(11, -4, 4.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath(); // ears
    ctx.moveTo(8, -6.5);
    ctx.lineTo(8.5, -11.5);
    ctx.lineTo(11, -8);
    ctx.moveTo(11.5, -8);
    ctx.lineTo(14, -11.5);
    ctx.lineTo(14.5, -6.5);
    ctx.fill();
    ctx.strokeStyle = CAT.stripe;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const dx of [-5, -1.5, 2]) {
      ctx.moveTo(dx, -4);
      ctx.lineTo(dx - 0.5, -0.5);
    }
    ctx.stroke();
    ctx.fillStyle = CAT.eye;
    ctx.fillRect(12.4, -5.2, 1.6, 1.8);
    ctx.restore();
  }

  function drawTerminal(G, term) {
    if (term.box) {
      drawBox(G, term);
      return;
    }
    const s = screenRect(term);
    ctx.fillStyle = '#1b2740';
    rr(ctx, s.x - 5, s.y - 5, s.w + 10, s.h + 12, 3); // wall plate
    ctx.fill();
    ctx.fillStyle = '#2f4062';
    ctx.fillRect(term.x - 2, s.y + s.h + 2, 4, 9); // arm down to the shelf
    ctx.fillStyle = '#0c1422';
    rr(ctx, s.x - 2, s.y - 2, s.w + 4, s.h + 4, 3); // bezel
    ctx.fill();
    ctx.fillStyle = '#3a4d72';
    ctx.beginPath();
    ctx.moveTo(term.x - 15, term.y - 31);
    ctx.lineTo(term.x + 15, term.y - 31);
    ctx.lineTo(term.x + 13, term.y - 26);
    ctx.lineTo(term.x - 13, term.y - 26);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1b2740';
    ctx.fillRect(term.x - 11, term.y - 30, 22, 2);
    if (term.port) {
      ctx.fillStyle = '#16213a';
      ctx.beginPath();
      ctx.arc(term.x, term.y - 15, 6, 0, Math.PI * 2); // canister port
      ctx.fill();
    }
    if (term.sealed) {
      const c = cryoRect(term);
      ctx.fillStyle = '#3d4f72';
      rr(ctx, c.x, c.y, c.w, c.h, 5);
      ctx.fill();
      ctx.fillStyle = '#5d7299';
      ctx.fillRect(c.x - 2, c.y + 4, c.w + 4, 3);
      ctx.fillRect(c.x - 2, c.y + c.h - 7, c.w + 4, 3);
    }
  }

  function drawCanister(x, baseY) {
    ctx.fillStyle = '#9fb3d6';
    rr(ctx, x - 5, baseY - 19, 10, 19, 4);
    ctx.fill();
    ctx.fillStyle = '#5d7299';
    ctx.fillRect(x - 6, baseY - 16, 12, 2.5);
    ctx.fillRect(x - 6, baseY - 6, 12, 2.5);
    ctx.fillStyle = '#2a3855';
    ctx.fillRect(x - 2, baseY - 22, 4, 3);
  }

  function drawPickups(G) {
    const c = G.canister;
    if (c && c.roomId === G.room.id) {
      ctx.fillStyle = '#2f4062'; // its dock
      ctx.fillRect(c.x - 9, c.y - 4, 18, 4);
      ctx.fillRect(c.x - 9, c.y - 10, 2, 6);
      ctx.fillRect(c.x + 7, c.y - 10, 2, 6);
      if (!c.carried) drawCanister(c.x, c.y - 4);
    }
    const b = G.room.battery;
    if (b) {
      ctx.fillStyle = '#1b2740';
      rr(ctx, b.x - 15, b.y - 56, 30, 40, 4); // wall cabinet
      ctx.fill();
      ctx.fillStyle = '#0c1422';
      ctx.fillRect(b.x - 10, b.y - 50, 20, 28);
      if (!b.taken) {
        ctx.fillStyle = '#5fbf7a';
        ctx.fillRect(b.x - 5, b.y - 46, 10, 20);
        ctx.fillStyle = '#d7dbe2';
        ctx.fillRect(b.x - 2, b.y - 49, 4, 3);
      }
    }
  }

  function drawDoorLeaf(r, open, colour) {
    ctx.fillStyle = '#1b2740';
    ctx.fillRect(r.x - 5, r.y - 5, r.w + 10, r.h + 5);
    if (open) {
      const g = ctx.createLinearGradient(r.x, 0, r.x + r.w, 0);
      g.addColorStop(0, '#f6f2d4');
      g.addColorStop(1, '#c9d9c0');
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = colour;
      ctx.fillRect(r.x + r.w - 8, r.y, 8, r.h); // the leaf, swung open
      return;
    }
    ctx.fillStyle = colour;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(r.x + 5, r.y + 6, r.w - 10, 26);
    ctx.fillRect(r.x + 5, r.y + 38, r.w - 10, 26);
    ctx.fillStyle = C.hazard;
    ctx.fillRect(r.x + r.w - 11, r.y + 34, 5, 5);
  }

  function drawDoors(G) {
    for (const p of G.room.portals) drawDoorLeaf(doorRect(p), false, '#4d5f96');
    const door = G.room.door;
    if (!door) return;
    drawDoorLeaf(doorRect(door), door.open, '#44597f');
    if (door.key) {
      const l = lockRect(door);
      ctx.fillStyle = '#16213a';
      rr(ctx, l.x, l.y, l.w, l.h, 4);
      ctx.fill();
      ctx.strokeStyle = '#3a4d72';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function drawPerson(x, footY, look, opts) {
    const o = opts || {};
    const sway = o.shake || 0;
    const cx = x + sway;
    const top = footY - 34;
    const step = (o.step || 0) * 4; // legs swing while walking
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = look.legs;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 3, top + 23);
    ctx.lineTo(cx - 3 + step, footY - 1);
    ctx.moveTo(cx + 3, top + 23);
    ctx.lineTo(cx + 3 - step, footY - 1);
    ctx.stroke();
    ctx.fillStyle = look.top;
    rr(ctx, cx - 7, top + 10, 14, look.coat ? 20 : 15, 4);
    ctx.fill();
    if (look.coat) {
      ctx.fillStyle = '#c9ccd4';
      ctx.fillRect(cx - 0.5, top + 14, 1, 16);
      ctx.fillStyle = '#c0392b'; // bow tie
      ctx.fillRect(cx - 3, top + 11, 6, 3);
    }
    ctx.strokeStyle = look.top;
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (o.armsUp) {
      ctx.moveTo(cx - 6, top + 13);
      ctx.lineTo(cx - 12, top + 3);
      ctx.moveTo(cx + 6, top + 13);
      ctx.lineTo(cx + 12, top + 3);
    } else {
      ctx.moveTo(cx - 7, top + 13);
      ctx.lineTo(cx - 8, top + 23);
      ctx.moveTo(cx + 7, top + 13);
      ctx.lineTo(cx + 8, top + 23);
    }
    ctx.stroke();
    ctx.fillStyle = look.skin;
    ctx.beginPath();
    ctx.arc(cx, top + 6, 5.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = look.hair;
    if (look.wild) {
      for (const [dx, dy, r] of [[-6, 3, 3.6], [6, 3, 3.6], [-4, -1, 3], [4, -1, 3], [0, -1, 2.6]]) {
        ctx.beginPath();
        ctx.arc(cx + dx, top + 2 + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.beginPath();
      ctx.arc(cx, top + 5, 6, Math.PI, 0);
      ctx.fill();
      if (look.long) {
        ctx.fillRect(cx - 6.5, top + 4, 3, 11);
        ctx.fillRect(cx + 3.5, top + 4, 3, 11);
      }
    }
    if (look.glasses) {
      ctx.strokeStyle = '#1c1c22';
      ctx.lineWidth = 1.3;
      ctx.fillStyle = 'rgba(220,240,255,0.55)';
      for (const dx of [-3, 3]) {
        ctx.beginPath();
        ctx.arc(cx + dx, top + 6.5, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawNpcs(G) {
    for (const n of G.room.npcs) {
      const panicking = n.kind === 'professor' && !G.flags.opened;
      drawPerson(n.x, n.y, PEOPLE[n.kind], {
        armsUp: panicking,
        shake: panicking ? Math.sin(G.t * 26) * 0.9 : 0,
      });
    }
  }

  function drawPlayer(G) {
    const p = G.player;
    const f = p.facing;
    const cx = p.x + PLAYER.w / 2;
    const run = p.onGround && Math.abs(p.vx) > 20 ? Math.sin(p.anim * 14) : 0;
    ctx.save();
    ctx.lineCap = 'round';
    if (G.canister && G.canister.carried) drawCanister(cx - f * 8, p.y + 27); // on the back
    ctx.strokeStyle = '#33456e'; // jeans
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(cx - 3, p.y + 21);
    ctx.lineTo(cx - 3 + run * 4, p.y + PLAYER.h - 2);
    ctx.moveTo(cx + 3, p.y + 21);
    ctx.lineTo(cx + 3 - run * 4, p.y + PLAYER.h - 2);
    ctx.stroke();
    ctx.strokeStyle = '#e9ecf2'; // trainers
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - 3 + run * 4, p.y + PLAYER.h - 1);
    ctx.lineTo(cx - 3 + run * 4 + f * 2, p.y + PLAYER.h - 1);
    ctx.moveTo(cx + 3 - run * 4, p.y + PLAYER.h - 1);
    ctx.lineTo(cx + 3 - run * 4 + f * 2, p.y + PLAYER.h - 1);
    ctx.stroke();
    ctx.fillStyle = '#3f8f9a'; // hoodie
    rr(ctx, cx - 7, p.y + 9, 14, 15, 4);
    ctx.fill();
    ctx.fillStyle = '#35777f';
    ctx.fillRect(cx - 4, p.y + 18, 8, 4); // pocket
    ctx.fillStyle = '#eec3a0';
    ctx.beginPath();
    ctx.arc(cx, p.y + 6, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a3324'; // hair
    ctx.beginPath();
    ctx.arc(cx, p.y + 5, 5.6, Math.PI * 1.02, Math.PI * 1.98);
    ctx.fill();
    ctx.fillRect(cx - 5.5 - (f > 0 ? 0.5 : 0), p.y + 3, 3, 4);
    if (G.scene && G.scene.phase === 'crank') {
      const grip = crankGrip(G);
      ctx.strokeStyle = '#3f8f9a';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(cx, p.y + 13);
      ctx.lineTo(grip.x, grip.y);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const hand = handOf(p);
    const a = G.torch.lowered ? (f > 0 ? 1.2 : Math.PI - 1.2) : G.torch.angle;
    ctx.strokeStyle = '#3f8f9a';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx, p.y + 13);
    ctx.lineTo(hand.x + Math.cos(a) * 3, hand.y + Math.sin(a) * 3);
    ctx.stroke();
    ctx.translate(hand.x + Math.cos(a) * 4, hand.y + Math.sin(a) * 4);
    ctx.rotate(a);
    ctx.fillStyle = '#1c2436';
    ctx.fillRect(-2, -2.5, 9, 5);
    ctx.fillStyle = G.torch.active ? C.torch : '#55617a';
    ctx.fillRect(7, -3.5, 3, 7);
    ctx.restore();
  }

  // -- darkness -------------------------------------------------------------

  function hole(x, y, radius, strength) {
    const g = mctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(0,0,0,${strength})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    mctx.fillStyle = g;
    mctx.beginPath();
    mctx.arc(x, y, radius, 0, Math.PI * 2);
    mctx.fill();
  }

  function beamPath(c, hand, angle, range) {
    c.beginPath();
    c.moveTo(hand.x, hand.y);
    c.arc(hand.x, hand.y, range, angle - TORCH.half, angle + TORCH.half);
    c.closePath();
  }

  function drawDarkness(G) {
    const room = G.room;
    mctx.setTransform(scale, 0, 0, scale, 0, 0);
    mctx.globalCompositeOperation = 'source-over';
    mctx.clearRect(0, 0, WORLD.w, WORLD.h);
    mctx.fillStyle = C.dark;
    mctx.fillRect(0, 0, WORLD.w, WORLD.h);
    mctx.globalCompositeOperation = 'destination-out';

    const p = G.player;
    const dead = G.torch.battery === 'dead';
    hole(p.x + PLAYER.w / 2, p.y + PLAYER.h / 2, dead ? 58 : 84, 0.72);
    for (const term of room.terminals) {
      if (term.box) hole(term.x, term.y - 14, 40, 0.45);
      else hole(term.x, term.y - 50, term.port ? 30 : 46, term.port ? 0.32 : 0.5);
    }
    for (const n of room.npcs) hole(n.x, n.y - 20, 46, 0.55);
    for (const pt of room.portals) hole(pt.x, pt.y - 52, 60, 0.5);
    if (room.battery) hole(room.battery.x, room.battery.y - 36, 44, 0.5);
    if (G.canister && !G.canister.carried && G.canister.roomId === room.id) hole(G.canister.x, G.canister.y - 12, 34, 0.5);
    for (const d of room.decor) {
      if (d.type === 'candle') hole(d.x, d.y - 30 + (d.drop || 0), (d.reach || 118) + (Math.sin(G.t * 11) * 4), 0.86);
      if (d.type === 'teleporter') hole(d.x, d.y - 46, 70, 0.55);
    }
    if (room.door) {
      const c = center(doorRect(room.door));
      hole(c.x, c.y - 26, room.door.open ? 96 : 64, room.door.open ? 0.85 : 0.5);
    }

    if (G.torch.active) {
      const hand = handOf(p);
      const g = mctx.createRadialGradient(hand.x, hand.y, 8, hand.x, hand.y, TORCH.range);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.92)');
      g.addColorStop(0.9, 'rgba(0,0,0,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      mctx.fillStyle = g;
      if ('filter' in mctx) mctx.filter = `blur(${Math.round(4 * scale)}px)`;
      beamPath(mctx, hand, G.torch.angle, TORCH.range);
      mctx.fill();
      if ('filter' in mctx) mctx.filter = 'none';
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(mask, 0, 0);
    ctx.restore();

    if (G.torch.active) {
      const hand = handOf(p);
      const g = ctx.createRadialGradient(hand.x, hand.y, 4, hand.x, hand.y, TORCH.range);
      g.addColorStop(0, 'rgba(255,217,138,0.20)');
      g.addColorStop(1, 'rgba(255,217,138,0)');
      ctx.fillStyle = g;
      beamPath(ctx, hand, G.torch.angle, TORCH.range);
      ctx.fill();
    }
  }

  // -- things that glow -----------------------------------------------------

  function drawGhost(G, p, state, prob, lit, percent) {
    const r = slotRect(p, state);
    const jitter = Math.sin(G.t * 9 + p.x + state * 2) * 1.2;
    ctx.save();
    ctx.globalAlpha = 0.3 + 0.7 * prob;
    ctx.fillStyle = 'rgba(94,230,255,0.10)';
    platformPath(p, r.x, r.y + jitter);
    ctx.fill();
    ctx.setLineDash([5, 4]);
    ctx.lineDashOffset = -G.t * 22;
    ctx.strokeStyle = C.qubit;
    ctx.lineWidth = lit ? 2.5 : 1.8;
    ctx.stroke();
    ctx.restore();
    tag(`${state} · ${percent}%`, r.x + r.w / 2, r.y - 12, C.qubit);
  }

  function drawPlatformGlow(G, p) {
    if (p.state === null) {
      const p1 = p.p1;
      const one = Math.round(p1 * 100);
      drawGhost(G, p, 0, 1 - p1, p.exposure > 0, 100 - one);
      drawGhost(G, p, 1, p1, p.exposure > 0, one);
      const mid = { x: p.x + p.w / 2, y: (p.y0 + p.y1 + PLATFORM_H) / 2 };
      if (p.exposure > 0) {
        ctx.strokeStyle = 'rgba(255,217,138,0.25)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, 13, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = C.torch;
        ctx.beginPath();
        ctx.arc(mid.x, mid.y, 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, p.exposure / TORCH.dwell));
        ctx.stroke();
      }
      tag(p.q, mid.x, mid.y + (p.exposure > 0 ? 26 : 0), C.qubit);
      return;
    }
    const flash = Math.max(0, p.flash);
    ctx.fillStyle = flash > 0 ? `rgba(255,255,255,${0.35 + 0.65 * flash})` : p.state ? 'rgba(255,217,138,0.75)' : 'rgba(143,179,255,0.75)';
    ctx.fillRect(p.x + 7, p.y + 1, p.w - 14, 2);
    tag(`${p.q} = ${p.state}`, p.x + p.w / 2, p.y + PLATFORM_H + 11, p.state ? C.one : C.zero);
  }

  function drawStandGlow(s) {
    const ground = s.kind === 'ground';
    ctx.fillStyle = ground ? 'rgba(219,231,245,0.30)' : 'rgba(219,231,245,0.45)';
    ctx.fillRect(s.x + (ground ? 0 : 5), s.y + 1, s.w - (ground ? 0 : 10), 2);
    if (ground) {
      ctx.fillStyle = 'rgba(224,176,64,0.85)';
      if (s.x + s.w < WORLD.w) ctx.fillRect(s.x + s.w - 10, s.y, 10, 4);
      if (s.x > 0) ctx.fillRect(s.x, s.y, 10, 4);
    }
  }

  function sealedTag(G, name, qi, x, y) {
    const definite = G.q ? G.q.definite[qi] : 0;
    tag(definite === null ? `${name} ?` : name, x, y, definite === null ? C.qubit : C.dim);
    return definite;
  }

  function drawTerminalGlow(G, term) {
    const carrying = !!(G.canister && G.canister.carried);
    const s = screenRect(term);
    if (term.box) {
      const r = boxRect(term);
      const pulse = 0.6 + 0.4 * Math.sin(G.t * 5);
      ctx.strokeStyle = carrying ? C.torch : 'rgba(255,217,138,0.5)';
      ctx.globalAlpha = carrying ? pulse : 0.7;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(r.x + r.w / 2, r.y + 19, 5.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const qi = G.level.qubits.findIndex((q) => q.role === 'box');
      if (qi >= 0 && !G.flags.opened) sealedTag(G, G.level.qubits[qi].id, qi, r.x + r.w / 2, r.y - 12);
    } else if (term.port) {
      ctx.fillStyle = '#1a1014';
      rr(ctx, s.x, s.y, s.w, s.h, 2);
      ctx.fill();
      ctx.strokeStyle = '#a04a4a';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(s.x + 9, s.y + 5);
      ctx.lineTo(s.x + s.w - 9, s.y + s.h - 5);
      ctx.moveTo(s.x + s.w - 9, s.y + 5);
      ctx.lineTo(s.x + 9, s.y + s.h - 5);
      ctx.stroke();
      const pulse = 0.6 + 0.4 * Math.sin(G.t * 5);
      ctx.strokeStyle = C.torch;
      ctx.globalAlpha = carrying ? pulse : 0.6;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(term.x, term.y - 15, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      label(term.id.replace('Port ', ''), term.x, term.y - 14.5, C.torch, 8);
    } else {
      ctx.fillStyle = term.near ? '#bff6ff' : '#3fb6cf';
      rr(ctx, s.x, s.y, s.w, s.h, 2);
      ctx.fill();
      label(term.id, s.x + s.w / 2, s.y + s.h / 2 + 0.5, '#06202a', 10);
      ctx.fillStyle = 'rgba(94,230,255,0.55)'; // lit keys
      for (let i = 0; i < 6; i += 1) ctx.fillRect(term.x - 10 + i * 3.6, term.y - 30, 2, 1.5);
    }
    const catOut = !!(term.box && G.flags.opened);
    if (term.near && G.mode === 'play' && (!term.port || carrying || catOut)) {
      const bob = Math.sin(G.t * 5) * 2;
      tag('E', term.x + (catOut ? 3 : 0), s.y - (catOut ? 28 : 14) + bob, C.torch);
    }
    if (term.sealed) {
      const c = cryoRect(term);
      const definite = sealedTag(G, term.sealed, term.sealedQi, c.x + c.w / 2, c.y - 12);
      if (definite === null) {
        ctx.save();
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(G.t * 6);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = C.qubit;
        ctx.lineWidth = 2;
        rr(ctx, c.x - 2, c.y - 2, c.w + 4, c.h + 4, 6);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  function canisterAnchor(G) {
    const c = G.canister;
    if (!c) return null;
    if (c.carried) return { x: G.player.x + PLAYER.w / 2 - G.player.facing * 8, y: G.player.y + 17 };
    if (c.roomId !== G.room.id) return null;
    return center(canisterRect({ x: c.x, y: c.y - 4 }));
  }

  function drawPickupGlow(G) {
    const c = G.canister;
    const at = canisterAnchor(G);
    if (c && at) {
      const definite = G.q ? G.q.definite[c.qi] : 0;
      ctx.save();
      ctx.strokeStyle = definite === null ? C.qubit : 'rgba(219,231,245,0.6)';
      ctx.globalAlpha = definite === null ? 0.6 + 0.4 * Math.sin(G.t * 6) : 0.85;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.ellipse(at.x, at.y, 7, 3, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      if (!c.carried) sealedTag(G, c.q, c.qi, at.x, at.y - 24);
    }
    const b = G.room.battery;
    if (b && !b.taken) {
      const bob = Math.sin(G.t * 4) * 1.5;
      tag('BATTERY', b.x, b.y - 68 + bob, C.ok);
      ctx.fillStyle = 'rgba(125,255,168,0.9)';
      ctx.fillRect(b.x - 5, b.y - 46, 10, 20);
      label('+', b.x, b.y - 36, '#06140c', 11);
    }
  }

  function drawExitSign(r, open) {
    const text = open ? 'EXIT' : 'LOCKED!';
    ctx.font = `800 13px ${SIGN_FONT}`;
    const icon = open ? 16 : 0;
    const w = Math.max(r.w + 4, ctx.measureText(text).width + 14 + icon);
    const x = r.x + r.w / 2 - w / 2;
    ctx.fillStyle = open ? C.ok : '#ff9d8f';
    rr(ctx, x, r.y - 26, w, 16, 3);
    ctx.fill();
    ctx.fillStyle = '#06140c';
    if (open) {
      const ix = x + 5;
      const iy = r.y - 23;
      ctx.beginPath();
      ctx.moveTo(ix, iy + 10);
      ctx.lineTo(ix, iy + 7);
      ctx.lineTo(ix + 3.5, iy + 7);
      ctx.lineTo(ix + 3.5, iy + 4);
      ctx.lineTo(ix + 7, iy + 4);
      ctx.lineTo(ix + 7, iy + 1);
      ctx.lineTo(ix + 11, iy + 1);
      ctx.lineTo(ix + 11, iy + 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + icon + (w - icon) / 2, r.y - 17.5);
  }

  function drawDoorGlow(G) {
    for (const p of G.room.portals) {
      const r = doorRect(p);
      ctx.font = `800 12px ${SIGN_FONT}`;
      const w = ctx.measureText(p.label).width + 14;
      ctx.fillStyle = '#dbe7f5';
      rr(ctx, r.x + r.w / 2 - w / 2, r.y - 25, w, 16, 3);
      ctx.fill();
      ctx.fillStyle = '#0b1220';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.label, r.x + r.w / 2, r.y - 16.5);
      if (p.near && G.mode === 'play') tag('E', r.x + r.w / 2, r.y - 38 + (Math.sin(G.t * 5) * 2), C.torch);
    }
    const door = G.room.door;
    if (!door) return;
    const r = doorRect(door);
    drawExitSign(r, door.open);
    if (!door.key) return;

    const l = lockRect(door);
    label('KEY', l.x + 5, l.y + 16.5, C.torch, 8, 'left');
    label('LOCK', l.x + 5, l.y + 41.5, C.ink, 8, 'left');
    ctx.fillStyle = 'rgba(42,58,88,0.9)';
    ctx.fillRect(l.x + 4, l.y + 28, l.w - 8, 1);
    door.lock.forEach((id, i) => {
      const pos = lampPos(door, i);
      const want = Number(door.key[i]);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = C.torch;
      ctx.fillStyle = want ? C.torch : 'rgba(0,0,0,0)';
      ctx.beginPath();
      ctx.arc(pos.x, pos.keyY, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      label(String(want), pos.x, pos.keyY + 0.5, want ? '#1c1403' : C.torch, 9);
      const state = G.q ? G.q.definite[door.lockQi[i]] : 0;
      ctx.save();
      if (state === null) {
        ctx.setLineDash([2.5, 2.5]);
        ctx.lineDashOffset = -G.t * 14;
        ctx.strokeStyle = C.qubit;
        ctx.beginPath();
        ctx.arc(pos.x, pos.lockY, 7, 0, Math.PI * 2);
        ctx.stroke();
        label('?', pos.x, pos.lockY + 0.5, C.qubit, 9);
      } else {
        const good = state === want;
        ctx.strokeStyle = door.unlocked ? C.ok : good ? C.ink : C.zero;
        ctx.fillStyle = state ? (door.unlocked ? C.ok : C.ink) : 'rgba(0,0,0,0)';
        ctx.beginPath();
        ctx.arc(pos.x, pos.lockY, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        label(String(state), pos.x, pos.lockY + 0.5, state ? '#0b1220' : C.zero, 9);
      }
      ctx.restore();
      label(id, pos.x, pos.lockY + 15.5, C.torch, 8); // which qubit this lamp reads
    });
    if (door.exposure > 0 && !door.unlocked) {
      const c = center(l);
      ctx.strokeStyle = C.torch;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(c.x, l.y - 13, 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, door.exposure / TORCH.dwell));
      ctx.stroke();
    }
    if (door.near && !door.unlocked && G.mode === 'play') tag('E', center(l).x, l.y - 14 + (Math.sin(G.t * 5) * 2), C.torch);
    if (door.deniedT > 0) {
      ctx.strokeStyle = C.bad;
      ctx.lineWidth = 2.5;
      rr(ctx, l.x - 3, l.y - 3, l.w + 6, l.h + 6, 6);
      ctx.stroke();
    }
  }

  function drawDecorGlow(G) {
    for (const d of G.room.decor) {
      if (d.type === 'candle') {
        const flick = Math.sin(G.t * 13) * 0.8;
        ctx.fillStyle = '#ffb347';
        ctx.beginPath();
        ctx.ellipse(d.x + flick * 0.4, d.y - 7, 3, 6 + flick, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff3c4';
        ctx.beginPath();
        ctx.ellipse(d.x, d.y - 5, 1.4, 3, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (d.type === 'plate') {
        ctx.font = `800 12px ${SIGN_FONT}`;
        const w = ctx.measureText(d.text).width + 14;
        ctx.fillStyle = '#dbe7f5';
        rr(ctx, d.x - w / 2, d.y - 8, w, 16, 3);
        ctx.fill();
        ctx.fillStyle = '#0b1220';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(d.text, d.x, d.y + 0.5);
      } else if (d.type === 'teleporter') {
        ctx.save();
        ctx.strokeStyle = C.qubit;
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(G.t * 3);
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 5]);
        ctx.lineDashOffset = -G.t * 18;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y - 46, 18, 30, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        tag('TELEPORTER', d.x, d.y - 104, C.qubit);
      }
    }
    for (const n of G.room.npcs) {
      tag(n.name, n.x, n.y - 46, C.ink);
      if (n.near && G.mode === 'play') tag('E', n.x, n.y - 64 + (Math.sin(G.t * 5) * 2), C.torch);
    }
  }

  function anchorOf(G, qi) {
    const room = G.room;
    for (const p of room.platforms) {
      if (p.qi === qi) {
        const y = p.state === null ? (p.y0 + p.y1 + PLATFORM_H) / 2 : p.y + PLATFORM_H / 2;
        return { x: p.x + p.w / 2, y };
      }
    }
    if (G.canister && G.canister.qi === qi) return canisterAnchor(G);
    for (const term of room.terminals) {
      if (term.sealedQi === qi) return center(cryoRect(term));
      if (term.box && G.level.qubits[qi].role === 'box') return center(boxRect(term));
    }
    if (room.door) {
      const i = room.door.lockQi.indexOf(qi);
      if (i >= 0) {
        const pos = lampPos(room.door, i);
        return { x: pos.x, y: pos.lockY };
      }
    }
    return null;
  }

  function drawLinks(G) {
    if (!G.q) return;
    ctx.save();
    ctx.strokeStyle = C.link;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([2, 6]);
    ctx.lineDashOffset = -G.t * 26;
    ctx.globalAlpha = 0.85;
    for (const group of G.q.groups) {
      const pts = group.map((qi) => anchorOf(G, qi)).filter(Boolean).sort((a, b) => a.x - b.x);
      if (pts.length < 2) continue;
      ctx.beginPath();
      pts.forEach((pt, i) => {
        if (i === 0) ctx.moveTo(pt.x, pt.y);
        else {
          const prev = pts[i - 1];
          ctx.quadraticCurveTo((prev.x + pt.x) / 2, Math.min(prev.y, pt.y) - 34, pt.x, pt.y);
        }
      });
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFx(G) {
    for (const fx of G.fx) {
      const k = Math.min(1, fx.t / fx.dur);
      ctx.save();
      if (fx.type === 'ring') {
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 3 * (1 - k) + 1;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 8 + k * (fx.size || 46), 0, Math.PI * 2);
        ctx.stroke();
      } else if (fx.type === 'spark') {
        const x = fx.from.x + (fx.to.x - fx.from.x) * k;
        const y = fx.from.y + (fx.to.y - fx.from.y) * k - Math.sin(k * Math.PI) * 26;
        ctx.globalAlpha = 0.35 * (1 - k);
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(fx.from.x, fx.from.y);
        ctx.quadraticCurveTo((fx.from.x + fx.to.x) / 2, Math.min(fx.from.y, fx.to.y) - 52, fx.to.x, fx.to.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = fx.color;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    for (const f of G.floaters) {
      const k = Math.min(1, f.t / f.dur);
      ctx.save();
      ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      tag(f.text, f.x, f.y - (18 + k * 20), f.color);
      ctx.restore();
    }
  }

  // -- speech -----------------------------------------------------------------

  function wrap(text, maxWidth) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  function speech(x, y, text, speaker, alpha, more, loud) {
    const font = loud ? `700 18px ${BODY_FONT}` : `400 12px ${BODY_FONT}`;
    const lineH = loud ? 21 : 15;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = font;
    const lines = wrap(text, 216);
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width), speaker ? 60 : 0);
    const w = textW + 18;
    const h = lines.length * lineH + (speaker ? 15 : 0) + 12;
    const bx = Math.max(8, Math.min(WORLD.w - w - 8, x - w / 2));
    const by = Math.max(8, y - h - 9);
    ctx.fillStyle = 'rgba(243,246,251,0.97)';
    rr(ctx, bx, by, w, h, 8);
    ctx.fill();
    const tx = Math.max(bx + 12, Math.min(bx + w - 12, x));
    ctx.beginPath();
    ctx.moveTo(tx - 6, by + h - 1);
    ctx.lineTo(tx, by + h + 8);
    ctx.lineTo(tx + 6, by + h - 1);
    ctx.closePath();
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let ty = by + 7;
    if (speaker) {
      ctx.font = `700 10px ${MONO_FONT}`;
      ctx.fillStyle = '#35607a';
      ctx.fillText(speaker.toUpperCase(), bx + 9, ty);
      ty += 15;
    }
    ctx.font = font;
    ctx.fillStyle = '#101826';
    for (const l of lines) {
      ctx.fillText(l, bx + 9, ty);
      ty += lineH;
    }
    if (more !== undefined) {
      ctx.font = `700 9px ${MONO_FONT}`;
      ctx.fillStyle = '#35607a';
      ctx.textAlign = 'right';
      ctx.fillText(more ? 'E ▸' : 'E ✕', bx + w - 7, by + 6);
    }
    ctx.restore();
  }

  function drawSpeech(G) {
    const head = { x: G.player.x + PLAYER.w / 2, y: G.player.y - 4 };
    for (const b of G.bubbles) {
      if (b.wait > 0) continue;
      if (G.dialogue && b.anchor !== 'player') continue;
      const at = b.anchor === 'player' ? head : b.anchor;
      const fade = Math.min(1, b.t / 0.15, (b.dur - b.t) / 0.4);
      speech(at.x, at.y, b.text, null, Math.max(0, fade));
    }
    const d = G.dialogue;
    if (d) {
      const at = d.anchor === 'player' ? head : d.anchor;
      speech(at.x, at.y - 14, d.lines[d.index], d.speaker, 1, d.index < d.lines.length - 1);
    }
  }

  // -- the terrace (epilogue) ---------------------------------------------------

  const SKY_STARS = Array.from({ length: 80 }, (_, i) => {
    const a = Math.abs(Math.sin(i * 127.1) * 43758.5453) % 1;
    const b = Math.abs(Math.sin(i * 311.7 + 2) * 12543.1234) % 1;
    return { x: a * WORLD.w, y: b * 300, r: i % 6 === 0 ? 1.5 : 0.9, phase: i * 1.7 };
  });
  const SKYLINE = [[186, 70, 46], [276, 52, 80], [344, 92, 34], [466, 60, 66], [546, 86, 40], [658, 48, 92], [716, 80, 52], [814, 72, 70], [892, 68, 120]]; // x, width, height
  const FACADE_WINDOWS = [50, 197, 344, 490, 637, 784];
  const WINDOW = { w: 46, h: 84 };

  const litAt = (x, power) => power > 0.1 + 0.72 * (1 - Math.min(1, x / 800));
  const windowLit = (i, row, power) => power > 0.28 + 0.6 * (((i * 5 + row * 3) % 6) / 6);

  function crankGrip(G) {
    const gen = G.level.scene.generator;
    return { x: gen.x - 36 + Math.cos(G.scene.crank) * 8, y: gen.y - 22 + Math.sin(G.scene.crank) * 8 };
  }

  let festoonCache = null;
  function festoon(s) {
    if (festoonCache) return festoonCache;
    const roof = s.door.y;
    const pts = [{ x: 168, y: roof - 90 }, ...s.lamps.map((x) => ({ x, y: roof - 102 })), { x: s.generator.x + 24, y: roof - 90 }];
    const spans = [];
    const bulbs = [];
    for (let i = 0; i < pts.length - 1; i += 1) {
      const a = pts[i];
      const b = pts[i + 1];
      const mid = { x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 26 };
      spans.push([a, mid, b]);
      const n = Math.max(3, Math.round((b.x - a.x) / 26));
      for (let k = 1; k < n; k += 1) {
        const t = k / n;
        const u = 1 - t;
        bulbs.push({ x: u * u * a.x + 2 * u * t * mid.x + t * t * b.x, y: u * u * a.y + 2 * u * t * mid.y + t * t * b.y + 3 });
      }
    }
    festoonCache = { spans, bulbs };
    return festoonCache;
  }

  function glow(x, y, radius, colour) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, colour);
    g.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  function drawGenerator(G, gen, running) {
    const y = gen.y;
    const hum = running ? Math.sin(G.t * 46) * 0.5 : 0;
    ctx.save();
    ctx.translate(hum, 0);
    ctx.fillStyle = '#1b2740';
    ctx.fillRect(gen.x - 34, y - 4, 68, 4); // skids
    ctx.fillStyle = '#2f4062';
    ctx.fillRect(gen.x + 22, y - 92, 4, 54); // exhaust mast
    ctx.fillRect(gen.x + 19, y - 94, 10, 3);
    ctx.fillStyle = '#4a5a78';
    rr(ctx, gen.x - 20, y - 50, 30, 12, 4); // fuel tank
    ctx.fill();
    ctx.fillStyle = '#3d4f72';
    rr(ctx, gen.x - 30, y - 40, 60, 36, 4); // housing
    ctx.fill();
    ctx.fillStyle = '#5d7299';
    ctx.fillRect(gen.x - 28, y - 40, 56, 3);
    ctx.fillStyle = '#22314c';
    for (let i = 0; i < 4; i += 1) ctx.fillRect(gen.x - 22 + i * 8, y - 29, 4, 17); // vents
    ctx.fillStyle = '#4a2a30';
    ctx.beginPath();
    ctx.arc(gen.x + 18, y - 22, 3, 0, Math.PI * 2); // status lamp, off
    ctx.fill();
    const hub = { x: gen.x - 36, y: y - 22 };
    const grip = crankGrip(G);
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#2f4062';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gen.x - 30, hub.y);
    ctx.lineTo(hub.x, hub.y);
    ctx.stroke();
    ctx.strokeStyle = C.steelLight;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(hub.x, hub.y);
    ctx.lineTo(grip.x, grip.y);
    ctx.stroke();
    ctx.fillStyle = C.hazard;
    ctx.beginPath();
    ctx.arc(grip.x, grip.y, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawPane(x, y, lit) {
    const g = ctx.createLinearGradient(0, y, 0, y + WINDOW.h);
    g.addColorStop(0, lit ? '#ffeab0' : '#25365c');
    g.addColorStop(1, lit ? '#f2b552' : '#16223d');
    ctx.save();
    if (lit) {
      ctx.shadowColor = 'rgba(255,205,120,0.6)';
      ctx.shadowBlur = 18;
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, y, WINDOW.w, WINDOW.h);
    ctx.restore();
    ctx.fillStyle = lit ? '#6b4a16' : '#0a1120';
    ctx.fillRect(x + WINDOW.w / 2 - 1.5, y, 3, WINDOW.h);
    ctx.fillRect(x, y + WINDOW.h / 2 - 1.5, WINDOW.w, 3);
  }

  function drawTerrace(G) {
    const sc = G.scene;
    const s = G.level.scene;
    const roof = s.door.y;
    const gen = s.generator;
    const power = sc.power;
    const { spans, bulbs } = festoon(s);
    const rows = [roof + 48, roof + 170];

    ctx.fillStyle = '#1c2742';
    ctx.fillRect(0, roof + 14, s.edge, WORLD.h - roof - 14);
    ctx.fillStyle = 'rgba(120,150,200,0.10)';
    for (let y = roof + 40; y < WORLD.h; y += 30) ctx.fillRect(0, y, s.edge, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(s.edge - 8, roof + 14, 8, WORLD.h); // the corner of the building
    rows.forEach((y) => {
      for (const x of FACADE_WINDOWS) {
        ctx.fillStyle = '#0a1120';
        ctx.fillRect(x - 4, y - 4, WINDOW.w + 8, WINDOW.h + 8);
        drawPane(x, y, false);
      }
    });
    ctx.fillStyle = C.concrete;
    ctx.fillRect(0, roof, s.edge + 6, 14); // roof slab
    ctx.fillRect(s.edge - 10, roof - 12, 12, 12); // kerb at the edge
    ctx.fillStyle = C.concreteEdge;
    ctx.fillRect(0, roof, s.edge - 10, 3);
    ctx.fillRect(s.edge - 10, roof - 12, 12, 3);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(0, roof + 14, s.edge, 4);

    ctx.fillStyle = '#2b3954';
    ctx.fillRect(56, roof - 94, 112, 94);
    ctx.fillStyle = '#3a4b6c';
    ctx.fillRect(50, roof - 101, 124, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    for (let y = roof - 70; y < roof; y += 24) ctx.fillRect(56, y, 112, 1);
    drawDoorLeaf(doorRect(s.door), sc.doorOpen, '#44597f');
    ctx.fillStyle = '#16213a';
    rr(ctx, s.door.x - 7, roof - 90, 14, 8, 3); // lamp over the door
    ctx.fill();

    for (const x of s.lamps) {
      ctx.fillStyle = '#2f4062';
      ctx.fillRect(x - 1.5, roof - 102, 3, 102);
      ctx.fillRect(x - 7, roof - 4, 14, 4);
      ctx.fillStyle = '#16213a';
      rr(ctx, x - 6, roof - 116, 12, 14, 3); // lantern
      ctx.fill();
    }
    ctx.strokeStyle = '#0d1424';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [a, mid, b] of spans) {
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y);
    }
    ctx.stroke();
    ctx.fillStyle = '#56627e';
    for (const b of bulbs) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const a of sc.actors) {
      if (!a.out) continue;
      drawPerson(a.x, roof, PEOPLE[a.kind], { armsUp: sc.alarm, step: a.moving ? Math.sin(a.anim * 12) : 0 });
    }
    const cat = sc.cat;
    if (cat.state === 'sit') drawCat(cat.x, cat.y - 1);
    else if (cat.state === 'trot' || cat.state === 'run') drawCatRun(cat.x, cat.y, Math.sin(cat.anim * (cat.state === 'run' ? 26 : 18)), 0);
    else if (cat.state === 'jump') drawCatRun(cat.x, cat.y, 0.9, Math.atan2(cat.vy, 230) * 0.7);
    drawGenerator(G, gen, power > 0);
    if (G.player.visible) drawPlayer(G);

    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = `rgba(5,9,24,${0.46 - 0.32 * power})`;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    for (const x of s.lamps) if (litAt(x, power)) glow(x, roof - 100, 170, 'rgba(255,214,140,0.24)');
    if (litAt(s.door.x, power)) glow(s.door.x, roof - 80, 110, 'rgba(255,214,140,0.22)');

    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = 'rgba(255,214,140,0.5)';
    SKYLINE.forEach(([x, w, h], n) => {
      for (let k = 0; k < 4; k += 1) ctx.fillRect(x + 8 + ((n * 17 + k * 23) % Math.max(1, w - 16)), roof - h + 10 + ((n * 29 + k * 31) % Math.max(1, h - 4)), 3, 4);
    });
    ctx.fillStyle = '#0d1530';
    for (const [x, w, h] of SKYLINE) ctx.fillRect(x, roof - h, w, WORLD.h - roof + h);
    const moon = { x: 846, y: 78, r: 30 };
    ctx.fillStyle = '#d8d2b6';
    for (const [dx, dy, r] of [[-9, -6, 6], [8, 5, 4.5], [-3, 12, 3.5], [11, -11, 3]]) {
      ctx.beginPath();
      ctx.arc(moon.x + dx, moon.y + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#f4efda';
    ctx.beginPath();
    ctx.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
    ctx.fill();
    glow(moon.x, moon.y, 120, 'rgba(210,220,255,0.28)');
    for (const st of SKY_STARS) {
      ctx.globalAlpha = 0.55 + 0.4 * Math.sin(G.t * 1.3 + st.phase);
      ctx.fillStyle = '#e8eeff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    const sky = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    sky.addColorStop(0, '#060a1c');
    sky.addColorStop(0.62, '#1a2852');
    sky.addColorStop(1, '#0d1634');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, WORLD.w, WORLD.h);

    ctx.globalCompositeOperation = 'source-over';
    rows.forEach((y, row) => {
      FACADE_WINDOWS.forEach((x, i) => {
        if (windowLit(i, row, power)) drawPane(x, y, true);
      });
    });
    for (const b of bulbs) {
      if (!litAt(b.x, power)) continue;
      glow(b.x, b.y, 13, 'rgba(255,214,140,0.5)');
      ctx.fillStyle = '#fff1c2';
      ctx.beginPath();
      ctx.arc(b.x, b.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const x of s.lamps) {
      if (!litAt(x, power)) continue;
      glow(x, roof - 109, 46, 'rgba(255,214,140,0.55)');
      ctx.fillStyle = '#fff1c2';
      rr(ctx, x - 4, roof - 114, 8, 10, 2);
      ctx.fill();
    }
    if (litAt(s.door.x, power)) {
      glow(s.door.x, roof - 86, 30, 'rgba(255,214,140,0.55)');
      ctx.fillStyle = '#fff1c2';
      rr(ctx, s.door.x - 5, roof - 89, 10, 6, 2);
      ctx.fill();
    }
    if (power > 0) {
      ctx.fillStyle = C.ok;
      ctx.beginPath();
      ctx.arc(gen.x + 18, roof - 22, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    const bob = Math.sin(G.t * 5) * 2;
    if (sc.phase === 'walk') {
      tag('GENERATOR', gen.x, roof - 108, C.ok);
      if (sc.near) tag('E', gen.x - 36, roof - 46 + bob, C.torch);
    }
    for (const a of sc.actors) {
      if (!a.out) continue;
      tag(a.name, a.x, roof - 46, C.ink);
      if (sc.alarm) {
        const hop = Math.abs(Math.sin(G.t * 9 + a.x)) * 3;
        ctx.fillStyle = 'rgba(7,11,20,0.85)';
        ctx.beginPath();
        ctx.arc(a.x, roof - 70 - hop, 10, 0, Math.PI * 2);
        ctx.fill();
        label('!', a.x, roof - 69 - hop, C.torch, 17, 'center', SIGN_FONT);
      }
    }
    if (sc.line) {
      const who = sc.actors.find((a) => a.id === sc.line.follow);
      const at = who ? { x: who.x, y: roof - 58 } : { x: cat.x + 6, y: cat.y - 26 };
      speech(at.x, at.y, sc.line.text, sc.line.who, 1, undefined, !who);
    }
    drawSpeech(G);
    if (sc.fade > 0) {
      ctx.fillStyle = `rgba(3,6,12,${sc.fade})`;
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    }
  }

  // -- frame ----------------------------------------------------------------

  function draw(G) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, WORLD.w, WORLD.h);
    if (!G.level || !G.room) {
      ctx.fillStyle = '#070b14';
      ctx.fillRect(0, 0, WORLD.w, WORLD.h);
      return;
    }
    if (G.level.outdoor) {
      drawTerrace(G);
      return;
    }
    const room = G.room;
    const shake = G.shake;
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 8, (Math.random() - 0.5) * shake * 8);

    drawWall(G);
    drawWindows(G, false);
    drawDecor(G);
    for (const p of room.platforms) drawRails(p);
    drawSolids(G);
    for (const p of room.platforms) if (p.state !== null) drawPlatformBody(p);
    drawDoors(G);
    for (const term of room.terminals) drawTerminal(G, term);
    drawPickups(G);
    drawNpcs(G);
    if (G.player.visible) drawPlayer(G);

    drawDarkness(G);

    drawWindows(G, true);
    for (const s of room.solids) drawStandGlow(s);
    drawLinks(G);
    for (const p of room.platforms) drawPlatformGlow(G, p);
    for (const term of room.terminals) drawTerminalGlow(G, term);
    drawPickupGlow(G);
    drawDoorGlow(G);
    drawDecorGlow(G);
    drawFx(G);
    drawSpeech(G);
    ctx.restore();
  }

  return { draw, resize, anchorOf };
}
