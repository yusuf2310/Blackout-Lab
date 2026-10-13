// Dialogue and floor-specific events. Everything here goes through the small
// `ctx` object the game hands in, so the story never touches physics or the
// quantum engine directly:
//
//   ctx.flags              per-floor memory, cleared whenever the floor resets
//   ctx.definite(id)       0, 1, or null while the qubit is not definite
//   ctx.p1(id)             probability that the qubit reads 1
//   ctx.carrying           true while the player holds the canister
//   ctx.doorOpen           true once the exit is unlocked
//   ctx.say(who, lines, then)   a conversation the player steps through with E
//   ctx.remark(text)       a short thought bubble over the player
//   ctx.bubble(at, text)   a short bubble over something in the room
//   ctx.measure(ids, by)   measure qubits; resolves to their results
//   ctx.restart()          the floor prepares its starting entanglement again
//   ctx.giveKey()          unlock a door that needs a key in hand
//   ctx.setNote(text)      a note the player carries (shown under the game)
//
// Hooks: intro (lines the player says on arrival), talk[npcId], onCanister,
// onBatteryDead (the failing flashlight gives out), onBattery (new battery fitted),
// onDeadTorch (F pressed with a dead flashlight), onMachine (after a machine
// measurement), onRefused (after the exit lock refused a key), tick (every frame).

const pct = (p) => `${Math.round(p * 100)}%`;

export const STORY = {
  canister: {
    onCanister(ctx) {
      ctx.remark('A sealed qubit canister. No light gets in, so my flashlight cannot read it.');
    },
  },

  'low-battery': {
    intro: ['Uh-oh! Low flashlight battery. I better find a battery station.'],
    onBatteryDead(ctx) {
      ctx.remark('Uh-oh! It just died. Good thing the battery station is right here.');
    },
    onDeadTorch(ctx) {
      ctx.remark('Nothing. I need that new battery.');
    },
    onBattery(ctx) {
      ctx.remark('Fresh battery. That is better.');
    },
  },

  schrodinger: {
    talk: {
      professor(ctx) {
        const f = ctx.flags;
        const cat = ctx.definite('CAT');
        if (f.opened) {
          ctx.say('Professor', ['She is fine, she is fine! The exit is unlocked. Thank you.']);
          return;
        }
        if (cat === 0) {
          ctx.say('Professor', ['The box reads 100% alive. Then I dare to look.', 'Opening it... now!'], async () => {
            const [result] = await ctx.measure(['CAT'], 'box');
            if (result !== 0) return;
            f.opened = true;
            ctx.bubble('box', '*meow!*');
            ctx.giveKey();
            ctx.say('Professor', ['Alive! Oh, thank you.', 'Here is the key to the exit. Go, go.']);
          });
          return;
        }
        if (cat === 1) {
          ctx.say('Professor', ['It reads certainly decayed?! That has to be a glitch in the equipment.', 'I am resetting the experiment. Do not touch anything.'], () => ctx.restart());
          return;
        }
        if (!f.met) {
          f.met = true;
          ctx.say('Professor', [
            'The lights! The lights are out, and my cat is shut in this box!',
            'There is an atom in there with her. If it decays, the flask breaks. Right now, it is in a superposition of being decayed and intact at once.',
            'Worse: its decay is entangled with the qubit in a canister at the top of this room.',
            'Bring that canister down and plug it into the box. Undo the entanglement, so I am certain she is alive before I open it.',
          ]);
          return;
        }
        ctx.say('Professor', [
          `The box still reads ${pct(1 - ctx.p1('CAT'))} alive. I will not open it until that is 100%.`,
          ctx.carrying ? 'You have the canister. Plug it into the port on the box.' : 'The canister is up at the top left. Bring it to the port on the box.',
        ]);
      },
    },
    tick(ctx, dt) {
      const f = ctx.flags;
      if (f.opened) return;
      f.meow = (f.meow === undefined ? 4 : f.meow) - dt;
      if (f.meow <= 0) {
        f.meow = 7 + Math.random() * 4;
        ctx.bubble('box', '*meow*');
      }
    },
  },

  teleport: {
    talk: {
      bob(ctx) {
        const f = ctx.flags;
        if (ctx.doorOpen) {
          ctx.say('Bob', ['It worked. The key is in my receiver and the exit is open.']);
          return;
        }
        if (f.note) {
          ctx.say('Bob', [
            `Alice’s note says M = ${f.note.m}, Q = ${f.note.q}.`,
            'The rule: if Q is in state 1, apply X to my qubit B. If M is in state 1, apply Z to B. If both are in state 1, apply both. Whichever is in state 0 needs no gate.',
            'Use my terminal, then interact with the exit lock.',
          ]);
          return;
        }
        if (!f.metBob) {
          f.metBob = true;
          ctx.say('Bob', [
            'The exit needs a key, and the key is a qubit locked in Alice’s teleporter next door.',
            'She can teleport it into my receiver, but only if she and I share an entangled pair.',
            'Take the canister. At my terminal apply H to Q, then CNOT Q to B. That ties it to my receiver.',
            'Then carry it to Alice. I cannot go myself: the platform on the way has to be observed, and you have the only flashlight.',
          ]);
          return;
        }
        ctx.say('Bob', ['H on Q, then CNOT Q to B, at my terminal. Then take the canister through the door marked TO ALICE. Terminal T2 and your flashlight will get you across.']);
      },
      alice(ctx) {
        const f = ctx.flags;
        if (f.note) {
          ctx.say('Alice', [
            `The teleporter printed M = ${f.note.m}, Q = ${f.note.q}.`,
            'My key qubit is gone from here. Bob’s receiver holds it now, scrambled until he applies the fix.',
            'Carry the note to him. Until he has those two bits his qubit is useless, so teleportation is never faster than an ordinary message.',
          ]);
          return;
        }
        if (!ctx.carrying) {
          ctx.say('Alice', ['Bob sent you? Then you forgot the canister. I need his half of the entangled pair.']);
          return;
        }
        ctx.say('Alice', [
          'Bob sent you? Good, and you brought the canister.',
          'Plug it into my teleporter: CNOT M to Q, then H on M, then Measure.',
          'It will print two bits. Bob needs them.',
        ]);
      },
    },
    onMachine(ctx, results) {
      if (results.M === undefined || results.Q === undefined) return;
      ctx.flags.note = { m: results.M, q: results.Q };
      ctx.setNote(`Alice’s note: M = ${results.M}, Q = ${results.Q}`);
      ctx.bubble('alice', `Two bits: M = ${results.M}, Q = ${results.Q}. Take them to Bob.`);
    },
    onRefused(ctx) {
      ctx.flags.note = null;
      ctx.setNote(null);
    },
  },

  'lights-out': {
    intro: ['Uh-oh! Out of battery already?! I need to get the platforms to be exactly in the right position.'],
    introHold: 2, // extra seconds on screen
    onDeadTorch(ctx) {
      ctx.remark('Dead. Not even a flicker.');
    },
  },
};
