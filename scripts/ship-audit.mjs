import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const requiredFiles = [
  "README.md",
  "ASSETS.md",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "DESIGN_NOTES.md",
  "PROGRESS.md",
  ".github/workflows/deploy-pages.yml",
  "index.html",
  "vite.config.ts",
  "src/scenes/MainScene.ts",
  "src/state/GameState.ts",
  "src/data/content.ts",
  "src/audio/AudioDirector.ts"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function read(path) {
  return readFile(path, "utf8");
}

async function assertExists(path) {
  try {
    await access(path);
  } catch {
    throw new Error(`Required ship file is missing: ${path}`);
  }
}

function requireText(label, text, required) {
  for (const needle of required) {
    assert(text.includes(needle), `${label} is missing required text: ${needle}`);
  }
}

function extractConstStringArray(source, name) {
  const match = source.match(new RegExp(`const\\s+${name}\\s*:[^=]+?=\\s*\\[([\\s\\S]*?)\\];`));
  assert(match, `Could not find ${name} array.`);
  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
}

function countMarkdownListItems(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  assert(start >= 0, `DESIGN_NOTES.md is missing ## ${heading}.`);
  let count = 0;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) {
      break;
    }
    if (/^(?:- |\d+\. )/.test(line)) {
      count += 1;
    }
  }
  return count;
}

function assertNpmScript(packageJson, name, requiredText) {
  const script = packageJson.scripts?.[name];
  assert(typeof script === "string" && script.length > 0, `package.json is missing npm script: ${name}`);
  if (requiredText) {
    assert(script.includes(requiredText), `npm script ${name} does not include ${requiredText}: ${script}`);
  }
}

async function listFiles(dir, extension) {
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(extension)).map((entry) => join(dir, entry.name));
}

for (const file of requiredFiles) {
  await assertExists(file);
}

const packageJson = JSON.parse(await read("package.json"));
assert(packageJson.name === "department-of-misplaced-hours", "package.json has unexpected package name.");
assert(packageJson.private === true, "package.json must stay private for this proprietary game build.");
assert(packageJson.license === "UNLICENSED", "package.json license should remain UNLICENSED unless the owner chooses a distribution license.");
assert(packageJson.description?.includes("static web hosting"), "package.json description should state static web hosting.");
assert(Object.keys(packageJson.dependencies ?? {}).join(",") === "phaser", "Runtime dependencies should stay limited to Phaser for the static game.");
for (const [name, requiredText] of [
  ["ship:audit", "scripts/ship-audit.mjs"],
  ["test:state", "scripts/state-tests.mjs"],
  ["typecheck", "tsc --noEmit"],
  ["build", "vite build"],
  ["release:check", "scripts/check-release.mjs"],
  ["qa:preview", "scripts/qa-playthrough.mjs --preview"],
  ["qa:visual", "scripts/visual-audit.mjs"],
  ["smoke:live", "scripts/smoke-live.mjs"],
  ["release", "npm run package:release"]
]) {
  assertNpmScript(packageJson, name, requiredText);
}
assertNpmScript(packageJson, "verify", "npm run ship:audit");
assertNpmScript(packageJson, "package:release", "npm run verify");

const workflow = await read(".github/workflows/deploy-pages.yml");
requireText("deploy-pages workflow", workflow, [
  "npm ci",
  "npm run release",
  "actions/upload-artifact",
  "release/*.zip",
  "release/*.sha256",
  "actions/upload-pages-artifact",
  "actions/deploy-pages",
  "npm run smoke:live"
]);

const viteConfig = await read("vite.config.ts");
requireText("vite.config.ts", viteConfig, ['base: "./"', "sourcemap: false", 'outDir: "dist"', "manualChunks"]);

const indexHtml = await read("index.html");
requireText("index.html", indexHtml, [
  "Content-Security-Policy",
  "default-src 'self'",
  "object-src 'none'",
  "form-action 'none'",
  "Interactive point-and-click mystery game canvas",
  "This browser game needs JavaScript enabled",
  "static",
  "does not require a backend server",
  "./site.webmanifest",
  "./icon-192.png"
]);

const gameState = await read("src/state/GameState.ts");
const roomIds = extractConstStringArray(gameState, "ROOM_IDS");
const itemIds = extractConstStringArray(gameState, "ITEM_IDS");
const endingIds = extractConstStringArray(gameState, "ENDING_IDS");
assert(roomIds.length >= 5, `Expected at least 5 rooms, found ${roomIds.length}.`);
assert(itemIds.length >= 8, `Expected at least 8 inventory items, found ${itemIds.length}.`);
assert(endingIds.length >= 1, `Expected at least 1 ending, found ${endingIds.length}.`);
requireText("GameState.ts", gameState, ["localStorage", "department-misplaced-hours-save-v1", "department-misplaced-hours-preferences-v1"]);

