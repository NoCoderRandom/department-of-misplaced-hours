# The Department of Misplaced Hours

A surreal point-and-click mystery puzzle game for the browser. You play a night-shift clerk in a bureaucratic office that processes missing hours, impossible forms, and evidence that your own life has been misfiled.

**Play now:** https://nocoderrandom.github.io/department-of-misplaced-hours/

The game is built as a static web app with Phaser 3, TypeScript, and Vite. It has no backend and is ready for GitHub Pages.

## Features

- Seven playable rooms: Reception Desk, Clock Hall, Security Office, Interrogation Booth, Records Archive, Break Room, and Mirror Office.
- Inventory-based interaction with more than a dozen collectible or usable objects, now shown with compact pictogram icons.
- Multiple progression routes, including a Security Office audit-warrant path, an archive deduction path, an archive security-override path, an audio/visual vending code, physical final-act item use, and three ending actions.
- Three endings.
- Local save/load through `localStorage`, with audio, readability, and motion preferences preserved separately from progress resets.
- Mouse, keyboard, and standard gamepad/controller navigation for title actions, room objects, inventory, and modal buttons.
- Procedural ambience plus CC0 Kenney UI/SFX sounds, document rustle, glass/safe/machine feedback, phone clue, and ending tones.
- Optimized generated WebP background art for title, seven rooms, and ending.
- Static boot screen, in-canvas loading progress, a readable no-JavaScript fallback, a readable asset-load failure screen if a deployment is missing required images, and procedural audio fallback if optional UI sounds are unavailable.
- Browser install/share metadata, crawler guidance, and a sitemap for the public GitHub Pages release.
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

## Verify Release

```bash
npm run verify
```

This runs TypeScript, production build, exact release content checks, automated browser QA against the production preview, and a visual readability audit. The QA covers asset-load failure recovery, optional audio fallback, no-JavaScript static-host fallback, intro badge recovery, three endings, canvas paint and accessibility attributes, mid-game reloads, phone/rain/muted clue paths, audio controls, keyboard shortcuts, controller title/object/modal navigation, large-text and reduced-motion preference persistence, reset survival, protected Start New behavior, clue-gated Mood Clocks, failed-puzzle recovery, reward Escape checks including rain/glass/vending take prompts, save repair, invalid-room save recovery, corrupt/unavailable storage recovery, Recover Position, malformed save handling, scaled/mobile canvas interaction, modal focus/Escape behavior, late-game Notes scrolling, and answer-order anti-spoiler checks.

## Preview Production Build

```bash
npm run preview
```

## Package Release

```bash
npm run release
```

This runs the full release gate, builds pending release archives, smoke-tests those pending archives in a browser, then transactionally promotes the ZIPs, checksum files, and expanded release folders only after smoke passes. The packager verifies the promoted ZIP checksums before reporting success. The standard archive contains the verified `dist/` build and release documentation only.

It also writes `release/department-of-misplaced-hours-<version>-store.zip`, a store-ready archive with `index.html` at the ZIP root for itch.io or other HTML game hosts that expect the playable build at archive root. If pending archive smoke fails, the final release ZIP names are left untouched.

## Deploy To GitHub Pages

1. Push this repository to GitHub on the `main` branch.
2. In the GitHub repository, open **Settings > Pages**.
3. Set **Source** to **GitHub Actions**.
4. Push to `main`, or run the **Deploy to GitHub Pages** workflow manually.
5. The workflow installs dependencies, runs `npm run release`, uploads the verified `dist` artifact, deploys it with GitHub Pages, then runs a live browser smoke test against the public Pages URL.

## Smoke Live Page

```bash
npm run smoke:live
```

This checks the public GitHub Pages build, verifies the HTML fallback copy, static-site metadata, crawler files, launches the game in a browser, starts a new shift, checks that a save is written, and verifies the no-JavaScript fallback.

## Controls

- Move the cursor around the room; it becomes a hand and the status line names useful objects.
- Hovering a useful object shows an object-local focus bracket and label; there are no always-visible hotspot markers on the art.
- Click an inventory item to select it, then click a room object to try using it there.
- Completed one-shot inventory tools dim after their main use.
- Puzzle panels include clue review buttons once relevant evidence is known.
- Press `Escape` to close the current panel.
- Use **Notes** to review discovered clues.
- Use **Map** for unlocked-room fast travel.
- Use **Hint** if stuck.
- Use **Help > Recover Position** to repair a strange save/position without deleting progress.
- Use **Help > Large Text** to enlarge dialogue, document, and puzzle panels.
- Use **Help > Reduced Motion** to replace ambient animation with static atmosphere layers; the game also honors browser/OS reduced-motion settings on first launch.
- Use **Sound**, **-**, and **+** for audio controls.
- Keyboard: `M` Map, `N` Notes, `H` Hint, `F1` Help, `S` Sound, `[` / `]` volume.
- Keyboard object mode: `Tab` / `Shift+Tab` cycles room objects and inventory; `Enter` / `Space` activates the focused target.
- Controller: D-pad or left stick cycles title actions, room objects, inventory, and modal buttons; `A` selects; `B` closes panels; `Back/View` opens Map, `X` opens Notes, `Y` opens Hint, `Start/Menu` opens Help, and bumpers adjust volume.
- The game canvas has an accessible name and screen-reader summary for its keyboard controls.
- Progress saves automatically after meaningful actions when browser storage is available. Audio, Large Text, and Reduced Motion preferences survive Reset Shift.
- If the browser blocks localStorage, the game warns that the current session is playable but progress will not survive closing or reloading the page.

## Known Limitations

- The game uses one Phaser bundle, so Vite reports a large JavaScript chunk because Phaser is included in the build.
- Procedural audio depends on browser Web Audio support and starts after the first user interaction.
- The generated backgrounds are static WebP images, with animation and interaction layered in Phaser.
- The game is designed desktop-first; small mobile screens fit the full canvas, but the experience is still best with a mouse or large touch screen.

## Project Structure

- `src/scenes/MainScene.ts` - main game flow, rooms, puzzles, UI, endings.
- `src/state/GameState.ts` - save data, inventory, flags, endings.
- `src/audio/AudioDirector.ts` - procedural Web Audio.
- `src/data/content.ts` - item and room definitions.
- `public/assets/images/` - generated visual assets.
- `scripts/optimize-images.mjs` - reproducible WebP export for generated room art.
- `scripts/check-release.mjs` - verifies exact required `dist/` assets and release package contents.
- `scripts/package-release.mjs` - creates, validates, smoke-tests, transactionally promotes, and verifies the distributable ZIP archives with a deterministic Node-based ZIP writer.
- `scripts/visual-audit.mjs` - screenshots desktop/mobile modal states, including short-screen dense mobile puzzle panels, and fails on panel, text, button-label, focus, or Escape regressions.
- `scripts/smoke-release-archives.mjs` - extracts standard/store ZIPs, serves the playable web roots, and browser-smoke-tests launch.
- `scripts/smoke-live.mjs` - browser-smoke-tests the deployed public GitHub Pages URL, including normal play and the no-JavaScript fallback.
- `scripts/qa-playthrough.mjs` - automated browser QA for ship checks.
- `ASSETS.md` - asset provenance and license notes.
- `THIRD_PARTY_NOTICES.md` - bundled runtime and audio license notices.
- `docs/ASSET_PROVENANCE.md` - release image hashes and optimization settings.
- `DESIGN_NOTES.md` - research summary and design rationale.
- `PROGRESS.md` - implementation checkpoints.
