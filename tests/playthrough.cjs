// End-to-end playthrough: a bot plays all seven floors and the ending in a real
// browser, using only the keyboard, the pointer and the on-screen gate buttons,
// against whichever engine the page loads.
//
//   python dev/server.py --port 8123 &
//   NODE_PATH=$(npm root -g) node tests/playthrough.cjs http://127.0.0.1:8123/dev/ [screenshot-dir]
//
// Add ?engine=js to the URL to run the same playthrough on the JavaScript stand-in.
// Needs the `playwright` package and a Chromium it can launch.

const { chromium } = require('playwright');

const url = process.argv[2] || 'http://127.0.0.1:8123/dev/';
const shotDir = process.argv[3] || null;

// Runs inside the page: drives the game through real DOM events.
function installBot() {
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const G = () => window.blackoutLab.state;
  const down = {};
  const key = (code, on) => {
    if (!!down[code] === on) return;
    down[code] = on;
    window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code, key: code, bubbles: true, cancelable: true }));
  };
  const tap = async (code) => {
    key(code, true);
    await frame();
    key(code, false);
    await frame();
  };
  async function until(test, ms, what) {
    const end = performance.now() + (ms || 8000);
    while (performance.now() < end) {
      if (test()) return true;
      await frame();
    }
    key('ArrowLeft', false);
    key('ArrowRight', false);
    throw new Error(`timed out waiting for ${what || test}`);
  }
  const feet = () => G().player.y + 32;
  const mid = () => G().player.x + 9;
  function surface() {
    const g = G();
    const pl = g.player;
    const all = [...g.room.solids, ...g.room.platforms.filter((p) => p.state !== null).map((p) => ({ x: p.x, y: p.y, w: p.w }))];
    return all.find((s) => Math.abs(s.y - feet()) < 3 && pl.x + 18 > s.x && pl.x < s.x + s.w);
  }
  // Hold left or right as needed to bring the player's centre to x.
  function steer(x, slack) {
    const off = x - mid();
    key('ArrowRight', off > slack);
    key('ArrowLeft', off < -slack);
  }
  async function walkTo(x) {
    const pl = G().player;
    await until(() => {
      steer(x, 3);
      return Math.abs(x - mid()) <= 3 || G().mode !== 'play';
    }, 7000, `walk to ${x}`);
    steer(mid(), 99);
    await until(() => Math.abs(pl.vx) < 1 || G().mode !== 'play', 2000, 'stop');
  }
  // Jump from the current surface onto the rectangle {x, w, y}, steering in the air.
  async function hop(target) {
    const pl = G().player;
    const from = surface();
    if (!from) throw new Error('hop: not standing on anything');
    const goal = target.x + target.w / 2;
    const dir = goal > mid() ? 1 : -1;
    const edge = dir > 0 ? from.x + from.w : from.x;
    key(dir > 0 ? 'ArrowRight' : 'ArrowLeft', true);
    await until(() => (dir > 0 ? pl.x + 18 >= edge - 2 : pl.x <= edge + 2), 6000, 'reach the edge');
    key('Space', true);
    await frame();
    key('Space', false);
    await until(() => !pl.onGround, 1000, 'leave the ground');
    await until(() => {
      steer(goal, 4);
      return pl.onGround || G().mode !== 'play';
    }, 4000, 'land');
    await until(() => {
      steer(goal, 6);
      return Math.abs(goal - mid()) <= 6 || !pl.onGround || G().mode !== 'play';
    }, 3000, 'centre');
    steer(mid(), 99);
    await until(() => Math.abs(pl.vx) < 1 || G().mode !== 'play', 2000, 'stop');
    const landed = Math.abs(feet() - target.y) <= 3;
    if (!landed || !['play', 'complete'].includes(G().mode)) throw new Error(`hop missed: feet ${feet()} target ${target.y} mode ${G().mode}`);
  }
  function aim(x, y) {
    const canvas = document.getElementById('game');
    const r = canvas.getBoundingClientRect();
    canvas.dispatchEvent(
      new PointerEvent('pointermove', { clientX: r.left + (x / 960) * r.width, clientY: r.top + (y / 540) * r.height, bubbles: true })
    );
  }
  const platform = (q) => G().platforms.find((p) => p.q === q);
  const slab = (q) => {
    const p = platform(q);
    return { x: p.x, w: p.w, y: p.state ? p.y1 : p.y0 };
  };
  const solid = (i) => G().room.solids[i];
  // Wait for a platform that was flipped to finish sliding.
  const settle = (q) => until(() => platform(q).y === platform(q).targetY, 3000, `${q} to stop moving`);
  // Shine the flashlight on a superposed platform until it collapses; returns 0 or 1.
  async function observe(q) {
    const p = platform(q);
    if (p.state !== null) return p.state;
    const pl = G().player;
    const d = (y) => Math.hypot(p.x + p.w / 2 - pl.x, y - pl.y);
    aim(p.x + p.w / 2, (d(p.y1) < d(p.y0) ? p.y1 : p.y0) + 7);
    await until(() => p.state !== null, 6000, `collapse of ${q}`);
    aim(pl.x, 20); // look away again
    await frame();
    return p.state;
  }
  // Use a terminal or port: `picks` are 1-based positions of the gate buttons to press.
  async function terminal(id, picks) {
    const g = G();
    const term = g.room.terminals.find((t) => t.id === id);
    if (!term) throw new Error(`no terminal ${id} in this room`);
    await walkTo(term.x);
    await until(() => term.near, 2000, `stand at ${id}`);
    aim(g.player.x, 20);
    await tap('KeyE');
    await until(() => G().mode === 'terminal', 2000, `${id} to open`);
    for (const n of picks) {
      const button = document.querySelectorAll('#term-ops button')[n - 1];
      if (!button || button.disabled) throw new Error(`gate ${n} at ${id} is not available`);
      const before = G().q.ops.length;
      button.click();
      await until(() => G().q.ops.length > before && !G().busy, 5000, `gate ${n} at ${id}`);
    }
    await tap('Escape'); // Esc must not leave a terminal: only E does
    await frame();
    if (G().mode !== 'terminal') throw new Error(`Esc closed ${id}`);
    await tap('KeyE');
    await until(() => G().mode === 'play', 2000, `${id} to close`);
  }
  // Talk to someone until they have nothing more to say (later lines may arrive after a measurement).
  async function talk(id) {
    const npc = G().room.npcs.find((n) => n.id === id);
    await walkTo(npc.x - 20);
    await until(() => npc.near, 2000, `stand by ${id}`);
    await tap('KeyE');
    await until(() => G().mode === 'dialogue', 2000, `${id} to speak`);
    let quiet = 0;
    while (quiet < 25) {
      if (G().mode === 'dialogue') {
        quiet = 0;
        await tap('KeyE');
      } else {
        quiet += 1;
        await frame();
      }
    }
  }
  async function through(label) {
    const portal = G().room.portals.find((p) => p.label === label);
    const before = G().room.id;
    await walkTo(portal.x);
    await tap('KeyE');
    await until(() => G().room.id !== before, 2000, `go through ${label}`);
  }
  // Read the exit lock with the flashlight; true if it opened.
  async function unlock() {
    const d = G().door;
    const w = 30 + d.lock.length * 20;
    await until(() => d.deniedT <= 0 && !d.pending, 4000, 'the last refusal to clear');
    aim(d.x - 32 - w / 2, d.y - 55);
    await until(() => d.unlocked || (d.deniedT > 0 && !d.pending), 6000, 'the lock to answer');
    const ok = d.unlocked;
    aim(G().player.x, 20);
    await until(() => d.exposure === 0, 1000, 'look away');
    return ok;
  }
  // Read the exit lock with the E key (the only way when the flashlight is dead).
  async function unlockByHand() {
    const d = G().door;
    const left = d.x - 32 - (30 + d.lock.length * 20);
    await walkTo((left + d.x + 22) / 2);
    await until(() => d.near && d.deniedT <= 0 && !d.pending, 4000, 'stand at the lock');
    await tap('KeyE');
    await until(() => d.unlocked || (d.deniedT > 0 && !d.pending), 6000, 'the lock to answer');
    return d.unlocked;
  }
  async function exit() {
    if (G().mode !== 'complete') await walkTo(G().door.x);
    await until(() => G().mode === 'complete', 3000, 'floor to complete');
  }
  window.bot = { G, frame, key, tap, until, walkTo, hop, aim, observe, terminal, talk, through, unlock, unlockByHand, exit, slab, solid, platform, settle };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_TUNNEL|fonts\.g/.test(m.text())) problems.push(`console: ${m.text()}`);
    if (/frame error/.test(m.text())) problems.push(m.text());
  });
  const shot = async (name) => {
    if (shotDir) await page.screenshot({ path: `${shotDir}/${name}.png` });
  };
  const report = [];
  const step = async (label, fn) => {
    try {
      const out = await page.evaluate(fn);
      if (out) report.push(out);
    } catch (err) {
      await shot(`FAILED-${label.replace(/\W+/g, '-')}`);
      throw new Error(`${label}: ${err.message.split('\n')[0]}`);
    }
  };
  const nextFloor = async (index) => {
    await page.click('#btn-next');
    await page.waitForFunction((n) => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === n, index);
    await page.waitForTimeout(200);
  };

  await page.goto(url);
  await page.waitForFunction(() => !document.getElementById('btn-start').disabled, null, { timeout: 60000 });
  await shot('00-title');
  const rack = () =>
    page.evaluate(() => ({ about: !document.getElementById('about').hidden, circuit: !document.getElementById('circuit').closest('.module').hidden }));
  let r = await rack();
  if (!r.about || r.circuit) throw new Error(`the title screen should show the About panel, not the instruments: ${JSON.stringify(r)}`);
  await page.evaluate(installBot);
  // In through "Skip to floor" this time; "Enter the building" is used after the ending.
  await page.click('#btn-floors');
  const offered = await page.$$eval('#title-floors:not([hidden]) button', (els) => els.map((el) => el.textContent));
  if (offered.length !== 7 || offered[6] !== '7. Lights Out') throw new Error(`"Skip to floor" should list the seven floors: ${JSON.stringify(offered)}`);
  await page.click('#title-floors button[data-floor="0"]');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);
  if (await page.$('#opt-motion')) throw new Error('the reduce-motion option should be gone');
  r = await rack();
  if (r.about || !r.circuit) throw new Error(`in play the rack should show the instruments: ${JSON.stringify(r)}`);

  // Floor 1: H, look, repeat until the platform lands raised.
  await step('floor 1 superpose', async () => {
    await bot.terminal('T1', [1]);
  });
  await page.waitForTimeout(120);
  await shot('01-superposition');
  // The circuit can be expanded: it moves under the game and is drawn whole, with nothing to scroll.
  const circuitBox = () =>
    page.evaluate(() => {
      const mod = document.getElementById('circuit').closest('.module');
      const gates = document.getElementById('circuit-gates');
      return { under: !!mod.closest('.left'), fits: gates.scrollWidth <= gates.clientWidth + 1, label: document.getElementById('circuit-expand').textContent };
    });
  await page.click('#circuit-expand');
  let box = await circuitBox();
  if (!box.under || !box.fits || box.label !== 'Collapse') throw new Error(`expanded circuit: ${JSON.stringify(box)}`);
  await shot('01b-circuit-expanded');
  await page.click('#circuit-expand');
  box = await circuitBox();
  if (box.under || box.label !== 'Expand') throw new Error(`collapsed circuit: ${JSON.stringify(box)}`);
  await step('floor 1', async () => {
    let tries = 1;
    while ((await bot.observe('A')) !== 1) {
      await bot.terminal('T1', [1]);
      tries += 1;
    }
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    do {
      await bot.terminal('T2', [1]);
      tries += 1;
    } while ((await bot.observe('B')) !== 1);
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.exit();
    return `floor 1 cleared after ${tries} H gates, stats ${JSON.stringify(bot.G().stats)}`;
  });
  await nextFloor(1);

  // Floor 2: X, then H-X on B (which earns the fourth star). On C: one gamble first, then H-Z-H, which earns it too.
  await step('floor 2', async () => {
    await bot.tap('KeyF');
    await bot.terminal('T1', [1]);
    await bot.settle('A');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    if (bot.G().bonusDone) throw new Error('X on A alone should not earn the fourth star');
    await bot.terminal('T2', [1, 2]);
    await bot.settle('B');
    if (!bot.G().bonusDone) throw new Error('H then X on B should earn the fourth star');
    bot.G().bonusDone = false; // set aside, to check that C can earn it on its own
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.terminal('T3', [1]);
    await bot.tap('KeyF');
    const gamble = await bot.observe('C');
    await bot.tap('KeyF');
    if (bot.G().bonusDone) throw new Error('a single H and a look is not the flip gate');
    await bot.terminal('T3', [1, 2, 1]);
    if (bot.platform('C').state !== 1 - gamble) throw new Error('H Z H should flip C with certainty');
    if (!bot.G().bonusDone) throw new Error('H Z H should count as the flip gate even after a look');
    if (gamble === 1) await bot.terminal('T3', [1, 2, 1]);
    await bot.settle('C');
    if (bot.platform('C').state !== 1) throw new Error('H Z H did not raise C');
    await bot.hop(bot.slab('C'));
    await bot.hop(bot.solid(3));
    await bot.exit();
    const s = bot.G().stats;
    const r = bot.G().results[1];
    const list = [...document.querySelectorAll('#complete-star-list li')].map((li) => li.textContent);
    if (r.stars !== 4 || r.of !== 4 || list.length !== 4) throw new Error(`H Z H on C should earn the fourth star: ${JSON.stringify(r)} ${JSON.stringify(list)}`);
    return `floor 2 cleared: gambled on C (got ${gamble}), then H Z H; ${r.stars} of ${r.of} stars ("${list[3]}"), stats ${JSON.stringify(s)}`;
  });
  await nextFloor(2);

  // Floor 3: the canister. A dead port refuses you without it; one look at A reads the canister too.
  await step('floor 3 canister', async () => {
    const g = bot.G();
    if (g.canister.carried) throw new Error('the canister should start on its dock');
    await bot.walkTo(g.canister.x);
    await bot.until(() => g.canister.carried, 2000, 'pick up the canister');
    await bot.terminal('T1', [1]);
    await bot.terminal('Port A', [1]);
    if (JSON.stringify(g.q.groups) !== '[[0,1]]') throw new Error(`Q and A should be entangled: ${JSON.stringify(g.q.groups)}`);
  });
  await page.waitForTimeout(150);
  await shot('03-canister-entangled');
  await step('floor 3', async () => {
    const g = bot.G();
    let tries = 1;
    while ((await bot.observe('A')) !== 1) {
      if (g.q.definite[g.qIndex.Q] !== 0) throw new Error('the canister should read 0 when A dropped');
      await bot.terminal('T1', [1]);
      await bot.terminal('Port A', [1]);
      tries += 1;
    }
    if (g.q.definite[g.qIndex.Q] !== 1) throw new Error('the canister should read 1 when A rose');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    await bot.terminal('Port B', [1]);
    await bot.settle('B');
    if (bot.platform('B').state !== 1) throw new Error('a canister reading 1 should raise B');
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.walkTo(g.door.x - 120);
    if (await bot.unlock()) throw new Error('the door opened without a key');
    await bot.terminal('Port D', [1]);
    await bot.walkTo(g.door.x - 120);
    if (!(await bot.unlock())) throw new Error('the right key was refused');
    await bot.exit();
    return `floor 3 cleared after ${tries} entangling rounds, stats ${JSON.stringify(g.stats)}`;
  });
  await nextFloor(3);

  // Floor 4: failing flashlight, battery station, a far terminal, a two-lamp key.
  await step('floor 4 start', async () => {
    const g = bot.G();
    if (g.torch.battery !== 'low') throw new Error('the flashlight should start low');
    await bot.walkTo(g.canister.x);
    do {
      await bot.terminal('T1', [1]);
      await bot.terminal('Port A', [1]);
    } while ((await bot.observe('A')) !== 1);
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    if (g.torch.battery !== 'low') throw new Error('the flashlight should last until the battery ledge');
    await bot.hop(bot.solid(2));
    if (g.torch.battery !== 'dead') throw new Error('the flashlight should die on the battery ledge');
    const spoken = () => (g.bubbles.find((b) => b.anchor === 'player' && !(b.wait > 0)) || {}).text || '';
    if (!/It just died/.test(spoken())) throw new Error(`the player should say the flashlight died, not "${spoken()}"`);
    await bot.tap('KeyF');
    if (g.torch.active) throw new Error('a dead flashlight must not light');
    if (!/It just died/.test(spoken())) throw new Error('a new line should wait until the last one has had time to be read');
    await bot.walkTo(g.room.battery.x);
    await bot.until(() => g.room.battery.taken, 2000, 'take the battery');
    if (g.torch.battery !== 'ok') throw new Error('the battery should fix the flashlight');
  });
  await shot('04-battery-station');
  await step('floor 4', async () => {
    const g = bot.G();
    let trips = 0;
    for (;;) {
      await bot.terminal('T2', [1]);
      trips += 1;
      await bot.hop(bot.solid(1));
      if ((await bot.observe('F')) === 1) break;
      await bot.hop(bot.solid(2));
    }
    await bot.hop(bot.solid(3));
    await bot.hop(bot.slab('F'));
    await bot.hop(bot.solid(4));
    await bot.terminal('T3', [1, 2]);
    await bot.walkTo(g.door.x - 130);
    if (!(await bot.unlock())) throw new Error('the 1 1 key was refused');
    await bot.exit();
    return `floor 4 cleared after ${trips} trip(s) to the far terminal, stats ${JSON.stringify(g.stats)}`;
  });
  await nextFloor(4);

  // Floor 5: the Professor's box. Both bridge halves must read 1; one CNOT at the box makes the cat certain.
  await step('floor 5 to the professor', async () => {
    const g = bot.G();
    if (JSON.stringify(g.q.groups) !== '[[3,4]]') throw new Error(`Q and CAT should start entangled: ${JSON.stringify(g.q.groups)}`);
    // Without T1 there is no way across: jumping on from the start ledge, and again
    // from lowered A, never reaches the bridge or the next stand and ends in the gap.
    bot.key('ArrowRight', true);
    await bot.until(() => g.player.x + 18 >= 148, 3000, 'reach the edge');
    await bot.tap('Space');
    let again = false;
    let highest = 475;
    await bot.until(() => {
      const pl = g.player;
      if (pl.onGround) highest = Math.min(highest, pl.y + 32);
      if (!again && pl.onGround && pl.x > 160 && pl.x + 18 >= 272) {
        again = true;
        bot.key('Space', true);
      } else if (again) bot.key('Space', false);
      return g.mode !== 'play';
    }, 8000, 'the fall');
    bot.key('ArrowRight', false);
    if (g.mode !== 'falling' || highest < 475) throw new Error(`the first gap should not be crossable without T1 (stood at y=${highest})`);
    await bot.until(() => g.mode === 'play', 4000, 'the floor to reset');
    await bot.terminal('T1', [1]);
    await bot.settle('A');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    await bot.hop(bot.solid(2));
    await bot.hop(bot.solid(3));
    if (g.door.open) throw new Error('the exit should be locked');
    await bot.talk('professor');
    if (g.hasKey) throw new Error('the Professor must not open an uncertain box');
    await bot.hop(bot.solid(4));
    await bot.terminal('T2', [1, 2]);
    if (g.room.terminals.find((t) => t.id === 'T2').ops.length !== 2) throw new Error('T2 should offer H on E and CNOT E to F only');
  });
  await page.waitForTimeout(150);
  await shot('05-broken-bridge');
  await step('floor 5', async () => {
    const g = bot.G();
    let tries = 1;
    while ((await bot.observe('E')) !== 1) {
      await bot.terminal('T2', [1, 2]);
      tries += 1;
    }
    if (bot.platform('F').state !== 1) throw new Error('the two halves should rise together');
    await bot.hop(bot.slab('E'));
    await bot.hop(bot.slab('F'));
    await bot.hop(bot.solid(5));
    await bot.walkTo(g.canister.x);
    await bot.until(() => g.canister.carried, 2000, 'take the canister');
    await bot.hop(bot.slab('F'));
    await bot.hop(bot.slab('E'));
    await bot.hop(bot.solid(4));
    await bot.hop(bot.solid(3));
    await bot.terminal('Box port', [1]);
    if (g.q.definite[g.qIndex.CAT] !== 0) throw new Error('CNOT Q to CAT should leave the atom certainly intact');
    await bot.talk('professor');
    await bot.until(() => g.hasKey && g.door.open, 3000, 'the key');
    const box = g.room.terminals.find((t) => t.box);
    await bot.walkTo(box.x - 14);
    await bot.until(() => box.near, 2000, 'stand by the box');
    await bot.frame();
    const prompt = document.getElementById('prompt').textContent;
    if (!/pet the cat/.test(prompt)) throw new Error(`the box should offer the cat, not its port: "${prompt}"`);
    await bot.tap('KeyE');
    await bot.frame();
    if (g.mode !== 'play' || !g.bubbles.some((b) => b.cat && /meow/.test(b.text))) throw new Error('petting the cat should get a meow');
    await bot.exit();
    return `floor 5 cleared after ${tries} bridge round(s), cat petted, stats ${JSON.stringify(g.stats)}`;
  });
  await shot('06-cat-alive');
  await nextFloor(5);

  // Floor 6: teleportation, twice if the first note calls for a fix: once skipping it (refused), once properly.
  const teleport = async (label, skipFix) =>
    step(label, async () => {
      const g = bot.G();
      const lamps = [...document.querySelectorAll('#probs .q-chip.q-door')].map((el) => el.textContent).join(' ');
      if (lamps !== 'B L') throw new Error(`both lock qubits should be marked in the rack, got "${lamps}"`);
      if (!g.canister.carried) {
        await bot.talk('bob');
        await bot.walkTo(g.canister.x);
        await bot.until(() => g.canister.carried, 2000, 'take the canister');
      }
      await bot.terminal('T1', [1, 2]);
      while (bot.platform('P').state !== 1) {
        await bot.terminal('T2', [1]); // H only: the platform has to be observed
        if (bot.platform('P').state !== null) throw new Error('T2 should leave P in superposition');
        await bot.observe('P');
      }
      await bot.settle('P');
      await bot.hop(bot.slab('P'));
      await bot.hop(bot.solid(1));
      await bot.through('TO ALICE');
      await bot.talk('alice');
      await bot.terminal('T3', [1, 2, 3]);
      const note = g.flags.note;
      if (!note) throw new Error('Alice should have printed a note');
      await bot.through('TO BOB');
      const needed = [...(note.q ? [3] : []), ...(note.m ? [4] : [])];
      const skip = window.skipFix && needed.length > 0; // a 0 0 note needs no fix, so there is nothing to skip
      await bot.hop(bot.slab('P'));
      await bot.hop(bot.solid(0));
      const fixes = skip ? [] : needed;
      if (fixes.length) await bot.terminal('T1', fixes);
      await bot.hop(bot.slab('P'));
      await bot.hop(bot.solid(1));
      await bot.hop(bot.solid(2));
      const opened = await bot.unlockByHand();
      if (skip) {
        if (opened) throw new Error(`the lock opened although the fix for M=${note.m} Q=${note.q} was skipped`);
        await bot.until(() => !g.door.pending, 3000, 'a fresh key');
        if (g.flags.note || JSON.stringify(g.q.groups) !== '[[3,4]]') throw new Error('a refused key should be replaced by a fresh entangled one');
        await bot.hop(bot.solid(1));
        await bot.hop(bot.slab('P'));
        await bot.hop(bot.solid(0));
        return `floor 6: skipping the fix for M=${note.m} Q=${note.q} was refused, and a fresh key was prepared`;
      }
      if (!opened) throw new Error(`the lock refused a correct teleport, note M=${note.m} Q=${note.q}`);
      await bot.exit();
      if (g.stats.looks < 1) throw new Error('reaching Alice should have taken at least one observation');
      return `floor 6 cleared: note M=${note.m} Q=${note.q}, stats ${JSON.stringify(g.stats)}`;
    });
  await page.evaluate(() => {
    window.skipFix = true;
  });
  await teleport('floor 6 without the fix');
  await shot('07-teleport-refused');
  if (await page.evaluate(() => window.blackoutLab.state.mode !== 'complete')) {
    await page.evaluate(() => {
      window.skipFix = false;
    });
    await teleport('floor 6');
  }
  await shot('08-teleported');
  await nextFloor(6);

  // Floor 7: no flashlight. Every platform is put in place with gates alone: D lowered, the rest raised.
  await step('floor 7', async () => {
    const g = bot.G();
    if (g.torch.battery !== 'dead') throw new Error('the flashlight should be dead');
    await bot.tap('KeyF');
    if (g.torch.active) throw new Error('a dead flashlight must not light');
    await bot.terminal('T1', [1, 2, 1]);
    await bot.settle('A');
    await bot.hop(bot.slab('A'));
    await bot.hop(bot.solid(1));
    await bot.terminal('T2', [1, 2, 3]);
    await bot.settle('B');
    await bot.settle('E');
    await bot.hop(bot.slab('B'));
    await bot.hop(bot.solid(2));
    await bot.terminal('T3', [1, 2, 3]);
    await bot.settle('C');
    await bot.settle('D');
    const d = g.q.definite;
    const got = ['A', 'B', 'C', 'D', 'E'].map((q) => d[g.qIndex[q]]).join('');
    if (got !== '11101') throw new Error(`A B C D E should be certain 1 1 1 0 1, got ${got}`);
    if (!document.querySelector('#circuit-labels').textContent.includes('D')) throw new Error('platform D should be named in the rack');
    await bot.hop(bot.slab('C'));
    await bot.hop(bot.slab('D'));
    await bot.hop(bot.slab('E'));
    await bot.hop(bot.solid(3));
    if (g.player.x > g.door.x + 300) throw new Error('the exit ledge should be at the top left');
    await bot.terminal('T4', [1, 3]);
    if (!(await bot.unlockByHand())) throw new Error('the 1 0 1 key was refused');
    await bot.exit();
    if (g.stats.looks !== 0 || g.stats.gates !== 11) throw new Error(`floor 7 should take 11 gates and no observations: ${JSON.stringify(g.stats)}`);
    const line = document.getElementById('complete-stats').textContent;
    if (!/no observations/.test(line) || !/no unlucky collapses/.test(line)) throw new Error(`floor 7 summary: "${line}"`);
    const res = g.results[6];
    const list = [...document.querySelectorAll('#complete-star-list li')].map((li) => li.textContent);
    if (res.of !== 4 || list[3] !== 'Completed within 2 minutes') throw new Error(`floor 7 should have a timed fourth star: ${JSON.stringify(list)}`);
    if ((res.stars === 4) !== (g.floorTime <= 120)) throw new Error(`timed star does not match the time taken: ${res.stars} stars in ${g.floorTime}s`);
    return `floor 7 cleared in the dark in ${Math.round(g.floorTime)} s, ${res.stars} of ${res.of} stars, summary "${line}"`;
  });
  await shot('09-floor7-complete');

  // The ending: up to the terrace, crank the generator, and the rest plays itself.
  await nextFloor(7);
  await shot('10-terrace');
  await step('terrace', async () => {
    const g = bot.G();
    const sc = g.scene;
    if (!g.level.outdoor || sc.phase !== 'walk') throw new Error('the last exit should lead to the terrace');
    if (g.player.x > 260) throw new Error(`the player should arrive at the left of the terrace, not x=${g.player.x}`);
    bot.key('ArrowRight', true);
    await bot.until(() => sc.near, 9000, 'reach the generator');
    await bot.until(() => g.player.x + 18 > g.level.scene.generator.x - 50, 3000, 'walk up to the crank');
    bot.key('ArrowRight', false);
    await bot.until(() => Math.abs(g.player.vx) < 1, 2000, 'stop');
    if (g.player.x + 18 >= g.level.scene.generator.x - 30) throw new Error('the player should not walk through the generator');
    await bot.tap('KeyE');
    await bot.until(() => sc.phase === 'power', 6000, 'the generator to catch');
    await bot.until(() => sc.power === 1, 6000, 'every light to come on');
  });
  await shot('11-power-restored');
  await step('ending', async () => {
    const g = bot.G();
    const sc = g.scene;
    const said = [];
    const seen = new Set();
    await bot.until(() => {
      if (sc.line && !seen.has(sc.line.text)) {
        seen.add(sc.line.text);
        said.push(`${sc.line.who}: ${sc.line.text}`);
      }
      return sc.phase === 'meow';
    }, 30000, 'the conversation');
    if (sc.alarm) throw new Error('nobody should be alarmed the moment the cat meows');
    if (sc.actors.some((a) => !a.out)) throw new Error('all three should be out on the terrace');
    await bot.until(() => sc.alarm, 8000, 'the alarm');
    if (sc.cat.state !== 'run') throw new Error(`the alarm should come as the cat runs for the edge, not while she is "${sc.cat.state}"`);
    const xs = sc.actors.map((a) => a.x).sort((a, b) => a - b);
    if (xs[1] - xs[0] < 30 || xs[2] - xs[1] < 30) throw new Error(`they should stand side by side: ${xs}`);
    await bot.until(() => sc.cat.state === 'jump', 8000, 'the cat to jump');
    await bot.until(() => g.mode === 'win', 12000, 'the final screen');
    const expected = ['Professor: You restored power! Hurray!', 'Alice: Can we now test the cat teleportation protocol?', 'Cat: MEOW'];
    if (JSON.stringify(said) !== JSON.stringify(expected)) throw new Error(`unexpected lines: ${JSON.stringify(said)}`);
    const title = document.getElementById('win-h').textContent;
    const floors = document.querySelectorAll('#win-floors button').length;
    if (title !== 'Thank you for playing.' || floors !== 7) throw new Error(`final screen: "${title}", ${floors} floor buttons`);
    return `ending played: ${said.join(' / ')}; then "${title}" with ${document.getElementById('win-stars').textContent}`;
  });
  await page.waitForTimeout(300);
  await shot('12-thank-you');

  // "Replay a specific floor", then "Return to start".
  await page.click('#win-floors button[data-floor="2"]');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 2);
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '7');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 7);
  await page.evaluate(() => {
    window.blackoutLab.state.scene.phase = 'fade'; // skip to the end of the ending
  });
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'win');
  await page.click('#btn-home');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'title' && window.blackoutLab.state.levelIndex === 0 && !window.blackoutLab.state.level.outdoor);
  await page.waitForTimeout(300);
  await shot('13-back-at-start');
  r = await rack();
  if (!r.about || r.circuit) throw new Error(`back at the title the rack should show the About panel again: ${JSON.stringify(r)}`);
  report.push('replaying floor 3 from the final screen and returning to start both work');

  // A superposed platform cannot be landed on, and jumping at it is not a measurement.
  await page.click('#btn-start');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0);
  await step('no landing on a superposition', async () => {
    const g = bot.G();
    await bot.tap('KeyF');
    await bot.terminal('T1', [1]);
    const a = bot.platform('A');
    if (a.state !== null) throw new Error('A should be in superposition');
    const before = g.q.ops.length;
    bot.key('ArrowRight', true);
    await bot.until(() => g.player.x + 18 >= 148, 3000, 'reach the edge');
    await bot.tap('Space');
    let collapsed = false;
    await bot.until(() => {
      if (a.state !== null || g.q.ops.length !== before) collapsed = true;
      return g.mode !== 'play';
    }, 5000, 'the fall');
    bot.key('ArrowRight', false);
    if (collapsed) throw new Error('jumping at a superposed platform must not collapse it');
    if (g.mode !== 'falling' || g.lives !== 2) throw new Error(`the player should fall through and lose a life: ${g.mode}, ${g.lives}`);
    await bot.until(() => g.mode === 'play', 4000, 'the floor to reset');
    return 'jumping at superposed A: no collapse, straight through, one life lost';
  });

  // Three falls on one floor send the player back to floor 1.
  await page.keyboard.press('KeyP');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'paused');
  await page.selectOption('#opt-floor', '2');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 2);
  await step('falling', async () => {
    const lives = [];
    for (let i = 0; i < 3; i += 1) {
      bot.key('ArrowRight', true);
      await bot.until(() => bot.G().mode !== 'play', 6000, 'a fall');
      bot.key('ArrowRight', false);
      lives.push(bot.G().lives);
      if (i < 2) await bot.until(() => bot.G().mode === 'play', 4000, 'the floor to reset');
    }
    await bot.until(() => bot.G().mode === 'over', 4000, 'out of lives');
    return `on floor 3, falls left lives at ${lives.join(', ')} then out of lives`;
  });
  await shot('14-out-of-lives');
  await page.click('#btn-retry');
  await page.waitForFunction(() => window.blackoutLab.state.mode === 'play' && window.blackoutLab.state.levelIndex === 0 && window.blackoutLab.state.lives === 3);
  report.push('out of lives on floor 3 restarted the climb from floor 1 with three lives');

  console.log(report.join('\n'));
  console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no page errors');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(`PLAYTHROUGH FAILED: ${err.message}`);
  process.exit(1);
});
