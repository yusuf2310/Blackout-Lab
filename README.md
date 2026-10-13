# Blackout Lab
By Team Qute Bits.

A 2D platformer where the level is a quantum circuit. The power is out in a quantum computing building and the lift platforms have become entangled with the lab's qubits. A platform in superposition is in two places at once until your flashlight lights it, because light is a measurement. Over seven floors you apply gates at terminals, carry a sealed qubit between rooms, save a cat, teleport a door key, and cross a floor with no light at all. Then you climb to the roof and bring the power back.

**Theme:** Quantum Playground + Quantum Unlocked &nbsp;·&nbsp; **Framework:** Qiskit 2.x &nbsp;·&nbsp; **Licence:** MIT

This effort is supported by Qollab & IonQ.

> Team Members: Yusuf Ahmed, Dev Chauhan, Ayesha Iqbal.

> Qollab Project Page: https://qollab.xyz/u/D3vsinh/blackout-lab-educational-game

## How to run it

**On Qollab:** open the project, press **Run**, pick any backend in **Select QPU**, and press **Run**. The title screen appears while Qiskit loads, runs a short self-test on the backend you picked, then enables **Enter the building**. Use a recent Chrome, Edge, Brave, Opera, or Firefox on a computer with a keyboard.

**Locally, with real Qiskit:**

```bash
pip install -r requirements.txt
python dev/server.py            # then open http://localhost:8000/dev/
python dev/server.py --noisy 0.02   # same, with a pretend noisy backend
```

`http://localhost:8000/dev/?engine=js` runs the same page on a JavaScript stand-in with no Python at all.

## How to play

| Key | Action |
| --- | --- |
| ← → or A D | Walk |
| Space or W | Jump |
| Mouse, or I / K | Aim the flashlight |
| F | Flashlight on / off |
| E | Use a terminal or port, talk, go through a room door, try a lock, pet the cat |
| ← → then Enter | Pick a gate while a terminal is open (E to leave) |
| H | Show a hint |
| R / P / M | Restart floor / pause and options / sound |

- Every moving platform is a qubit. State `0` parks it lowered, state `1` parks it raised.
- A platform in superposition is drawn as dotted outlines at both heights and cannot be stood on.
- Hold the flashlight beam on an outline for about half a second and the qubit is measured. It collapses to one height, at random, with the odds shown in the rack.
- Only light observes. Jumping at a superposed platform does not collapse it, and you fall straight through.
- While you are at a terminal your flashlight is lowered, so nothing is observed between the gates you apply there.
- From floor 3 you carry a **canister** holding one sealed qubit. No light gets in, so the flashlight cannot read it. Dead terminals still have a canister port: plug in and the port applies a CNOT with the canister as control.
- The title screen's side panel says where the game was made and links to its Qollab and GitHub pages (fill in the two empty `href` attributes in the `about` block of `index.html`; until then each line reads "link not added yet").
- Falling into the gap costs one of three lives and resets the floor. Lose all three on one floor and the climb starts again from floor 1. There is no timer. Unlimited lives are in the pause menu. "Skip to floor" on the title screen and in the pause menu jumps to any floor.

The rack on the right is live: the **circuit** you have built on this floor (with a meter icon and its result for every observation), the **probability** of 0 and 1 for every qubit plus the joint outcomes of anything entangled, and **lab notes** with the goal, a concept explanation, hints and an event log. "This floor as Qiskit code" shows the same circuit as code you can paste into a notebook. **Expand** on the circuit moves it under the game and draws all of it at once, with nothing to scroll.

## The seven floors

