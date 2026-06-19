import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";

const SAVE_KEY = "department-misplaced-hours-save-v1";
const PREFERENCES_KEY = "department-misplaced-hours-preferences-v1";
const OUT_DIR = resolve("tmp", "state-tests");
const OUT_FILE = resolve(OUT_DIR, `GameState.${Date.now()}.mjs`);

function createStorage({ throwOnWrite = false } = {}) {
  const data = new Map();
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      if (throwOnWrite) {
        throw new Error("storage disabled");
      }
      data.set(key, String(value));
    },
    removeItem(key) {
      if (throwOnWrite) {
        throw new Error("storage disabled");
      }
      data.delete(key);
    },
    clear() {
      data.clear();
    },
    dump() {
      return Object.fromEntries(data);
    }
  };
}

function installWindow(storage, reducedMotion = false) {
  globalThis.window = {
    localStorage: storage,
    matchMedia: () => ({ matches: reducedMotion })
  };
}

async function loadGameState() {
  const source = await readFile("src/state/GameState.ts", "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      useDefineForClassFields: true
    },
    fileName: "GameState.ts"
  }).outputText;
  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(OUT_FILE, output);
  return import(`file:///${OUT_FILE.replaceAll("\\", "/")}`);
}

function stored(storage, key) {
  const raw = storage.getItem(key);
  return raw ? JSON.parse(raw) : undefined;
}

function seed(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

const { GameState } = await loadGameState();

{
  const storage = createStorage();
  installWindow(storage);
  assert.equal(GameState.hasSave(), false, "hasSave starts false");
  seed(storage, SAVE_KEY, {
    room: "break",
    inventory: ["visitorBadge"],
    flags: { introSeen: true },
    audioVolume: 0.4,
    muted: true,
    largeText: true,
    reducedMotion: true
  });
  assert.equal(GameState.hasSave(), true, "hasSave sees stored progress");
}

{
  const storage = createStorage();
  installWindow(storage);
  seed(storage, SAVE_KEY, {
    room: "not-a-room",
    inventory: ["visitorBadge", "serverFuse", "bogus-item", "mirrorShard"],
    flags: {
      serverSolved: true,
      bogusBoolean: "yes",
      identityVerifiedByWarrant: true
    },
    ending: "not-an-ending",
    audioVolume: 5,
    muted: "yes",
    largeText: "true",
    reducedMotion: "false"
  });
  const state = new GameState();
  assert.equal(state.load(), true, "load accepts parseable malformed save");
  assert.equal(state.room, "reception", "invalid room repairs to reception");
  assert.equal(state.ending, undefined, "invalid ending is discarded");
  assert.equal(state.audioVolume, 1, "volume clamps from legacy save");
  assert.equal(state.muted, false, "non-boolean muted falls back");
  assert.equal(state.largeText, false, "non-boolean largeText falls back");
  assert.equal(state.reducedMotion, false, "non-boolean reducedMotion falls back");
  assert.equal(state.flags.bogusBoolean, undefined, "non-boolean flags are removed");
  for (const flag of ["clockUnlocked", "clockSolved", "evidenceSafeOpened", "serverSolved", "fuseInstalled", "identityVerified", "hourVerified", "mirrorClueSeen"]) {
    assert.equal(state.flags[flag], true, `repair restores ${flag}`);
  }
  for (const item of ["stampedForm", "auditWarrant", "misfiledFolder", "selfFile", "memoryCup"]) {
    assert.equal(state.inventory.has(item), true, `repair restores ${item}`);
  }
  assert.equal(state.inventory.has("serverFuse"), false, "installed fuse is removed from inventory");
  assert.equal(state.inventory.has("mirrorShard"), false, "installed shard is removed from inventory");
}

{
  const storage = createStorage();
  installWindow(storage);
  seed(storage, SAVE_KEY, {
    room: "archive",
    inventory: ["visitorBadge"],
    flags: { introSeen: true },
    audioVolume: 0.1,
    muted: false,
    largeText: false,
    reducedMotion: false
  });
  seed(storage, PREFERENCES_KEY, {
    audioVolume: 0.9,
    muted: true,
    largeText: true,
    reducedMotion: true
  });
  const state = new GameState();
  assert.equal(state.load(), true, "load succeeds with separate preferences");
  assert.equal(state.audioVolume, 0.9, "preferences override save volume");
  assert.equal(state.muted, true, "preferences override save mute");
  assert.equal(state.largeText, true, "preferences override save largeText");
  assert.equal(state.reducedMotion, true, "preferences override save reducedMotion");
}

{
  const storage = createStorage();
  installWindow(storage);
  const state = new GameState();
  state.room = "mirror";
  state.add("memoryCup");
  state.setFlag("serverSolved");
  state.audioVolume = 0.33;
  state.muted = true;
  state.largeText = true;
  state.reducedMotion = true;
  state.save();
  state.reset();
  assert.equal(storage.getItem(SAVE_KEY), null, "reset clears progress save");
  assert.equal(state.room, "reception", "reset returns to reception");
  assert.deepEqual([...state.inventory], [], "reset clears inventory");
  assert.deepEqual(state.flags, {}, "reset clears flags");
  assert.equal(state.audioVolume, 0.33, "reset preserves volume");
  assert.equal(state.muted, true, "reset preserves mute");
  assert.equal(state.largeText, true, "reset preserves largeText");
  assert.equal(state.reducedMotion, true, "reset preserves reducedMotion");
  assert.deepEqual(stored(storage, PREFERENCES_KEY), {
    audioVolume: 0.33,
    muted: true,
    largeText: true,
    reducedMotion: true
  });
}

{
  const storage = createStorage({ throwOnWrite: true });
  installWindow(storage);
  const state = new GameState();
  state.add("visitorBadge");
  state.save();
  assert.equal(state.storageUnavailable(), true, "failed save marks storage unavailable");
  state.reset();
  assert.equal(state.storageUnavailable(), true, "failed reset keeps storage unavailable warning");
}

await rm(OUT_FILE, { force: true });
console.log("State tests passed: save/load normalization, repair invariants, reset preferences, and storage failure handling.");
