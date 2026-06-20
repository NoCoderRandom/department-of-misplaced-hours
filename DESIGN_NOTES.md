# Design Notes

## Research Summary

The brief called for a complete static browser game, so the research focused on three areas: fast static-game delivery, fair point-and-click puzzle structure, and legally clean assets.

- Phaser with Vite and TypeScript was chosen because Phaser has an official Vite TypeScript template and exports cleanly as static files.
- GitHub Pages deployment uses the current GitHub Actions Pages flow: configure Pages, upload the built artifact, and deploy it.
- Point-and-click puzzle notes emphasized visible interactables, clue proximity, non-pixel-hunting hotspots, and puzzle chains where the player understands what is missing.
- Asset research covered permissive sources such as Kenney, OpenGameArt, Freesound, and Pixabay. The final game uses generated local images, procedural ambience, and selected CC0 Kenney SFX.

Reference links:

- Phaser Vite TypeScript template: https://github.com/phaserjs/template-vite-ts
- GitHub Pages custom workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- GitHub Pages publishing source: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Kenney license/support reference: https://kenney.nl/support
- Point-and-click puzzle design article: https://www.gamedeveloper.com/design/how-to-design-brillo-point-and-click-adventure-game-puzzles
- Horror puzzle-design caution notes: https://horror.dreamdawn.com/?p=202230

## Chosen Concept

**The Department of Misplaced Hours** stayed close to the prompt because it is immediately playable as a surreal office mystery. The setting also supports puzzle logic naturally: stamps, forms, clocks, filing systems, intercom verification, and vending-machine codes all feel diegetic.

## Rejected Concepts

- A haunted mansion mystery was rejected as too familiar.
- A pure horror escape room was rejected because the prompt favored weird mystery over jump scares.
- A combat or stealth game was rejected because puzzle content mattered more than mechanical complexity.

## Core Gameplay Loop

1. Explore a strange office room.
2. Sweep the room with the cursor until the hand/status feedback reveals useful objects.
3. Collect an object, clue, or document.
4. Use inventory or knowledge from another room to solve a puzzle.
5. Unlock a deeper room.
6. Piece together the revelation that the department is processing the player's own missing life.

## Rooms

- **Reception Desk:** introduces paperwork, inventory use, the future phone, and the first locked door.
- **Clock Hall:** emotion-order clock puzzle and navigation hub.
- **Security Office:** audit authority path, security evidence, evidence safe, alternate archive override, and Mirror Office foreshadowing.
- **Interrogation Booth:** alternate vending clue path, rain cipher, and missing-hour story beat.
- **Records Archive:** split-clue symbol sorting, glass-case unlock, file/shard pickup.
- **Break Room:** cork-board clue, paper cup, vending machine, and audio-code puzzle.
- **Mirror Office:** physical final-act ritual: shard, fuse, file, hour, console, ending item use.

## Puzzle List

1. **Form Stamp Puzzle:** combine blank form and rubber stamp, then use the stamped form on the circle door.
2. **Mood Clock Puzzle:** order emotions from Reception/Clock clues: regret, hunger, calm, joy.
3. **Security Audit Puzzle:** inspect evidence, prove authority at the key cabinet, use the Security Key on the safe, and acquire the Audit Warrant.
4. **Interrogation/Rain Cipher:** use the tape recorder or rain window as alternate clues for the vending code.
5. **Archive Sorting Puzzle:** combine the archive table's symbol/category mapping with the break-room category order, or use monitored evidence plus the Audit Warrant as a security override.
6. **Vending Puzzle:** combine Time Token, Paper Cup, and a clue path to dispense the missing hour and fuse.
7. **Final Ritual:** after the glass-case file beat, enter Mirror Office through either Audit Warrant authority or Missing-Person File authority, then use Mirror Shard on mirror, Server Fuse on console, Missing-Person File or Audit Warrant and Cup of Missing Hour on intercom, then answer the Auditor.
8. **Mirror Server Puzzle:** use the mirror shard to reveal the visual order: circle, triangle, eye, square.
9. **Ending Choice:** use the file on the exit ledger slot, the cup on the bright hour crack, or the Audit Warrant on the exit seal.

## Art Direction

The visual style is painterly surreal bureaucracy: cold fluorescent greens, yellowed paperwork, burgundy shadows, brass, old telephones, impossible clocks, rain glass, and wet office floors. Generated WebP backgrounds provide atmosphere while Phaser overlays handle cursor feedback, UI, particles, rain streaks, scanline movement, and puzzle panels.

## Sound Direction

The soundscape mixes procedural Web Audio ambience with CC0 Kenney UI/SFX files. Each room has a different oscillator/noise bed. UI, pickup, paper, glass, safe, machine, stinger, and success/failure sounds use imported OGG files. The important code clue can be solved by counting the future phone/tape-recorder click groups or by reading the rain cipher.

## Technical Decisions