| Floor | What happens | What it teaches |
| --- | --- | --- |
| 1 Superposition | H, then look, until two platforms land raised. | H makes a 50/50 superposition; looking collapses it; a bad result can only be retried, not undone. |
| 2 Certainty and Interference | X, H and Z on three platforms. A fourth star goes to whoever guarantees a platform with gates: H then X on the middle one, or H·Z·H on the last one, even after gambling on it first. | X is a certain flip. Z changes nothing you can see, yet H·Z·H is an X: phase is real, and interference turns it into certainty if you do not look in between. |
| 3 The Sealed Canister | Carry the canister; entangle it with a platform through a port; set a one-lamp exit key. | You cannot look inside the canister, but entangling it with a platform and looking at the platform measures both. |
| 4 Low Battery | The flashlight flickers, and dies as you reach the ledge with the battery station. The terminal on that ledge drives a platform far across the room. Two-lamp exit key. | You can only observe what your light reaches, so a 50/50 you cannot check from where you stand costs a trip each time it lands wrong. |
| 5 Schrödinger Lab | The Professor's cat is in a box whose atom is entangled with the canister at the top of the room. A broken bridge on the way holds only when both halves are in state 1. | Nothing done to one half of an entangled pair changes the other's odds. Bring them together and one CNOT undoes the entanglement, but only while the box is still shut. Only one bridge half has an H; the other can only follow it through a CNOT, so the two rise or fall together. |
| 6 Alice and Bob | Two rooms. The platform on the way to Alice can only be put in superposition and observed, which is why Bob cannot go himself. Share an entangled pair, carry half to Alice, read her two bits, walk them back, apply Bob's fix, open the exit. | Quantum teleportation, complete: the lock checks Bob's qubit against its own, so both the X and the Z correction matter, and the two bits have to be carried on foot. |
| 7 Lights Out | The flashlight is dead. Five platforms, one of which has to end up lowered, and a three-lamp key on a ledge at the top left. A fourth star for clearing it within two minutes. | With no way to look and retry, only gates with a certain result will do: H·Z·H, H undoing H, H telling \|+⟩ from \|−⟩, and a CNOT that separates an entangled pair. |

The last exit leads up to the terrace. There are no qubits there: crank the generator, the building's lights come back, and the Professor, Alice, Bob and the cat come out for a short ending. The final screen offers a return to the start or a replay of any floor.

Exit locks are made of qubit lamps, each labelled with the qubit behind it; those qubits are shown in yellow in the rack. A lock is read by flashlight or by pressing E beside it (E only on floor 6), and opens when the lamps match the key shown above them. A wrong key clears the lamps; on floor 6 it also uses up the teleported key, and a fresh one is prepared.

## Where the quantum computing is

All quantum behaviour in the game is computed by Qiskit.

- **Live state** (`engine/quantum.py`). Each floor's qubits are a `qiskit.quantum_info.Statevector`. A gate at a terminal is `Statevector.evolve`. Flashlight light is a Born-rule sample followed by a projection onto the outcome. Entangled groups are found with `partial_trace`: a set of qubits has a state of its own exactly when its reduced state is pure.
- **Circuit history.** Every action is appended to a real `QuantumCircuit`, including mid-circuit measurements and resets. The drawing in the rack and the Qiskit code listing are generated from that circuit, and a test checks that the listed code rebuilds the same state.
- **Floors that start entangled.** A floor can list gates it applies before play (`prep` in `game/levels.js`), which is how the cat's atom starts entangled with the canister and Alice's key with the exit lock. The teleportation floor is tested end to end in `tests/test_engine.py` for all four messages and for each correction being skipped, and checked a second time in plain Qiskit without the game engine: with the corrections written as controlled gates the lock reads 0 0 with probability 1, each of the four notes opens it with its own fix and no other, and the same gates carry an arbitrary state from Alice to Bob.
- **The backend you pick** (`engine/calibrate.py`). At start-up the game sends **one job** to the selected backend: a self-test that runs the five things the player is about to do by hand (a certain flip, H·Z·H interference, a superposition, a Bell pair, a three-qubit GHZ state) side by side in one 8-qubit circuit. The title screen shows the results. How often the "certain" checks fail becomes the chance that a gate misfires for the rest of the run: after a gate, with that probability, one random Pauli error hits one of its qubits. On an ideal simulator nothing ever misfires. On an IonQ noise-model simulator a CNOT occasionally does, the circuit shows a red `!X`, `!Y` or `!Z` marker, and the player meets hardware noise first hand. The option is in the pause menu.

One job per run is deliberate: IonQ backends on Qollab accept exactly one. A second call to `calibrate` returns the stored result and never reaches the backend.

The error rates are rough. They lump gate and read-out error together and come from 200 shots. They make noise visible; they are not a benchmark.

## Project layout

```
index.html, main.css      the page (Qollab inserts index.html into the body)
main.js                   Qollab entry: imports engine.bridge, passes it `backend`
game/levels.js            floor data: rooms, geometry, qubits, terminal gates, hints; the terrace
game/story.js             dialogue and floor events (Professor, Alice, Bob, battery)
game/game.js              rules, platformer physics, flashlight, canister, doors, the ending
game/render.js            canvas drawing, the darkness mask, the terrace at night
game/panel.js             circuit, probabilities and notes in the rack
game/ui.js, input.js, audio.js, geometry.js, quantum.js
engine/quantum.py         Statevector physics and circuit history
engine/calibrate.py       the single backend job and its analysis
engine/bridge.py          JSON functions called from JavaScript
dev/                      local server, HTTP bridge, JavaScript stand-in (not uploaded)
tests/                    engine tests, stand-in vs Qiskit comparison, browser playthrough
tools/package.py          builds dist/qollab and the upload zip
```

