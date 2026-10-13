// Floor data. Geometry is in world pixels (960 x 540, y grows downward).
//
// Every qubit of a floor has an id (shown on the circuit) and a role:
//   platform  a lift platform: state 0 parks it at y0 (lowered), state 1 at y1 (raised)
//   canister  the sealed qubit the player carries; no light gets in
//   sealed    a qubit shut inside a machine (Bob's receiver, Alice's teleporter)
//   box       the atom in the Professor's box: 0 = intact (cat alive), 1 = decayed
//   door      one lamp of the exit lock
//
// A floor is one room, or several (`rooms`) joined by `portals`. A room has
//   solids     ground blocks and fixed stands
//   platforms  { q, x, w, y0, y1, need, half? }
//   terminals  { id, x, y, ops, port?, sealed? }  op = { gate, q } with q = ids
//              ([control, target] for cx; gate 'measure' reads its qubits).
//              `port: true` is a dead terminal: only its canister port works.
//              Any op that touches the canister needs the canister in hand.
//   door       the exit: { x, y, key, lock, check?, reprep?, byHand?, item? }
//              (byHand: read only with E, never by flashlight; item: needs a key in hand)
//   canister   { q, x, y }   battery { x, y, diesOnArrival? }   npcs, portals
//   decor      sign { lines }, candle { drop?, reach? }, plate { text }, teleporter
//   windows    { y, xs }: where the wall's windows sit, if not along the top
//   bonus      an extra star: { sequences: [{ q, gates }], text } for applying one of those
//              gate sequences to its qubit, or { seconds, text } for clearing the floor in time
// `prep` lists gates the floor applies before play (a pair that starts entangled).
// To add a floor, append an object here. Dialogue lives in story.js.

export const WORLD = { w: 960, h: 540 };
export const PLATFORM_H = 14;
export const LIVES_PER_FLOOR = 3;

export const GATE_INFO = {
  h: {
    symbol: 'H',
    name: 'Hadamard',
    text: 'Turns a definite state into a 50/50 superposition. Applied twice with no look in between, it cancels out.',
  },
  x: { symbol: 'X', name: 'Flip', text: 'Swaps state 0 and state 1, with certainty. Lowered becomes raised, raised becomes lowered.' },
  z: {
    symbol: 'Z',
    name: 'Phase flip',
    text: 'Flips the hidden phase. The odds do not move; only a later H shows the difference.',
  },
  cx: {
    symbol: 'CNOT',
    name: 'Controlled flip',
    text: 'Flips the target only when the control is in state 1. A control in superposition leaves the two entangled.',
  },
  measure: {
    symbol: 'M',
    name: 'Measure',
    text: 'The machine reads these qubits. Each collapses to an ordinary bit, 0 or 1.',
  },
};

