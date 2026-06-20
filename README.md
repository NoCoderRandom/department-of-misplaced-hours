# The Department of Misplaced Hours

A surreal point-and-click mystery puzzle game for the browser. You play a night-shift clerk in a bureaucratic office that processes missing hours, impossible forms, and evidence that your own life has been misfiled.

**Play now:** https://nocoderrandom.github.io/department-of-misplaced-hours/

The game is built as a static web app with Phaser 3, TypeScript, and Vite. It has no backend and is ready for GitHub Pages.
Use a static host or local dev/preview server to play it; opening the built `index.html` directly from `file://` is not supported.

## Features

- Seven playable rooms: Reception Desk, Clock Hall, Security Office, Interrogation Booth, Records Archive, Break Room, and Mirror Office.
- Inventory-based interaction with more than a dozen collectible or usable objects, now shown with compact pictogram icons.
- Multiple progression routes, including a Security Office audit-warrant path, a warrantless archive case-file path, an archive security-override path, an audio/visual vending code, physical final-act item use with clueful recovery feedback, optional Auditor consultation, and three ending actions.
- Three endings.
- Local save/load through `localStorage`, with audio, readability, and motion preferences preserved separately from progress resets.
- Mouse, keyboard, touch, and standard gamepad/controller navigation for title actions, room objects, inventory, and modal buttons, with live target announcements and a phone portrait rotate prompt.
- Procedural ambience plus CC0 Kenney UI/SFX sounds, document rustle, glass/safe/machine feedback, phone clue, and ending tones.
- Optimized generated WebP background art for title, seven rooms, and ending.
- Static boot screen, in-canvas loading progress, a readable no-JavaScript fallback, a readable asset-load failure screen with DOM alert text if a deployment is missing required images, and procedural audio fallback if optional UI sounds are unavailable.
- Browser install/share metadata, PNG social preview card, crawler guidance, and a sitemap for the public GitHub Pages release.
- In-game Credits panel reachable from the title screen, Help, and ending screen, with asset/license documentation pointers and direct source-document buttons for the web build.
- Static-host Content Security Policy and no-referrer policy are checked in release/live smoke.
- GitHub Pages deployment workflow in `.github/workflows/deploy-pages.yml`.

## Requirements

- Node.js 22 recommended.
- npm.

## Install

```bash
npm install
```

## Run Locally

```bash
npm run dev
```

Vite will print a local URL, usually `http://127.0.0.1:5173/`.

## Build

```bash
npm run build
```

The production files are written to `dist/`.
Serve `dist/` through a static server or host for testing; do not rely on double-clicking `dist/index.html` from the filesystem.

## Verify Release

```bash
npm run verify
```

This runs the prompt-level shipping audit, fast save-state regression tests, TypeScript, production build, exact release content checks, automated browser QA against the production preview, and a visual readability audit with minimum modal font-size checks. The QA covers save/load normalization, repair invariants, reset preference preservation, storage failure handling, asset-load failure recovery and alert text, optional audio fallback, no-JavaScript static-host fallback, intro Clock-In gating and legacy badge recovery, title/help Credits access, dialog title/body accessibility semantics, live keyboard target status, phone portrait rotate gating, puzzle-polish checks for Notes/objectives/side-room clue recall/hint answer reveal/Auditor feedback, three endings, canvas paint, rendered mobile canvas fit/aspect, and accessibility attributes, mid-game reloads, late-game reloads after Auditor verification and server unlock, non-spoiler phone clue recall in Notes, typed and clicked vending keypad paths, spent paperwork and vending ingredient sources plus consumed ingredient selection clearing, post-success Escape HUD refresh, phone/rain/muted clue paths with immediate muted phone/tape transcripts, hand-cursor hotspot/inventory behavior, touch first-tap hotspot preview and timeout clearing, sequence puzzle undo/backspace recovery, selection-safe audio controls, keyboard shortcuts including Help-accessible Reset Shift, selected-item cancel by Escape/right-click/controller B, right-click panel close, controller title/stick/object/modal navigation plus hint and bumper controls, large-text and reduced-motion preference persistence, reset survival, protected Start New behavior, clue-gated Mood Clocks, early and late-game wrong-item feedback, Auditor consultation notes and hour-presentation recovery, story-panel, Credits-panel, and ending-screen visual checks, failed-puzzle recovery, reward Escape checks including rain-note/glass/vending prompts and vending reward reload recovery, repaired spent paperwork/key sources, save repair, invalid-room save recovery, corrupt/unavailable storage recovery, Recover Position, malformed save handling, scaled/mobile canvas interaction, modal focus/Escape behavior, late-game Notes scrolling, and answer-order anti-spoiler checks.