**Adding a floor** needs no code: append an object to `LEVELS` in `game/levels.js` with its qubits (`platform`, `canister`, `sealed`, `box` or `door`), platform positions for state 0 and 1, the gates each terminal or port offers, the exit key, and the hint texts. The comment at the top of that file lists every field. Characters and their lines go in `game/story.js`.

## Tests

```bash
python -m pytest                      # engine, teleportation (twice), self-test analysis, stand-in vs Qiskit on 1,000+ random steps
python dev/server.py --port 8123 &
NODE_PATH=$(npm root -g) node tests/playthrough.cjs http://127.0.0.1:8123/dev/
```

The playthrough is a bot that plays all seven floors and the ending in headless Chromium through real key and pointer events. Along the way it checks that only E leaves a terminal, the fourth star on floor 2, the flashlight dying and being revived on floor 4, a refused exit key, the Professor refusing to open an uncertain box, petting the cat, a teleport with the correction skipped (refused) and done properly (accepted), the terrace ending line by line, replaying a floor and returning to the start from the final screen, falling straight through a superposed platform without collapsing it, and losing all three lives on floor 3, which restarts the climb from floor 1.

## Accessibility

- Fully playable from the keyboard; the mouse is only a second way to aim. Fixed-height jumps, no timers, no quick reactions required, pause at any time.
- Unlimited lives are an option.
- State is never carried by colour alone: every qubit shows `0` / `1`, lowered / raised, percentages, and solid versus dotted outlines.
- Terminals and menus are real buttons with visible focus, labelled for screen readers. Every quantum event and every line of dialogue is written to the event log and announced through a live region, and the circuit has a text description. Speech bubbles are repeated as text under the game. The ending plays by itself, but every line of it is also logged and announced, and E moves a spoken line on early.
- Sound is optional and never the only signal.

## Judging summary

- **Novelty and creativity.** Measurement is the core game mechanic, not a random-number source: where the player points the flashlight, and when, decides which qubits collapse. Entanglement is something you see and carry (platforms that snap together, a canister that is half of a pair), Schrödinger's cat and teleportation are playable rather than explained, and the chosen backend's noise becomes part of the game's physics.
- **Technical execution.** Qiskit is the single source of truth for state, circuit and probabilities. One backend job per run, guarded. 28 automated tests, a differential test between the JavaScript stand-in and Qiskit, and an end-to-end browser playthrough of every floor.
- **Impact potential.** A first contact with superposition, measurement, interference, entanglement, teleportation and noise that needs no maths, and hands the player the Qiskit code for what they just did. New floors are data, so teachers and other builders can extend it.
- **Documentation.** This page, documented modules and floor data, a local dev server, and tests that double as examples.

## What is not here yet

- Only H, X, Z and CNOT. No rotations, no measurement in other bases.
- The noise model is a one-error-per-gate sketch, not a device model.

## Disclosures

- **Libraries:** [Qiskit](https://github.com/Qiskit/qiskit) (Apache 2.0) is the only runtime dependency. Fonts, when the network allows them, are Atkinson Hyperlegible, Big Shoulders Display and JetBrains Mono from Google Fonts (SIL Open Font Licence); the page falls back to system fonts.
- **AI assistance:** Claude (Anthropic) was used in helping design, code, test, and refining documentation text during the build window.
- **Prior work:** none. No template or earlier project was used, and no code was copied from anywhere.
- **Where the platform know-how came from:** the [Qollab documentation](https://qollab.xyz/learn/docs/runtime-environment) (file layout, `callPromising`, one job per run), and reading three public repositories from this hackathon to see how they talk to Qollab: [tomcode1000/Canary](https://github.com/tomcode1000/Canary), [AGONIXX15/quantum_project_qollab](https://github.com/AGONIXX15/quantum_project_qollab) and [udsy19/Qollab-Hackathon](https://github.com/udsy19/Qollab-Hackathon). Two ideas are taken from the second of these and re-implemented here: compiling against the backend with a pinned layout and then dropping idle device qubits (`engine/calibrate.py`), and ending `main.js` with a never-resolving `await` so the run stays alive.