export const LEVELS = [
  {
    id: 'superposition',
    name: 'Superposition',
    gates: ['h'],
    qubits: [
      { id: 'A', init: '0', role: 'platform' },
      { id: 'B', init: '0', role: 'platform' },
    ],
    spawn: { x: 40, y: 440 },
    solids: [
      { kind: 'ground', x: 0, y: 440, w: 150, h: 100 },
      { kind: 'stand', x: 335, y: 340, w: 110, h: 14 },
      { kind: 'ground', x: 640, y: 245, w: 320, h: 295 },
    ],
    platforms: [
      { q: 'A', x: 200, w: 84, y0: 505, y1: 395, need: 1 },
      { q: 'B', x: 500, w: 84, y0: 405, y1: 290, need: 1 },
    ],
    terminals: [
      { id: 'T1', x: 96, y: 440, ops: [{ gate: 'h', q: ['A'] }] },
      { id: 'T2', x: 392, y: 340, ops: [{ gate: 'h', q: ['B'] }] },
    ],
    door: { x: 860, y: 245, key: null, lock: [] },
    shortest: 2,
    goal: 'Reach the EXIT door. Platforms A and B are lowered, and you need both raised.',
    concept:
      'Superposition. H (Hadamard) puts a qubit into an equal mix of state 0 and state 1, so the platform is lowered and raised at once: the dotted outlines. Light is a measurement. Your flashlight forces it to pick one, at random.',
    hints: [
      'Stand at terminal T1, press E, and apply H to platform A.',
      'Press E again to leave the terminal, then aim the flashlight at one of the dotted outlines. Hold it there: the platform collapses to lowered (0) or raised (1), 50/50.',
      'Did it collapse to lowered? Apply H again and look again. A measurement cannot be undone, only retried.',
    ],
    takeaway:
      'H made a fair quantum coin and looking flipped it. Every retry was a fresh 50/50 with no memory of the last result.',
  },
  {
    id: 'interference',
    name: 'Certainty and Interference',
    gates: ['x', 'h', 'z'],
    qubits: [
      { id: 'A', init: '1', role: 'platform' },
      { id: 'B', init: '+', role: 'platform' },
      { id: 'C', init: '0', role: 'platform' },
    ],
    spawn: { x: 36, y: 450 },
    solids: [
      { kind: 'ground', x: 0, y: 450, w: 140, h: 90 },
      { kind: 'stand', x: 315, y: 360, w: 100, h: 14 },
      { kind: 'stand', x: 595, y: 265, w: 100, h: 14 },
      { kind: 'ground', x: 868, y: 170, w: 92, h: 370 },
    ],
    platforms: [
      { q: 'A', x: 185, w: 80, y0: 415, y1: 320, need: 0 },
      { q: 'B', x: 465, w: 80, y0: 425, y1: 310, need: 1 },
      { q: 'C', x: 745, w: 80, y0: 330, y1: 215, need: 1 },
    ],
    terminals: [
      { id: 'T1', x: 92, y: 450, ops: [{ gate: 'x', q: ['A'] }] },
      { id: 'T2', x: 366, y: 360, ops: [{ gate: 'h', q: ['B'] }, { gate: 'x', q: ['B'] }] },
      { id: 'T3', x: 646, y: 265, ops: [{ gate: 'h', q: ['C'] }, { gate: 'z', q: ['C'] }] },
    ],
    door: { x: 916, y: 170, key: null, lock: [] },
    shortest: 6,
    bonus: {
      sequences: [
        { q: 'B', gates: ['h', 'x'] },
        { q: 'C', gates: ['h', 'z', 'h'] },
      ],
      text: 'Used the flip gate to guarantee an outcome',
    },
    goal: 'Three platforms, three terminals. A is raised out of reach, B is already in superposition, and C has no flip button.',
    concept:
      'X is a certain flip. Z flips a hidden property called phase: the odds stay 50/50, but a later H reveals it. H, then Z, then H adds up to an X. That is interference, and it only works if nobody looks in between.',
    hints: [
      'A is raised out of reach. X at T1 flips it to lowered, with certainty.',
      'B is in superposition already. You can look and gamble, then repair with X. Or apply H first: H undoes H and leaves B in state 0 for certain, then X raises it. H then X, with no look in between, earns the fourth star.',
      'T3 has no X, so build one: H, then Z, then H, all in one visit while your flashlight is down. Together they are a flip gate, and C rises with certainty.',
      'Already gambled on C with a single H? H, Z, H still works from wherever C ended up: it flips lowered to raised and raised to lowered. That earns the fourth star too: guaranteeing either B or C with gates is enough.',
    ],
    takeaway:
      'Z gate alone changed nothing you could see, yet it may affect the outcome. Phase is real, and interference can turn it into certainty.',
  },
  {
    id: 'canister',
    name: 'The Sealed Canister',
    gates: ['h', 'cx'],
    qubits: [
      { id: 'Q', init: '0', role: 'canister' },
      { id: 'A', init: '0', role: 'platform' },
      { id: 'B', init: '0', role: 'platform' },
      { id: 'D', init: '0', role: 'door' },
    ],
    spawn: { x: 16, y: 450 },
    solids: [
      { kind: 'ground', x: 0, y: 450, w: 200, h: 90 },
      { kind: 'stand', x: 375, y: 345, w: 110, h: 14 },
      { kind: 'ground', x: 665, y: 250, w: 295, h: 290 },
    ],
    platforms: [
      { q: 'A', x: 245, w: 80, y0: 505, y1: 400, need: 1 },
      { q: 'B', x: 535, w: 80, y0: 400, y1: 295, need: 1 },
    ],
    canister: { q: 'Q', x: 62, y: 450 },
    terminals: [
      { id: 'T1', x: 112, y: 450, ops: [{ gate: 'h', q: ['Q'] }] },
      { id: 'Port A', x: 168, y: 450, port: true, ops: [{ gate: 'cx', q: ['Q', 'A'] }] },
      { id: 'Port B', x: 430, y: 345, port: true, ops: [{ gate: 'cx', q: ['Q', 'B'] }] },
      { id: 'Port D', x: 768, y: 250, port: true, ops: [{ gate: 'cx', q: ['Q', 'D'] }] },
    ],
    door: { x: 884, y: 250, key: '1', lock: ['D'] },
    shortest: 4,
    goal: 'The terminals on some platforms are dead, but their canister ports still work. Carry the canister across and set the lock lamp D to match the key.',
    concept:
      'Entanglement. The canister holds one sealed qubit, Q, and no light gets in, so your flashlight cannot read it. CNOT flips its target only when its control is in state 1. Plug a superposed Q into a platform port and the two become one state: neither is in state 0 or 1 on its own, but they always agree. Look at the platform and you have measured the canister too.',
    hints: [
      'Walk into the canister to pick it up. At terminal T1 apply H to Q, then at Port A apply CNOT Q to A.',
      'Shine the flashlight on A. If it rises, the canister is in state 1 as well. If it drops, charge Q with H again and repeat.',
      'A canister in state 1 flips whatever it is plugged into. Use Port B on the next ledge, then Port D by the exit, and light the lock panel.',
    ],
    takeaway:
      'You never saw inside the canister. You learned its state by entangling it with a platform you could look at. The canister’s job has a name in quantum computing: it is the control qubit of each CNOT. It decides whether the target flips, and is left unchanged itself.',
  },
  {
    id: 'low-battery',
    name: 'Low Battery',
    gates: ['h', 'cx'],
    torch: 'low',
    qubits: [
      { id: 'Q', init: '0', role: 'canister' },
      { id: 'A', init: '0', role: 'platform' },
      { id: 'F', init: '0', role: 'platform' },
      { id: 'D1', init: '0', role: 'door' },
      { id: 'D2', init: '0', role: 'door' },
    ],
    spawn: { x: 14, y: 475 },
    solids: [
      { kind: 'ground', x: 0, y: 475, w: 160, h: 65 },
      { kind: 'stand', x: 330, y: 360, w: 90, h: 14 },
      { kind: 'stand', x: 60, y: 295, w: 230, h: 14 },
      { kind: 'stand', x: 480, y: 340, w: 90, h: 14 },
      { kind: 'ground', x: 760, y: 245, w: 200, h: 295 },
    ],
    platforms: [
      { q: 'A', x: 205, w: 80, y0: 525, y1: 420, need: 1 },
      { q: 'F', x: 625, w: 80, y0: 400, y1: 290, need: 1 },
    ],
    canister: { q: 'Q', x: 52, y: 475 },
    battery: { x: 100, y: 295, diesOnArrival: true },
    terminals: [
      { id: 'T1', x: 96, y: 475, ops: [{ gate: 'h', q: ['Q'] }] },
      { id: 'Port A', x: 140, y: 475, port: true, ops: [{ gate: 'cx', q: ['Q', 'A'] }] },
      { id: 'T2', x: 200, y: 295, ops: [{ gate: 'h', q: ['F'] }] },
      { id: 'T3', x: 776, y: 245, ops: [{ gate: 'cx', q: ['Q', 'D1'] }, { gate: 'cx', q: ['F', 'D2'] }] },
    ],
    door: { x: 904, y: 245, key: '11', lock: ['D1', 'D2'] },
    shortest: 5,
    goal: 'Your flashlight is failing. Climb to the battery station at the top left. The terminal beside it drives platform F, far across the room.',
    goalAfterBattery: 'New battery fitted. Terminal T2 on this ledge drives platform F, far across the room: set it, then go and look.',
    concept:
      'A gate works at any distance, but you can only observe what your light reaches. Platform F is set from the far terminal and checked from close by, so every 50/50 that lands wrong costs another trip. The exit key has two lamps now: D1 copies the canister, D2 copies platform F.',
    hints: [
      'As on the last floor: H on Q at T1, CNOT at Port A, and look at A until it rises. The canister is then in state 1.',
      'Climb up and left to the battery station. At terminal T2 apply H to F, then walk right until your beam reaches F.',
      'F dropped? Go back to T2 for another H. When F is up, cross it to the exit.',
      'At T3: CNOT Q to D1 and CNOT F to D2. Both controls are in state 1, so the lock reads 1 1.',
    ],
    takeaway:
      'A gate reaches across the room, but an observation needs your light on the spot. A coin flip you cannot check from where you stand costs a walk every time it lands wrong.',
  },
  {
    id: 'schrodinger',
    name: 'Schrödinger Lab',
    gates: ['x', 'h', 'cx'],
    qubits: [
      { id: 'A', init: '0', role: 'platform' },
      { id: 'E', init: '0', role: 'platform' },
      { id: 'F', init: '0', role: 'platform' },
      { id: 'Q', init: '0', role: 'canister' },
      { id: 'CAT', init: '0', role: 'box' },
    ],
    prep: [{ gate: 'h', q: ['Q'] }, { gate: 'cx', q: ['Q', 'CAT'] }],
    spawn: { x: 14, y: 475 },
    solids: [
      { kind: 'ground', x: 0, y: 475, w: 150, h: 65 },
      { kind: 'stand', x: 320, y: 420, w: 100, h: 14 },
      { kind: 'stand', x: 465, y: 415, w: 80, h: 14 },
      { kind: 'ground', x: 590, y: 370, w: 370, h: 170 },
      { kind: 'stand', x: 485, y: 305, w: 100, h: 14 },
      { kind: 'stand', x: 80, y: 195, w: 120, h: 14 },
    ],
    platforms: [
      { q: 'A', x: 195, w: 80, y0: 525, y1: 435, need: 1 },
      { q: 'E', x: 345, w: 80, y0: 330, y1: 250, need: 1, half: 'right' },
      { q: 'F', x: 260, w: 80, y0: 330, y1: 250, need: 1, half: 'left' },
    ],
    canister: { q: 'Q', x: 140, y: 195 },
    terminals: [
      { id: 'T1', x: 112, y: 475, ops: [{ gate: 'x', q: ['A'] }] },
      { id: 'T2', x: 535, y: 305, ops: [{ gate: 'h', q: ['E'] }, { gate: 'cx', q: ['E', 'F'] }] },
      { id: 'Box port', x: 846, y: 370, port: true, box: true, ops: [{ gate: 'cx', q: ['Q', 'CAT'] }, { gate: 'cx', q: ['CAT', 'Q'] }] },
    ],
    npcs: [{ id: 'professor', kind: 'professor', name: 'Professor', x: 792, y: 370 }],
    decor: [
      { type: 'sign', x: 16, y: 292, lines: ['SCHRÖDINGER', 'LAB'] },
      { type: 'candle', x: 62, y: 372 },
      { type: 'candle', x: 822, y: 268, drop: 46, reach: 132 },
    ],
    door: { x: 916, y: 370, key: null, lock: [], item: true },
    shortest: 4,
    goal: 'Reach the Professor at the exit. Then fetch the canister from the top of the room and bring it back to his box.',
    concept:
      'The atom in the box is entangled with the qubit in the canister: together they are "both intact" and "both decayed" at once, so the cat is 50/50. Nothing done to the canister alone can change the odds inside the box. Bring the two together and one CNOT undoes the entanglement, leaving the atom certainly intact. The broken bridge on the way is two qubits, and it only holds when both halves are in state 1.',
    hints: [
      'X at T1 raises A with certainty. Cross to the Professor and press E to talk to him.',
      'From his ledge jump up and left to terminal T2. Only half E has an H; half F can only follow it through CNOT E to F. Look at E until it is raised and then CNOT copies it. Or apply H and CNOT before looking: the halves are entangled, and one look gives both raised or both lowered.',
      'Cross the bridge, walk into the canister to take it, and carry it back down to the box.',
      'At the box port apply CNOT Q to CAT. In the branch where the canister is in state 1, the atom is flipped back to intact. Then talk to the Professor.',
    ],
    takeaway:
      'While the box stayed shut, the entanglement could still be undone. Opening it first would have settled the cat’s fate at random.',
  },
  {
    id: 'teleport',
    name: 'Alice and Bob',
    gates: ['x', 'z', 'h', 'cx', 'measure'],
    qubits: [
      { id: 'P', init: '0', role: 'platform' },
      { id: 'Q', init: '0', role: 'canister' },
      { id: 'B', init: '0', role: 'sealed' },
      { id: 'M', init: '0', role: 'sealed' },
      { id: 'L', init: '0', role: 'door' },
    ],
    prep: [{ gate: 'h', q: ['M'] }, { gate: 'cx', q: ['M', 'L'] }],
    rooms: [
      {
        id: 'bob',
        name: 'Bob’s room',
        spawn: { x: 14, y: 450 },
        solids: [
          { kind: 'ground', x: 0, y: 450, w: 300, h: 90 },
          { kind: 'stand', x: 470, y: 340, w: 140, h: 14 },
          { kind: 'ground', x: 665, y: 295, w: 295, h: 245 },
        ],
        platforms: [{ q: 'P', x: 345, w: 80, y0: 500, y1: 395, need: 1 }],
        canister: { q: 'Q', x: 214, y: 450 },
        terminals: [
          {
            id: 'T1',
            x: 142,
            y: 450,
            sealed: 'B',
            ops: [{ gate: 'h', q: ['Q'] }, { gate: 'cx', q: ['Q', 'B'] }, { gate: 'x', q: ['B'] }, { gate: 'z', q: ['B'] }],
          },
          { id: 'T2', x: 268, y: 450, ops: [{ gate: 'h', q: ['P'] }] },
        ],
        npcs: [{ id: 'bob', kind: 'bob', name: 'Bob', x: 78, y: 450 }],
        portals: [{ x: 540, y: 340, label: 'TO ALICE', to: 'alice', arrive: { x: 150, y: 430 } }],
        decor: [
          { type: 'sign', x: 16, y: 286, lines: ['ALICE AND', 'BOB’S LAB'] },
          { type: 'candle', x: 96, y: 350 },
        ],
        door: {
          x: 895,
          y: 295,
          key: '00',
          lock: ['B', 'L'],
          check: [{ gate: 'cx', q: ['B', 'L'] }, { gate: 'h', q: ['B'] }],
          reprep: true,
          byHand: true,
        },
      },
      {
        id: 'alice',
        name: 'Alice’s room',
        spawn: { x: 150, y: 430 },
        solids: [{ kind: 'ground', x: 0, y: 430, w: 960, h: 110 }],
        platforms: [],
        terminals: [
          {
            id: 'T3',
            x: 520,
            y: 430,
            sealed: 'M',
            ops: [{ gate: 'cx', q: ['M', 'Q'] }, { gate: 'h', q: ['M'] }, { gate: 'measure', q: ['M', 'Q'] }],
          },
        ],
        npcs: [{ id: 'alice', kind: 'alice', name: 'Alice', x: 420, y: 430 }],
        portals: [{ x: 90, y: 430, label: 'TO BOB', to: 'bob', arrive: { x: 580, y: 340 } }],
        decor: [{ type: 'teleporter', x: 600, y: 430 }],
      },
    ],
    shortest: 5,
    goal: 'The exit key is a qubit shut in Alice’s teleporter next door. Teleport it into Bob’s receiver, then try the exit.',
    concept:
      'Teleportation. Alice cannot copy her key qubit M or carry it out, but she can send its state if she and Bob share an entangled pair. She entangles M with her half of the pair and measures both. That destroys M and prints two ordinary bits. Bob’s half now holds the key, scrambled in one of four ways, and the two bits tell him which fix to apply. Until those two bits reach Bob his qubit is useless, so teleportation is never faster than an ordinary message.',
    hints: [
      'Talk to Bob. Take the canister, and at his terminal T1 apply H to Q, then CNOT Q to B. The canister and Bob’s receiver are now an entangled pair.',
      'Terminal T2 can only put platform P into superposition. Apply H, then shine your flashlight on P until it collapses to raised: this is the step Bob cannot do without a light. Carry the canister up through the door marked TO ALICE.',
      'At Alice’s teleporter: CNOT M to Q, then H on M, then Measure. Her note shows the two bits.',
      'Back at Bob’s terminal: apply X to B if the note shows Q in state 1, and Z to B if it shows M in state 1. If both are in state 1, apply both; if both are in state 0, apply neither. Then press E at the exit lock.',
    ],
    takeaway:
      'The key never crossed the room. Its state was rebuilt in Bob’s receiver from an entangled pair and two ordinary bits, and Alice’s original was destroyed along the way.',
  },
  {
    id: 'lights-out',
    name: 'Lights Out',
    gates: ['x', 'z', 'h', 'cx'],
    torch: 'dead',
    qubits: [
      { id: 'A', init: '0', role: 'platform' },
      { id: 'B', init: '+', role: 'platform' },
      { id: 'C', init: '0', role: 'platform' },
      { id: 'D', init: '0', role: 'platform' },
      { id: 'E', init: '-', role: 'platform' },
      { id: 'L1', init: '0', role: 'door' },
      { id: 'L2', init: '0', role: 'door' },
      { id: 'L3', init: '0', role: 'door' },
    ],
    prep: [{ gate: 'h', q: ['C'] }, { gate: 'cx', q: ['C', 'D'] }],
    spawn: { x: 14, y: 495 },
    solids: [
      { kind: 'ground', x: 0, y: 495, w: 200, h: 45 },
      { kind: 'stand', x: 375, y: 385, w: 110, h: 14 },
      { kind: 'stand', x: 665, y: 275, w: 110, h: 14 },
      { kind: 'stand', x: 30, y: 110, w: 410, h: 14 },
    ],
    platforms: [
      { q: 'A', x: 245, w: 80, y0: 522, y1: 440, need: 1 },
      { q: 'B', x: 535, w: 80, y0: 435, y1: 330, need: 1 },
      { q: 'C', x: 825, w: 80, y0: 325, y1: 220, need: 1 },
      { q: 'D', x: 690, w: 80, y0: 165, y1: 60, need: 0 },
      { q: 'E', x: 520, w: 100, y0: 240, y1: 118, need: 1 },
    ],
    terminals: [
      { id: 'T1', x: 130, y: 495, ops: [{ gate: 'h', q: ['A'] }, { gate: 'z', q: ['A'] }] },
      { id: 'T2', x: 430, y: 385, ops: [{ gate: 'h', q: ['B'] }, { gate: 'x', q: ['B'] }, { gate: 'h', q: ['E'] }, { gate: 'z', q: ['E'] }] },
      { id: 'T3', x: 720, y: 275, ops: [{ gate: 'cx', q: ['C', 'D'] }, { gate: 'h', q: ['C'] }, { gate: 'x', q: ['C'] }] },
      { id: 'T4', x: 372, y: 110, ops: [{ gate: 'cx', q: ['A', 'L1'] }, { gate: 'cx', q: ['B', 'L2'] }, { gate: 'cx', q: ['C', 'L3'] }] },
    ],
    door: { x: 170, y: 110, key: '101', lock: ['L1', 'L2', 'L3'] },
    decor: [{ type: 'plate', x: 236, y: 56, text: 'TO TERRACE' }],
    windows: { y: 236, xs: [80, 270, 460] },
    shortest: 11,
    bonus: { seconds: 120, text: 'Completed within 2 minutes' },
    goal: 'No flashlight, so no observing. Put every platform exactly where you need it with gates alone, then set the three-lamp key.',
    concept:
      'Without light you cannot look and retry, and a platform in superposition cannot hold you: jump at one and you fall straight through. Only gates with a certain result will do. H, Z, H is a certain flip. H undoes H. |+⟩ and |−⟩ have the same 50/50 odds but opposite phase, and H tells them apart. The right CNOT pulls two entangled qubits apart again.',
    hints: [
      'T1 has no X: H, Z, H raises A for certain.',
      'T2 drives both platforms to its right. B starts in |+⟩: H puts it in state 0 for certain, then X raises it. E starts in |−⟩, the same odds with the opposite phase: a single H raises it for certain.',
      'C is entangled with D, and you need C raised and D lowered. At T3: CNOT C to D separates them and leaves D in state 0. Then H on C puts it in state 0 for certain, and X raises it.',
      'From C jump left onto D, then onto E, then onto the long ledge with the exit.',
      'At T4 copy A into L1 and C into L3, leave L2 alone, then press E at the lock.',
    ],
    takeaway:
      'You crossed the floor without a single observation, because the circuit told you where everything was. A good quantum circuit works the same way: the gates are arranged so the answer is certain before anyone looks.',
  },
];

