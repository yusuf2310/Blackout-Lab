# Before you submit: Qollab checklist

This build was tested locally (Qiskit 2.5.2 on CPython, headless Chromium). It has **not** been run inside Qollab itself, so do these once, in order. Nothing here needs code unless a step fails.

## 1. Upload

1. `python tools/package.py` writes `dist/qollab/` and `dist/blackout-lab-qollab.zip`.
2. On Qollab: **+ New Project** → **Upload your own files** → upload the contents of `dist/qollab/` keeping the `game/` and `engine/` folders. `index.html` and `main.js` must sit at the top level; the editor should label the project HTML/JS.
3. Do not upload `dev/`, `tests/` or `tools/`.

## 2. First run: built-in simulator

Press **Run**, choose **Built-in simulator**, press **Run**.

- [ ] The title screen appears, the status line changes from "Loading Qiskit" to "Self-test done on …", and **Enter the building** becomes clickable.
- [ ] The self-test table shows 100% on the four pass lines and "none: ideal".
- [ ] Click the game once, then play floor 1: E at T1, Enter (H), E again to leave, aim the flashlight at a dotted outline.
- [ ] The circuit, probabilities and event log in the rack update as you play.

If the title screen stays on "Loading Qiskit" for more than a minute, open the console under the page. The two most likely causes:

| Console says | Fix |
| --- | --- |
| it cannot resolve `engine.bridge` or `./game/game.js` | the folders were flattened on upload; re-upload keeping `engine/` and `game/` |
| `callPromising is not a function` | Qollab changed how Python functions are exposed; in `game/quantum.js` replace `fn.callPromising(...args)` with whatever the current docs show |

## 3. Second run: an IonQ simulator

Press **Stop**, then **Run**, choose **IonQ Forte 1 (remote simulator)**.

- [ ] The status line says the self-test is running on the IonQ backend, then shows results. This is the run's one IonQ job; expect several seconds or a queue wait. After 12 seconds a "Start now with ideal physics" button appears.
- [ ] The table shows less than 100% somewhere and a non-zero "Error chance used in the game". If it shows a perfect score, Qollab's IonQ backend is running without its noise model; the game still works.
- [ ] Play floors 3 and 6 for a while (pause menu → "Skip to floor"). No second job is ever sent: the console must not show a "one job per run" error.
- [ ] Jump to "Ending: the terrace" from the same menu, crank the generator and let it play through to "Thank you for playing." The ending uses no qubits, so it sends nothing to the engine or the backend.

## 4. Third run: an IBM noise-model simulator

- [ ] Same as above with **IBM Fez** or another IBM entry. This exercises `compile_for` in `engine/calibrate.py` (compile for a 156-qubit device, then drop idle qubits). If the self-test fails here the game says so on the title screen and carries on with ideal physics; paste the message from the title screen into the team chat.

## 5. Project page and submission

- [ ] README.md shows as the project page. Fill in team names, demo video link and repository link at the top.
- [ ] In `index.html`, find the `about` block (search for `about-links`) and paste the Qollab project URL and the GitHub URL into the two empty `href=""` attributes. They appear on the title screen as "View Qollab Project Page" and "View GitHub Repository"; an empty one reads "link not added yet". Check on Qollab that clicking them opens a new tab; the address is also shown as text in case the page blocks pop-ups.
- [ ] Licence set to MIT, theme tag set (Quantum Playground suggested).
- [ ] The line "This effort is supported by Qollab & IonQ." is on the project page (it is in the README and in the game's footer).
- [ ] Publish, then open the published project in a logged-out browser window and run it start to finish.
- [ ] Record the 2 to 3 minute demo video: title and self-test, floor 1 superposition and collapse, floor 3 canister and entangled collapse, floor 5 Professor and cat, floor 6 teleport with Alice's note, floor 7 solved with gates alone, the terrace ending, then the Qiskit code view. "Skip to floor" on the title screen or in the pause menu gets you to each quickly.
- [ ] Captain submits on the registration page before Oct 11, 7:00 PM ET.
