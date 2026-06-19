# QA Walkthrough

This is the intended complete path through the game.

1. Start a new shift.
2. In Reception, note that the intro grants the `Visitor Badge`.
3. Pick up the `Blank Form 11-H` and `Rubber Stamp`.
4. Use the stamp/form interaction to create the `Stamped Form`.
5. Listen to the Future Phone if testing the audio clue; it plays three click groups.
6. Select the `Stamped Form`, then use it on the Circle Door to enter Clock Hall.
7. Combine Reception Memo and Personnel Calendar clues, then solve Mood Clocks: `Regret`, `Hunger`, `Calm`, `Joy`.
8. Enter Security Office.
9. Inspect Monitor Bank, Incident Board, or Security Log for evidence.
10. Use `Visitor Badge` or `Stamped Form` on Key Cabinet to take `Security Key`.
11. Use `Security Key` on Evidence Safe to take `Audit Warrant`.
12. Enter Interrogation Booth.
13. Inspect the Rain Window to take the `Rain Cipher`. This is the visual/accessibility clue path for `731`.
14. Inspect the Interview File for the missing-hour story beat.
15. Enter Records Archive.
16. Inspect Archive Table for symbol/category mapping.
17. Take the `Time Token` from the Coin Drawer.
18. Visit Break Room, inspect Cork Board for category order, and pick up the `Paper Cup`.
19. Return to Records Archive and solve Index Drawers: `Triangle`, `Circle`, `Eye`, `Square`.
20. Alternate archive route: after viewing Security monitors, use `Audit Warrant` on Index Drawers to perform a security override.
21. Open Glass Case, take `Misfiled Folder`, `Mirror Shard`, and `Your Missing-Person File`, then read the file beat that explains why your own record matters.
22. Return to Break Room and use Memory Vending with code `731`.
23. Receive `Cup of Missing Hour` and `Server Fuse`.
24. Enter Mirror Office.
25. Use `Mirror Shard` on Black Mirror to reveal server sequence: `Circle`, `Triangle`, `Eye`, `Square`.
26. Use `Server Fuse` on Server Console to power it.
27. Use `Your Missing-Person File` or `Audit Warrant` on Red Intercom.
28. Use `Cup of Missing Hour` on Red Intercom.
29. Answer the Auditor: `The clerk holding the file.`, `Seven-three-one.`, `Outside the system.`
30. Solve Server Console: `Circle`, `Triangle`, `Eye`, `Square`.
31. For Filed Ending, use `Your Missing-Person File` on Exit Door.
32. For Escaped Ending, use `Cup of Missing Hour` on Exit Door.
33. For Audit Ending, use `Audit Warrant` on Exit Door.

Expected results:

- The boot screen is removed after Phaser startup and the title canvas is painted.
- The game canvas has a keyboard-focusable accessible name, keyboard shortcut metadata, and a screen-reader summary for keyboard controls.
- Dialogs expose their visible title and body through accessible name/description relationships.
- A missing required asset shows a readable in-canvas asset-load failure screen and DOM alert text naming the failed asset instead of hanging behind the boot overlay.
- A missing optional UI sound does not block boot or play; procedural audio fallback keeps the game usable.
- All puzzles can be completed without external instructions.
- Sound controls persist volume/mute changes, and the audio clue plays as click groups.
- Muted play exposes the accessibility transcript path for the vending clue.
- Help > Large Text enlarges dialogue/puzzle panels, stays inside the viewport, saves, restores after reload/Continue, survives Reset Shift, and carries into a fresh new shift.
- Help > Reduced Motion replaces ambient animation with static atmosphere, saves, restores after reload/Continue, survives Reset Shift, and carries into a fresh new shift; browser/OS reduced-motion defaults are honored on first launch.
- Keyboard shortcuts open Map, Notes, Hint, Help, Sound, and volume controls, and do not fire through open panels.
- Pressing `Enter` on the title starts a new shift, so the first action is not mouse-only.
- Credits can be opened from the title screen and from Help before finishing the game, and the Credits panel remains readable in normal and Large Text layouts.
- Early Notes keep clock clues generic until relevant evidence is read, and mid-game objectives can point toward the archive deduction route as well as Security.
- Final hints give a non-spoiler nudge first; exact answers appear only after pressing Show Answer.
- `Tab` / `Shift+Tab` keyboard focus can cycle room objects and inventory, and `Enter` / `Space` can activate them; QA uses this path to solve the opening form/stamp/door chain.
- Standard controller input can start from the title, cycle room objects/inventory with D-pad or left stick, select with `A`, close panels with `B`, and move focus between modal buttons.
- Progress persists after reload through `localStorage`.
- Mid-game reloads continue from the current route without losing key rewards.
- Map fast travel lists unlocked rooms and does not overlap Notes.
- Hovering useful objects shows a hand cursor, focus bracket, and label, but no hotspot markers are visible at rest.
- Known clues can be reviewed from relevant puzzle panels.
- Keypad puzzles can be solved with number-row keys as well as button clicks.
- The Phaser canvas is painted with varied room art on title, room, reload, map, and ending states; ending screens keep readable title, body, and action buttons.
- Filed, Escaped, and Audit endings each save a distinct ending id.
- After final verification, the Red Intercom offers optional Auditor questions about the file, hour, and warrant choices, and Notes remember those answers.
- Wrong Auditor answers give clue-specific feedback before retrying.
- Wrong puzzle entries recover cleanly and allow another attempt.
- Using wrong inventory items on major locks gives explicit feedback and does not grant rewards, open gates, or trigger endings.
- Major puzzle and Auditor answer buttons do not appear in solution order, so gates cannot be solved by simply clicking top-to-bottom.
- Closing a reward modal before pressing `Take` does not grant that reward.
- Invalid or partially corrupted saves repair implied rewards or move the player back to a valid room.
- Corrupt save data clears cleanly, removes stale Continue behavior from the title screen, and blocked browser storage still allows a new game.
- Help > Recover Position repairs progress without deleting inventory or the save.
- The vending code can be solved through either phone/tape audio or the rain cipher visual clue.
- Late-game Notes remain inside the panel and scroll when needed.
- Panels close with `Escape`.
- Modal button focus stays trapped inside panels, and `Escape` still closes panels if focus leaves the button.
- Canvas clicks still hit the intended game objects when the browser viewport scales or letterboxes the game.
- The production build succeeds with `npm run build`.
- The production verification gate succeeds with `npm run verify`, and the full release gate succeeds with `npm run release`.