- Phaser 3 handles rendering, input, scaling, and scene composition.
- TypeScript keeps state and puzzle code maintainable.
- Vite builds relative static assets through `base: "./"` for GitHub Pages compatibility.
- `localStorage` stores room, inventory, flags, and ending in the progress save, with volume, mute, Large Text, and Reduced Motion mirrored to a separate preferences key so Reset Shift does not erase player settings.
- Web Audio keeps the audio legally clean and lightweight.
- Selected Kenney CC0 OGG files improve tactile feedback without licensing friction.
- `scripts/state-tests.mjs` runs before build/browser QA to catch save/load normalization, repair-invariant, reset-preference, and storage-failure regressions quickly.
- `scripts/ship-audit.mjs` runs at the start of `npm run verify` and checks prompt-level deliverables that are easy to accidentally drift: static-host configuration, GitHub Pages workflow, room/item/ending counts, documented puzzle scope, required source/docs, legal asset notices, install/share metadata hooks, and required release/QA scripts.
- `scripts/qa-playthrough.mjs` can run quick development QA or production-preview QA; the release gate verifies the built `dist/` through asset-load failure recovery with DOM alert text, optional audio fallback, intro badge recovery, title/help Credits access, dialog title/body accessibility semantics, live keyboard target status, phone portrait rotate gating, puzzle-polish checks for Notes/objectives/side-room clue recall/hint answer reveal/Auditor feedback, both main routes plus the third audit ending, canvas paint checks, rendered mobile canvas fit/aspect checks, mid-game reloads, late-game reloads after Auditor verification and server unlock, non-spoiler phone clue recall in Notes and puzzle clue review, typed and clicked vending keypad paths, phone/rain/muted clue paths with immediate muted phone/tape transcripts, hand-cursor hotspot/inventory behavior, touch first-tap hotspot preview with immediate selected-item use, sequence puzzle undo/backspace recovery, selection-safe audio controls, keyboard shortcuts, selected-item cancel by Escape/right-click/controller B, keyboard title start, protected Start New behavior, controller title/stick/object/modal navigation with hint and bumper controls, clue-gated Mood Clocks, large-text and reduced-motion preference persistence/layout/reset survival, system reduced-motion migration for legacy saves, keyboard object/inventory interaction, early and late-game wrong-item feedback, Auditor consultation notes and hour-presentation recovery, failed-puzzle recovery, reward Escape checks for rain/glass/vending take prompts plus vending reward reload recovery, save repair, invalid-room save recovery, corrupt/unavailable storage recovery with player warning, Recover Position, archive gates, pre-file vending story gate, malformed save normalization, scaled desktop/mobile interaction, modal focus/Escape behavior, reset behavior, late-game Notes scrolling, answer-order anti-spoiler checks, downstream save repair, and desktop/mobile visual readability screenshots including Credits panels, Future Phone story panels, and ending screens.
- `scripts/check-release.mjs` validates the exact expected build asset manifest, including the entry CSS/JS, Phaser vendor chunk, any tiny Vite/Rolldown runtime helper referenced by production HTML, and runtime chunk size budgets, app/social icons and install metadata, production CSP hardening, no-JavaScript fallback copy, image provenance hashes, blocks extra `dist/` files, sourcemaps, unapproved payload regressions, oversized `dist/`, and accidental package contents such as source, temp files, backups, prompts, or duplicate public assets.
- `scripts/smoke-release-archives.mjs` extracts both pending ZIP formats, serves the actual web roots, verifies Credits source-document targets, starts a new shift, verifies the no-JavaScript fallback, and verifies touch-phone portrait orientation gating before release artifacts are promoted.
- `scripts/smoke-live.mjs` checks the deployed GitHub Pages URL, including the live runtime JS/CSS chunk manifest and size budgets, static metadata, install metadata, app icons, social card, robots/sitemap, Credits source-document targets, canvas accessibility, fresh-shift boot, no-JavaScript fallback, and touch-phone portrait orientation gating. Its success JSON reports the validated manifest fields, app-icon dimensions, social-card dimensions, crawler files, and runtime chunk byte sizes so release evidence is visible without opening the script.
- `scripts/package-release.mjs` creates verified standard and store ZIP archives containing only the built game and release documentation, plus SHA-256 checksum files. It normalizes shipped text files to LF, guards generated release README controls/Credits/checksum copy, uses a deterministic Node-based ZIP writer, stages to temporary release paths, validates both ZIPs against an exact archive manifest, smoke-tests the pending archives through `scripts/smoke-release-archives.mjs`, transactionally promotes final ZIPs, checksums, and expanded release folders only after smoke passes, re-checks the promoted final ZIP checksums before reporting success, and refuses extra top-level release artifacts.
- Hover focus uses temporary object-local brackets/labels instead of permanent hotspot markers, preserving the art while reducing pixel-hunt uncertainty.
- Touch input uses first-tap hotspot preview and second-tap activation, so touch players get the missing hover affordance without permanent hotspot markers. The preview clears after a short pause, and selected inventory bypasses the preview and uses immediately.
- Keyboard focus uses the same temporary bracket/status feedback plus a hidden live status region, so title actions, ending actions, room objects, and inventory can be cycled and activated without pointer coordinates.
- Browser QA now sweeps every authored room hotspot for hand-cursor feedback and live target status, rather than sampling one hotspot per room.
- Standard controller/gamepad input reuses the same focus targets: D-pad or left stick cycles title actions, ending actions, room objects, inventory, and modal buttons; A selects; B cancels selected items or closes panels; face/menu buttons open common panels.
- Help includes Large Text and Reduced Motion preferences that scale dialogue, document, puzzle, action-button, HUD, and inventory text while allowing ambient animation to be replaced by static atmosphere layers. First launch also honors browser/OS reduced-motion settings unless the player overrides them in Help.
- Credits are reachable from title, Help, and endings, giving in-game pointers and direct source-document buttons for the shipped asset/license documents instead of hiding attribution only in repository files. QA intercepts those document buttons and verifies the exact repository URL, `_blank` target, and `noopener,noreferrer` features without depending on external network availability.
- Ending actions reuse the keyboard/controller focus path from the title screen, so saved ending screens remain operable without a mouse after reload.
- Puzzle modals can offer contextual clue review so players do not need to close a keypad/order puzzle just to reread known evidence.
- DOM dialogs connect their visible heading and body to assistive technology with `aria-labelledby` and `aria-describedby`.
- Ordered-choice puzzle modals include Undo plus Backspace/Delete support so one misclick does not force a failed submission or full reset.
- The phone/tape audio clue is remembered in Notes and Memory Vending review as non-spoiler recall after discovery; exact digits come from the rain visual clue, muted accessibility transcript, or explicit Hint answer, then Notes records the solved code after Memory Vending is complete for final-act recall.
- The required vending reward labels the missing hour as unfileable, and Notes plus the solved vending-machine response preserve that warning, giving a positive clue for the final "Outside the system" Auditor answer before the quiz.
- Optional side-room flavor can also clarify puzzle red herrings: the Handless Clock reminds players that grouped clues are counted, and the Microwave establishes that impossible hours cannot be filed there.
- Spent paperwork sources are state-aware: after Form 11-H is stamped, the in-tray and rubber stamp become flavor-only responses instead of reissuing confusing early-game tools.
- Spent ingredient sources are state-aware: after Memory Vending consumes the Time Token and Paper Cup, the coin drawer and cup stack become flavor-only responses instead of reissuing confusing late-game clutter.
- Notes avoid revealing clock-solution detail before the related documents are read, and objectives acknowledge the warrantless archive case-file route instead of forcing a single warrant-first reading.
- After the archive drawers are solved, Notes and Map point directly to the unlocked glass case instead of implying the records are already usable.
- Hints keep exact solutions behind an explicit Show Answer step, so stuck players can still recover without accidental spoilers.
- Keypad puzzles accept typed number keys in addition to pointer/controller modal buttons.
- If the player presents the missing hour at the red intercom but closes the Auditor prompt, the intercom resumes verification instead of asking for the same item again.
- After final identity/hour verification, the Auditor can be questioned about the file and hour endings, plus the warrant ending when the player actually has audit authority; warrantless routes instead explain why the audit seal remains locked.
- Late-game Mirror hints, intercom guidance, the final exit prompt, Notes objectives, and wrong-item feedback mirror route state: warrant routes name the warrant option, while warrantless routes name only the file/hour mechanisms and explicitly mark the audit seal dark.
- Wrong Auditor answers now point back to the relevant file, phone/rain, or system clue instead of repeating generic failure text.
- Dense puzzle panels use compact mobile button grids with a short-screen layout, and visual audit fails on too-small story/modal text, hidden body text, overflowing Credits copy, overflowing button labels, ending-screen readability regressions, focus trap failures, or Escape regressions in normal and Large Text modes.
- Generated art is optimized to 1200x800 WebP files under `public/assets/images/` so the static build can copy it directly.
- The static HTML boot screen covers JavaScript startup, then Phaser shows an in-canvas loading panel while room art and sound effects load.
- If a deployment is missing required images, the loader switches to a readable failure screen and a DOM alert that name the missing asset and offer reload. Missing optional UI audio is recorded for diagnostics but falls back to procedural sound so the game remains playable.

## Known Limitations

- The Phaser dependency still dominates total JavaScript size, though it is split into a vendor chunk for better caching.
- The game is designed around mouse/touch interaction, with keyboard and controller focus for room objects/inventory plus shortcuts for common desktop panels and audio controls.
- Procedural audio cannot be perfectly identical across browsers.
- Background art is static; room animation is layered through particles, rain streaks, scanline movement, flicker, and UI feedback.

## Future Improvements

- Add more optional flavor responses in side rooms if production scope allows.
- Expand Playwright coverage with more negative-use interactions and save/load checkpoints.
