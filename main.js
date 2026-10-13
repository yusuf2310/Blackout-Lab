// Blackout Lab: entry point for Qollab (a JS / Qiskit project).
//
// All quantum work is Python + Qiskit in engine/. Qollab resolves 'engine.bridge'
// to engine/bridge.py; `backend` is the machine picked in "Select QPU".
import * as bridge from 'engine.bridge';
import { startGame } from './game/game.js';

const machine = typeof backend === 'undefined' ? null : backend;

function machineName(b) {
  if (!b) return 'local Qiskit simulator';
  try {
    const name = typeof b.name === 'function' ? b.name() : b.name;
    return String(name || (b.constructor && b.constructor.name) || 'selected backend');
  } catch (err) {
    return 'selected backend';
  }
}

const game = startGame({ bridge, backend: machine, backendName: machineName(machine) });
globalThis.blackoutLab = game;
await game.boot();

// Keep the run alive until Stop is pressed.
await new Promise(() => {});