## Preview Production Build

```bash
npm run preview
```

## Package Release

```bash
npm run release
```

This runs the full release gate, builds pending release archives, smoke-tests those pending archives in a browser for playable launch, no-JavaScript fallback, and touch-phone portrait gating, then transactionally promotes the ZIPs, checksum files, and expanded release folders only after smoke passes. The packager verifies the promoted ZIP checksums before reporting success and the generated release notes name the exact version, ZIP, paired checksum file, and verification commands. The standard archive contains the verified `dist/` build and release documentation only.

It also writes `release/department-of-misplaced-hours-<version>-store.zip`, a store-ready archive with `index.html` at the ZIP root for itch.io or other HTML game hosts that expect the playable build at archive root. If pending archive smoke fails, the final release ZIP names are left untouched.

## Deploy To GitHub Pages

1. Push this repository to GitHub on the `main` branch.
2. In the GitHub repository, open **Settings > Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`, or run the **Deploy to GitHub Pages** workflow manually.
5. The workflow installs dependencies, runs `npm run release`, retains the release ZIP/SHA files as a workflow artifact, uploads the verified `dist` artifact, deploys it with GitHub Pages, then runs a live browser smoke test against the public Pages URL.

## Smoke Live Page

```bash
npm run smoke:live
```

This checks the public GitHub Pages build, verifies and reports the deployed JS/CSS runtime chunk manifest, size budgets, install metadata, app icon dimensions, social card dimensions, HTML fallback copy, and crawler files, launches the game in a browser, verifies Credits source-document targets, starts a new shift, verifies controller `B` cannot skip the required Clock In orientation, checks that a save is written, verifies the no-JavaScript fallback, and confirms the touch-phone portrait rotate gate appears and clears in landscape.

## Controls

- Move the cursor around the room; it becomes a hand and the status line names useful objects.
- On touch screens, the first tap names a room object and the second tap activates it; the preview clears after a short pause, and selected inventory still uses immediately.
- Hovering a useful object shows an object-local focus bracket and label; there are no always-visible hotspot markers on the art.
- Click an inventory item to select it, then click a room object to try using it there.
- Press `Escape`, right-click the game, or press controller `B` to put away a selected inventory item.
- Completed one-shot inventory tools dim after their main use.
- Puzzle panels include clue review buttons once relevant evidence is known.
- Ordered-choice puzzles include Undo, and Backspace/Delete removes the last entry while the panel is focused.
- Keypad puzzles accept number-row keys, with Backspace/Delete clearing the entry.
- Press `Escape`, right-click, or controller `B` to close ordinary panels or put away the selected inventory item when no panel is open; the required Clock In orientation waits for its button.
- Use **Notes** to review discovered clues.
- Use **Map** for unlocked-room fast travel.
- Use **Hint** if stuck; exact sequence, code, and final-answer hints require an explicit **Show Answer** choice.
- Use **Help > Recover Position** to repair a strange save/position without deleting progress.
- Use **Help > Reset Shift** to discard the current save after a confirmation prompt; Cancel is focused first.
- Use **Help > Large Text** to enlarge dialogue, document, puzzle panels, HUD text, and inventory labels.
- Use **Help > Reduced Motion** to replace ambient animation with static atmosphere layers; the game also honors browser/OS reduced-motion settings on first launch.
- Use **Credits** on the title screen, in Help, or on the ending screen for asset/license pointers.
- Use **Sound**, **-**, and **+** for audio controls.
- Keyboard: `M` Map, `N` Notes, `H` Hint, `F1` Help, `S` Sound, `[` / `]` volume.
- Keyboard focus: `Tab` / `Shift+Tab` cycles title actions, ending actions, room objects, and inventory when those targets are present; `Enter` / `Space` activates the focused target.
- Controller: D-pad or left stick cycles title actions, ending actions, room objects, inventory, and modal buttons; `A` selects; `B` cancels a selected item or closes ordinary panels; the required Clock In orientation waits for its button; `Back/View` opens Map, `X` opens Notes, `Y` opens Hint, `Start/Menu` opens Help, and bumpers adjust volume.
- The game canvas has an accessible name, screen-reader summary for its keyboard controls, and hidden live status updates for current targets/status.
- Dialog panels expose visible titles and body text through `aria-labelledby` and `aria-describedby`.
- Progress saves automatically after meaningful actions when browser storage is available. Audio, Large Text, and Reduced Motion preferences survive Reset Shift.
- If the browser blocks localStorage, the game warns that the current session is playable but progress will not survive closing or reloading the page.

## Known Limitations

- Phaser is split into a separate vendor chunk for better repeat-load caching, though the engine still dominates total JavaScript size.
- Procedural audio depends on browser Web Audio support and starts after the first user interaction.
- The generated backgrounds are static WebP images, with animation and interaction layered in Phaser.
- The game is designed desktop-first; small mobile screens fit the full canvas, but the experience is still best with a mouse or large touch screen.
- Project GitHub Pages metadata includes relative favicon, Apple touch icon, manifest, sitemap, generated PNG install icons, and a PNG social preview card.

## Project Structure

- `src/scenes/MainScene.ts` - main game flow, rooms, puzzles, UI, endings.
- `src/state/GameState.ts` - save data, inventory, flags, endings.
- `src/audio/AudioDirector.ts` - procedural Web Audio.
- `src/data/content.ts` - item and room definitions.
- `public/assets/images/` - generated visual assets.
- `scripts/optimize-images.mjs` - reproducible WebP export for generated room art.
- `scripts/check-release.mjs` - verifies exact required `dist/` assets, runtime chunk size budgets, app/social icons and install metadata, production CSP hardening, no-JavaScript fallback copy, image provenance hashes, and release package contents.
- `scripts/package-release.mjs` - creates, validates, smoke-tests, transactionally promotes, and verifies the distributable ZIP archives with platform-normalized text files, guarded generated release README copy, and a deterministic Node-based ZIP writer.
- `scripts/ship-audit.mjs` - verifies broad shipping-scope requirements from source/docs before every release gate: static hosting, GitHub Pages workflow, room/item/ending counts, documented puzzles, legal asset docs, and required QA scripts.
- `scripts/visual-audit.mjs` - screenshots desktop/mobile modal states, Credits panels, Future Phone story panels, and ending screens, including short-screen dense mobile puzzle panels, and fails on panel, minimum font size, text overflow, button-label, focus, ending readability, or Escape regressions.
- `scripts/smoke-release-archives.mjs` - extracts standard/store ZIPs, serves the playable web roots, and browser-smoke-tests launch, Credits source-document targets, controller-B Clock-In gating, right-click panel close, no-JavaScript fallback, and touch-phone portrait orientation gating.
- `scripts/smoke-live.mjs` - browser-smoke-tests the deployed public GitHub Pages URL, including deployed runtime chunk manifest/size budgets, reported install/app/social metadata, Credits source-document targets, normal play with controller-B Clock-In gating and right-click panel close, no-JavaScript fallback, and touch-phone portrait orientation gating.
- `scripts/state-tests.mjs` - fast save/load, repair-invariant, reset-preference, and storage-failure regression tests.
- `scripts/qa-playthrough.mjs` - automated browser QA for ship checks, including all authored hotspot cursor/status coverage, Credits source-document URL targets, ending Credits/actions after reload, and late-game spent-item cleanup.
- `ASSETS.md` - asset provenance and license notes.
- `THIRD_PARTY_NOTICES.md` - bundled runtime and audio license notices.
- `docs/ASSET_PROVENANCE.md` - release image hashes and optimization settings.
- `DESIGN_NOTES.md` - research summary and design rationale.
- `PROGRESS.md` - implementation checkpoints.