const content = await read("src/data/content.ts");
for (const room of roomIds) {
  assert(content.includes(`${room}: {`) && content.includes(`id: "${room}"`), `src/data/content.ts is missing room definition for ${room}.`);
}
for (const item of itemIds) {
  assert(content.includes(`${item}: {`) && content.includes(`id: "${item}"`), `src/data/content.ts is missing item definition for ${item}.`);
}
requireText("content.ts research links", content, ["Phaser Vite TypeScript template", "GitHub Pages custom workflows", "Kenney CC0 asset reference"]);

const mainScene = await read("src/scenes/MainScene.ts");
requireText("MainScene.ts", mainScene, [
  "showHint",
  "showMap",
  "showNotes",
  "showHelp",
  "showEnding",
  "showKeypadPuzzle",
  "showSequencePuzzle",
  "Future Phone",
  "Memory Vending",
  "The Auditor",
  "Large Text",
  "Reduced Motion"
]);
for (const ending of endingIds) {
  assert(mainScene.includes(`finish("${ending}")`) || mainScene.includes(`ending === "${ending}"`), `MainScene.ts does not reference ending ${ending}.`);
}

const audioDirector = await read("src/audio/AudioDirector.ts");
requireText("AudioDirector.ts", audioDirector, [
  "createOscillator",
  "createBuffer",
  "playPhoneClue",
  "stopPhoneClue",
  "ending",
  "setMuted",
  "setVolume"
]);

const imageFiles = await listFiles("public/assets/images", ".webp");
const oggFiles = await listFiles("public/assets/audio/ui", ".ogg");
assert(imageFiles.length >= 9, `Expected title, room, and ending images; found ${imageFiles.length} WebP files.`);
assert(oggFiles.length >= 10, `Expected UI/SFX audio files; found ${oggFiles.length} OGG files.`);

const readme = await read("README.md");
requireText("README.md", readme, [
  "Play now:",
  "static web app",
  "no backend",
  "GitHub Pages",
  "Seven playable rooms",
  "Three endings",
  "npm install",
  "npm run dev",
  "npm run build",
  "npm run release",
  "npm run smoke:live",
  "Controls",
  "Known Limitations"
]);

const designNotes = await read("DESIGN_NOTES.md");
requireText("DESIGN_NOTES.md", designNotes, [
  "Research Summary",
  "Chosen Concept",
  "Rejected Concepts",
  "Core Gameplay Loop",
  "Rooms",
  "Puzzle List",
  "Art Direction",
  "Sound Direction",
  "Technical Decisions",
  "Known Limitations",
  "Future Improvements"
]);
assert(countMarkdownListItems(designNotes, "Rooms") >= 5, "DESIGN_NOTES.md documents fewer than 5 rooms.");
assert(countMarkdownListItems(designNotes, "Puzzle List") >= 5, "DESIGN_NOTES.md documents fewer than 5 puzzles.");

const assets = await read("ASSETS.md");
requireText("ASSETS.md", assets, [
  "This project does not use ripped commercial assets",
  "Generated Visual Assets",
  "Generated UI Icons",
  "Procedural Audio",
  "External CC0 Audio",
  "Kenney",
  "https://kenney.nl/assets/ui-audio",
  "CC0",
  "Phaser 3"
]);

const notice = await read("NOTICE.md");
requireText("NOTICE.md", notice, ["not granted for reuse", "THIRD_PARTY_NOTICES.md", "Kenney CC0"]);

const thirdPartyNotices = await read("THIRD_PARTY_NOTICES.md");
requireText("THIRD_PARTY_NOTICES.md", thirdPartyNotices, [
  "Phaser 3",
  "Earcut",
  "Simplify.js",
  "Matter.js",
  "EventEmitter3",
  "Vite Runtime Helper",
  "Kenney Sound Effects",
  "MIT",
  "CC0"
]);

const progress = await read("PROGRESS.md");
requireText("PROGRESS.md", progress, [
  "Research completed",
  "Project scaffolded",
  "Puzzles implemented",
  "Audio implemented",
  "Three endings implemented",
  "Deployment prepared",
  "Documentation written"
]);

console.log(
  `Ship audit passed: ${roomIds.length} rooms, ${itemIds.length} inventory items, ${endingIds.length} endings, ${countMarkdownListItems(
    designNotes,
    "Puzzle List"
  )} documented puzzles, ${imageFiles.length} WebP images, ${oggFiles.length} OGG sounds.`
);