// The epilogue: the roof, reached through the last exit. No qubits up here.
export const TERRACE = {
  id: 'terrace',
  name: 'The Terrace',
  tag: 'Epilogue',
  outdoor: true,
  torch: 'dead',
  gates: [],
  qubits: [],
  hints: [],
  spawn: { x: 176, y: 330 },
  solids: [{ kind: 'ground', x: 0, y: 330, w: 880, h: 210 }],
  platforms: [],
  terminals: [],
  scene: {
    door: { x: 112, y: 330 },
    generator: { x: 772, y: 330 },
    lamps: [250, 450, 650],
    edge: 880,
    line: { alice: 292, bob: 338, professor: 392, cat: 458 },
  },
  goal: 'You are on the roof. The generator is at the far end of the terrace: crank it to bring the power back.',
  concept: 'No qubits up here. Just the moon, a generator, and a building waiting for its lights.',
  takeaway: '',
};

// A floor without `rooms` is a single room made of its own top-level fields.
export function roomsOf(level) {
  return level.rooms || [{ id: 'main', name: level.name, ...level }];
}

export const ROLE_NAME = {
  platform: 'platform',
  canister: 'canister qubit',
  sealed: 'sealed qubit',
  box: 'atom in the box',
  door: 'lock lamp',
};

// What 0 and 1 mean for each role, in words.
export const ROLE_WORDS = {
  platform: ['lowered', 'raised'],
  box: ['alive', 'dead'],
};
