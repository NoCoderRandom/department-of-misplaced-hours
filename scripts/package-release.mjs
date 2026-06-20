import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join, relative } from "node:path";
import { spawnSync } from "node:child_process";
import { deflateRawSync } from "node:zlib";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const version = packageJson.version;
if (typeof version !== "string" || version.length === 0) {
  throw new Error("package.json is missing a valid version.");
}
const releaseName = `department-of-misplaced-hours-${version}`;
const storeName = `${releaseName}-store`;
const releaseDir = "release";
const stageDir = join(releaseDir, releaseName);
const archivePath = join(releaseDir, `${releaseName}.zip`);
const shaPath = join(releaseDir, `${releaseName}.sha256`);
const tempStageDir = join(releaseDir, `.staging-${releaseName}`);
const tempArchivePath = join(releaseDir, `${releaseName}.pending.zip`);
const tempShaPath = join(releaseDir, `${releaseName}.pending.sha256`);
const storeStageDir = join(releaseDir, storeName);
const storeArchivePath = join(releaseDir, `${storeName}.zip`);
const storeShaPath = join(releaseDir, `${storeName}.sha256`);
const tempStoreStageDir = join(releaseDir, `.staging-${storeName}`);
const tempStoreArchivePath = join(releaseDir, `${storeName}.pending.zip`);
const tempStoreShaPath = join(releaseDir, `${storeName}.pending.sha256`);
const comparePathNames = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

const docs = [
  "ASSETS.md",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/ASSET_PROVENANCE.md"
];
const buildInputs = ["src", "public", "index.html", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"];
const requiredDistFiles = [
  "dist/index.html",
  "dist/favicon.svg",
  "dist/icon-192.png",
  "dist/icon-512.png",
  "dist/social-card.png",
  "dist/site.webmanifest",
  "dist/robots.txt",
  "dist/sitemap.xml",
  "dist/assets/images/title-department.webp",
  "dist/assets/images/reception.webp",
  "dist/assets/images/clock-hall.webp",
  "dist/assets/images/security-office.webp",
  "dist/assets/images/interrogation-booth.webp",
  "dist/assets/images/records-archive.webp",
  "dist/assets/images/break-room.webp",
  "dist/assets/images/mirror-server.webp",
  "dist/assets/images/ending-dawn.webp",
  "dist/assets/audio/ui/click.ogg",
  "dist/assets/audio/ui/hover.ogg",
  "dist/assets/audio/ui/pickup.ogg",
  "dist/assets/audio/ui/success.ogg",
  "dist/assets/audio/ui/fail.ogg",
  "dist/assets/audio/ui/open.ogg",
  "dist/assets/audio/ui/glitch.ogg",
  "dist/assets/audio/ui/machine.ogg",
  "dist/assets/audio/ui/metal.ogg",
  "dist/assets/audio/ui/paper.ogg",
  "dist/assets/audio/ui/drop.ogg",
  "dist/assets/audio/ui/glass.ogg",
  "dist/assets/audio/ui/stinger.ogg",
  "dist/assets/audio/ui/toggle.ogg",
  "dist/assets/audio/ui/KENNEY_DIGITAL_AUDIO_LICENSE.txt",
  "dist/assets/audio/ui/KENNEY_IMPACT_SOUNDS_LICENSE.txt",
  "dist/assets/audio/ui/KENNEY_INTERFACE_SOUNDS_LICENSE.txt",
  "dist/assets/audio/ui/KENNEY_UI_AUDIO_LICENSE.txt"
];
const releaseTextDistFiles = requiredDistFiles.filter((file) => file.endsWith(".txt"));
const forbiddenArchivePatterns = [
  /^src\//,
  /^scripts\//,
  /^public\//,
  /^tmp\//,
  /^release_backups\//,
  /^node_modules\//,
  /^docs\/QA_WALKTHROUGH\.md$/,
  /^DESIGN_NOTES\.md$/,
  /^PROGRESS\.md$/,
  /promt\.txt$/,
  /\.map$/
];

async function referencedBuildAssets() {
  const html = await readFile("dist/index.html", "utf8");
  return [
    ...new Set(
      [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+\.(?:js|css))"/g)].map((match) => `dist/assets/${match[1]}`)
    )
  ].sort(comparePathNames);
}

function assertReferencedRuntimeAssets(label, referencedAssets) {
  const entryJsFiles = referencedAssets.filter((file) => /^dist\/assets\/index-.+\.js$/.test(file));
  const vendorJsFiles = referencedAssets.filter((file) => /^dist\/assets\/phaser-.+\.js$/.test(file));
  const cssFiles = referencedAssets.filter((file) => /^dist\/assets\/index-.+\.css$/.test(file));
  if (entryJsFiles.length !== 1 || vendorJsFiles.length !== 1 || cssFiles.length !== 1) {
    throw new Error(
      `${label} expected one entry JS, one Phaser vendor JS, and one CSS asset referenced by HTML.\nReferenced:\n${referencedAssets.join("\n")}`
    );
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (options.echo) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

const crcTable = new Uint32Array(256);
for (let i = 0; i < crcTable.length; i += 1) {
  let value = i;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[i] = value >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function fixedDosDateTime() {
  return {
    time: 0,
    date: (1 << 5) | 1
  };
}

function localFileHeader(entry) {
  const header = Buffer.alloc(30);
  const { time, date } = fixedDosDateTime();
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0800, 6);
  header.writeUInt16LE(entry.method, 8);
  header.writeUInt16LE(time, 10);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.compressed.length, 18);
  header.writeUInt32LE(entry.uncompressed.length, 22);
  header.writeUInt16LE(entry.name.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralDirectoryHeader(entry) {
  const header = Buffer.alloc(46);
  const { time, date } = fixedDosDateTime();
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0800, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(time, 12);
  header.writeUInt16LE(date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressed.length, 20);
  header.writeUInt32LE(entry.uncompressed.length, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  return header;
}

function endOfCentralDirectory(entryCount, centralDirectorySize, centralDirectoryOffset) {
  const header = Buffer.alloc(22);
  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(entryCount, 8);
  header.writeUInt16LE(entryCount, 10);
  header.writeUInt32LE(centralDirectorySize, 12);
  header.writeUInt32LE(centralDirectoryOffset, 16);
  header.writeUInt16LE(0, 20);
  return header;
}

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files.sort(comparePathNames);
}

async function latestMtimeMs(path) {
  const info = await stat(path);
  if (!info.isDirectory()) {
    return info.mtimeMs;
  }
  let latest = info.mtimeMs;
  for (const filePath of await listFiles(path)) {
    latest = Math.max(latest, (await stat(filePath)).mtimeMs);
  }
  return latest;
}

async function assertDistFresh() {
  const buildStamp = await stat("dist/index.html");
  let newestInput = 0;
  let newestInputPath = "";
  for (const input of buildInputs) {
    const mtime = await latestMtimeMs(input);
    if (mtime > newestInput) {
      newestInput = mtime;
      newestInputPath = input;
    }
  }

  if (newestInput - buildStamp.mtimeMs > 1500) {
    throw new Error(
      `Production build is stale: ${newestInputPath} is newer than dist/index.html. Run npm run release so the build, QA, and packaging happen together.`
    );
  }
}

function normalizeLf(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

async function copyTextFileLf(sourcePath, destinationPath) {
  await writeFile(destinationPath, normalizeLf(await readFile(sourcePath, "utf8")));
}

async function normalizeTextFileLf(path) {
  const original = await readFile(path, "utf8");
  const normalized = normalizeLf(original);
  if (normalized !== original) {
    await writeFile(path, normalized);
  }
}

async function assertLfOnlyFiles(root, files, label) {
  const crlfFiles = [];
  for (const file of files) {
    const text = await readFile(join(root, file), "utf8");
    if (text.includes("\r")) {
      crlfFiles.push(file);
    }
  }
  if (crlfFiles.length > 0) {
    throw new Error(`${label} contains non-normalized text files:\n${crlfFiles.join("\n")}`);
  }
}

async function writeZip(sourceDir, destinationPath) {
  const localParts = [];
  const centralParts = [];
  const entries = [];
  let offset = 0;

  for (const filePath of await listFiles(sourceDir)) {
    const uncompressed = await readFile(filePath);
    const deflated = deflateRawSync(uncompressed, { level: 9 });
    const compressed = deflated.length < uncompressed.length ? deflated : uncompressed;
    const method = compressed === deflated ? 8 : 0;
    const name = Buffer.from(relative(sourceDir, filePath).replaceAll("\\", "/"), "utf8");
    if (name.length > 0xffff || uncompressed.length > 0xffffffff || compressed.length > 0xffffffff) {
      throw new Error(`Release ZIP entry is too large for standard ZIP headers: ${filePath}`);
    }

    const entry = {
      name,
      method,
      crc: crc32(uncompressed),
      compressed,
      uncompressed,
      offset
    };
    const localHeader = localFileHeader(entry);
    localParts.push(localHeader, name, compressed);
    offset += localHeader.length + name.length + compressed.length;
    entries.push(entry);
  }

  const centralDirectoryOffset = offset;
  for (const entry of entries) {
    const centralHeader = centralDirectoryHeader(entry);
    centralParts.push(centralHeader, entry.name);
    offset += centralHeader.length + entry.name.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const end = endOfCentralDirectory(entries.length, centralDirectorySize, centralDirectoryOffset);
  await writeFile(destinationPath, Buffer.concat([...localParts, ...centralParts, end]));
}

async function listZipEntries(archiveFile) {
  const archive = await readFile(archiveFile);
  let endOffset = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 0xffff - 22); i -= 1) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error("Release archive is not a readable ZIP file.");
  }

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  const listing = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Release archive central directory is malformed.");
    }
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    listing.push(archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return listing;
}

async function sha256(path) {
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolve);
  });
  return hash.digest("hex");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function assertPromotedArchive(archiveFile, shaFile, expectedHash, expectedArchiveName) {
  const actualHash = await sha256(archiveFile);
  if (actualHash !== expectedHash) {
    throw new Error(`Promoted archive checksum mismatch for ${archiveFile}. Expected ${expectedHash}, got ${actualHash}.`);
  }

  const expectedSha = `${expectedHash}  ${expectedArchiveName}\n`;
  const actualSha = await readFile(shaFile, "utf8");
  if (actualSha !== expectedSha) {
    throw new Error(`Promoted checksum file ${shaFile} does not match ${expectedArchiveName}.`);
  }
}

async function assertCleanReleaseDirectory() {
  const expectedEntries = new Map([
    [releaseName, "directory"],
    [storeName, "directory"],
    [`${releaseName}.zip`, "file"],
    [`${releaseName}.sha256`, "file"],
    [`${storeName}.zip`, "file"],
    [`${storeName}.sha256`, "file"]
  ]);
  const entries = await readdir(releaseDir, { withFileTypes: true });
  const actualNames = entries.map((entry) => entry.name).sort(comparePathNames);
  const expectedNames = [...expectedEntries.keys()].sort(comparePathNames);
  const missing = expectedNames.filter((name) => !actualNames.includes(name));
  const unexpected = actualNames.filter((name) => !expectedEntries.has(name));
  const wrongTypes = entries
    .filter((entry) => expectedEntries.has(entry.name))
    .filter((entry) => {
      const expectedType = expectedEntries.get(entry.name);
      return expectedType === "directory" ? !entry.isDirectory() : !entry.isFile();
    })
    .map((entry) => `${entry.name} expected ${expectedEntries.get(entry.name)}`);

  if (missing.length > 0 || unexpected.length > 0 || wrongTypes.length > 0) {
    throw new Error(
      `Release directory contains an unexpected artifact set.\nMissing:\n${missing.join("\n")}\nUnexpected:\n${unexpected.join("\n")}\nWrong types:\n${wrongTypes.join("\n")}`
    );
  }
}

function assertExactEntries(label, actualEntries, expectedEntries) {
  const actual = new Set(actualEntries);
  const expected = new Set(expectedEntries);
  const missing = [...expected].filter((entry) => !actual.has(entry));
  const unexpected = [...actual].filter((entry) => !expected.has(entry));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} entries did not match the exact release manifest.\nMissing:\n${missing.join("\n")}\nUnexpected:\n${unexpected.join("\n")}`
    );
  }
}

function expectedDistEntries(referencedAssets) {
  return [...requiredDistFiles, ...referencedAssets].sort(comparePathNames);
}

async function backupFinal(file) {
  if (file.directory) {
    await cp(file.final, file.backup, { recursive: true });
    await rm(file.final, { recursive: true, force: true });
    return;
  }
  await rename(file.final, file.backup);
}

async function promotePending(file) {
  if (file.directory) {
    await cp(file.pending, file.final, { recursive: true });
    await rm(file.pending, { recursive: true, force: true });
    return;
  }
  await rename(file.pending, file.final);
}

async function restoreBackup(file) {
  if (file.directory) {
    await rm(file.final, { recursive: true, force: true }).catch(() => undefined);
    await cp(file.backup, file.final, { recursive: true });
    await rm(file.backup, { recursive: true, force: true });
    return;
  }
  await rename(file.backup, file.final);
}

async function promoteReleaseFiles(files, verify) {
  const backedUp = [];
  const promoted = [];

  for (const file of files) {
    if (await pathExists(file.backup)) {
      throw new Error(`Release promotion backup already exists: ${file.backup}. Inspect it before packaging again.`);
    }
  }

  try {
    for (const file of files) {
      if (await pathExists(file.final)) {
        await backupFinal(file);
        backedUp.push(file);
      }
    }

    for (const file of files) {
      await promotePending(file);
      promoted.push(file);
    }

    await verify();

    const cleanupErrors = [];
    for (const file of backedUp) {
      await rm(file.backup, { recursive: true, force: true }).catch((cleanupError) => {
        cleanupErrors.push(`${file.backup}: ${cleanupError?.message ?? cleanupError}`);
      });
    }
    if (cleanupErrors.length > 0) {
      console.warn(`Release promotion succeeded, but backup cleanup needs manual attention:\n${cleanupErrors.join("\n")}`);
    }
  } catch (error) {
    for (const file of promoted.reverse()) {
      await rm(file.final, { recursive: true, force: true }).catch(() => undefined);
    }

    const restoreErrors = [];
    for (const file of backedUp.reverse()) {
      try {
        await restoreBackup(file);
      } catch (restoreError) {
        restoreErrors.push(`${file.backup} -> ${file.final}: ${restoreError?.message ?? restoreError}`);
      }
    }

    const restoreNote =
      restoreErrors.length > 0
        ? `Rollback failed for:\n${restoreErrors.join("\n")}`
        : "Previous final release files were restored.";
    throw new Error(`Release promotion failed. ${restoreNote}\n${error?.stack ?? error?.message ?? error}`);
  }
}

run(process.execPath, ["scripts/check-release.mjs"]);
await assertDistFresh();

await mkdir(releaseDir, { recursive: true });
await rm(tempStageDir, { recursive: true, force: true });
await rm(tempArchivePath, { force: true });
await rm(tempShaPath, { force: true });
await rm(tempStoreStageDir, { recursive: true, force: true });
await rm(tempStoreArchivePath, { force: true });
await rm(tempStoreShaPath, { force: true });
await mkdir(tempStageDir, { recursive: true });
await mkdir(join(tempStageDir, "docs"), { recursive: true });
await cp("dist", join(tempStageDir, "dist"), { recursive: true });
for (const file of releaseTextDistFiles) {
  await normalizeTextFileLf(join(tempStageDir, file));
}

for (const doc of docs) {
  await copyTextFileLf(doc, join(tempStageDir, doc));
}

await writeFile(
  join(tempStageDir, "README.md"),
  [
    "# The Department of Misplaced Hours",
    "",
    "This is the release archive for the static browser game.",
    "",
    `Version: ${version}`,
    `Archive: \`${releaseName}.zip\``,
    `Paired checksum: \`${releaseName}.sha256\``,
    "",
    "## Play",
    "",
    "Serve the `dist/` folder as the web root with any static web server, then open the served URL in a desktop browser. Do not upload the outer ZIP folder as the web root; upload or serve the contents of `dist/`.",
    "Do not double-click `dist/index.html` from `file://`; browsers can block module and asset loading outside a static server.",
    "",
    `The build has no backend. GitHub Pages, Netlify, and similar static hosts are suitable. For itch.io or stores that expect \`index.html\` at the archive root, upload the separate \`${storeName}.zip\` artifact.`,
    "",
    "## Controls",
    "",
    "- Move the cursor around the room. It changes to a hand and the status line names usable objects.",
    "- On touch screens, first tap names a room object and second tap activates it; the preview clears after a short pause, and selected inventory still uses immediately.",
    "- Portrait phones show a Rotate Device prompt so dense clues, buttons, and files stay readable in landscape.",
    "- Click inventory items at the bottom, then click room objects to try using them.",
    "- Press Escape, right-click, or press controller B to close ordinary panels or put away a selected inventory item.",
    "- Ordered-choice puzzles include Undo; Backspace and Delete remove the last entry while the panel is focused.",
    "- Keyboard focus: Tab / Shift+Tab cycles title actions, ending actions, room objects, and inventory when those targets are present; Enter / Space activates the focused target.",
    "- Screen readers receive hidden live status updates when keyboard focus moves between room objects, inventory, title actions, and ending actions.",
    "- Controller mode: D-pad or left stick cycles title actions, ending actions, room objects, inventory, and modal buttons; A selects; B cancels selected items or closes ordinary panels; the required Clock In orientation waits for its button; Back/View opens Map, X opens Notes, Y opens Hint, Start/Menu opens Help, and bumpers adjust volume.",
    "- Use Map, Notes, Hint, Help, Sound, - and + from the top bar.",
    "- Help includes Large Text for bigger dialogue, document, and puzzle panels, Reduced Motion for static atmosphere, Recover Position for save repair, and Reset Shift behind a confirmation prompt. Browser/OS reduced-motion settings are honored on first launch.",
    "- Credits are available from the title screen, Help, and ending screen, with source-document buttons for asset and license details.",
    "- Keyboard shortcuts: M Map, N Notes, H Hint, F1 Help, S Sound, [ and ] volume.",
    "- Progress saves in browser localStorage when available. Audio, Large Text, and Reduced Motion preferences survive Reset Shift.",
    "- If browser storage is blocked, the game warns that the current session is playable but progress will not survive closing or reloading the page.",
    "",
    "## Release Contents",
    "",
    "- `dist/` - verified production game build.",
    "- `PLAY.txt` - short launch note.",
    "- `ASSETS.md`, `NOTICE.md`, `THIRD_PARTY_NOTICES.md` - asset and license documentation.",
    "- `docs/ASSET_PROVENANCE.md` - release image provenance record.",
    "",
    "## Verification",
    "",
    "This archive was produced by the release packager, which validates archive contents, smoke-tests pending archives in a browser, including controller-B Clock-In gating and right-click panel-close checks, promotes artifacts transactionally, and verifies final checksums. The normal `npm run release` command runs TypeScript checks, a production build, automated browser QA, and visual readability QA before packaging.",
    "",
    `Before distributing, verify \`${releaseName}.zip\` against the paired \`${releaseName}.sha256\` file in the generated release folder.`,
    `On macOS/Linux, run \`sha256sum -c ${releaseName}.sha256\`. On Windows PowerShell, run \`(Get-FileHash ${releaseName}.zip -Algorithm SHA256).Hash\` and compare it with the hash at the start of \`${releaseName}.sha256\`.`
  ].join("\n")
);

const stagedReadme = await readFile(join(tempStageDir, "README.md"), "utf8");
for (const required of [
  "B cancels selected items or closes ordinary panels",
  "the required Clock In orientation waits for its button",
  "Press Escape, right-click, or press controller B to close ordinary panels or put away a selected inventory item",
  "Do not double-click `dist/index.html` from `file://`",
  "On touch screens, first tap names a room object and second tap activates it; the preview clears after a short pause",
  "Portrait phones show a Rotate Device prompt",
  "Screen readers receive hidden live status updates when keyboard focus moves between room objects, inventory, title actions, and ending actions",
  "Keyboard focus: Tab / Shift+Tab cycles title actions, ending actions, room objects, and inventory",
  "D-pad or left stick cycles title actions, ending actions, room objects, inventory, and modal buttons",
  "Back/View opens Map, X opens Notes, Y opens Hint, Start/Menu opens Help, and bumpers adjust volume",
  "Ordered-choice puzzles include Undo",
  "controller-B Clock-In gating",
  "right-click panel-close checks",
  "Credits are available from the title screen, Help, and ending screen, with source-document buttons",
  "Keyboard shortcuts: M Map, N Notes, H Hint, F1 Help, S Sound, [ and ] volume",
  `Version: ${version}`,
  `Archive: \`${releaseName}.zip\``,
  `Paired checksum: \`${releaseName}.sha256\``,
  `sha256sum -c ${releaseName}.sha256`,
  `Get-FileHash ${releaseName}.zip -Algorithm SHA256`
]) {
  if (!stagedReadme.includes(required)) {
    throw new Error(`Generated release README is missing required controls text: ${required}`);
  }
}

await writeFile(
  join(tempStageDir, "PLAY.txt"),
  [
    "The Department of Misplaced Hours",
    "",
    `Version: ${version}`,
    `Archive: ${releaseName}.zip`,
    `Paired checksum: ${releaseName}.sha256`,
    "",
    "Serve the dist folder as a static web root, then open the served URL in a desktop browser.",
    "Do not double-click dist/index.html from file://; browsers can block module and asset loading outside a static server.",
    "Deploying the dist folder to GitHub Pages, Netlify, or similar static hosting is supported.",
    "For itch.io or stores that expect index.html at the ZIP root, upload the separate store ZIP instead.",
    "Before distributing, verify the ZIP against the paired .sha256 file in the generated release folder.",
    "",
    "This release archive intentionally contains the built game and release documentation only."
  ].join("\n")
);
await assertLfOnlyFiles(
  tempStageDir,
  [...releaseTextDistFiles, "README.md", "PLAY.txt", "ASSETS.md", "NOTICE.md", "THIRD_PARTY_NOTICES.md", "docs/ASSET_PROVENANCE.md"],
  "Standard release staging"
);

await writeZip(tempStageDir, tempArchivePath);
const listing = (await listZipEntries(tempArchivePath)).map((entry) => entry.trim().replaceAll("\\", "/")).filter(Boolean);

if (!listing.includes("dist/index.html")) {
  throw new Error("Release archive is missing dist/index.html.");
}
const referencedAssets = await referencedBuildAssets();
assertReferencedRuntimeAssets("Release archive", referencedAssets);
const expectedStandardEntries = [
  ...expectedDistEntries(referencedAssets),
  "README.md",
  "PLAY.txt",
  "ASSETS.md",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/ASSET_PROVENANCE.md"
];
assertExactEntries("Release archive", listing, expectedStandardEntries);
const missingReferencedAssets = referencedAssets.filter((file) => !listing.includes(file));
if (missingReferencedAssets.length > 0) {
  throw new Error(
    `Release archive does not contain the exact JS/CSS assets referenced by dist/index.html.\nReferenced:\n${referencedAssets.join("\n")}\nMissing:\n${missingReferencedAssets.join("\n")}`
  );
}
if (
  !listing.includes("README.md") ||
  !listing.includes("PLAY.txt") ||
  !listing.includes("NOTICE.md") ||
  !listing.includes("ASSETS.md") ||
  !listing.includes("THIRD_PARTY_NOTICES.md")
) {
  throw new Error("Release archive is missing required release documentation.");
}
const forbidden = listing.filter((entry) => forbiddenArchivePatterns.some((pattern) => pattern.test(entry)));
if (forbidden.length > 0) {
  throw new Error(`Release archive contains forbidden files:\n${forbidden.join("\n")}`);
}

const hash = await sha256(tempArchivePath);
await writeFile(tempShaPath, `${hash}  ${releaseName}.zip\n`);

await cp("dist", tempStoreStageDir, { recursive: true });
for (const file of releaseTextDistFiles) {
  await normalizeTextFileLf(join(tempStoreStageDir, file.replace(/^dist\//, "")));
}
await mkdir(join(tempStoreStageDir, "legal"), { recursive: true });
for (const doc of docs) {
  await copyTextFileLf(doc, join(tempStoreStageDir, "legal", doc.replace(/^docs\//, "")));
}
await writeFile(
  join(tempStoreStageDir, "README.txt"),
  [
    "The Department of Misplaced Hours",
    "",
    "This is the store-ready static HTML build. Upload this ZIP directly to itch.io or another HTML game host that expects index.html at the archive root.",
    "",
    `Version: ${version}`,
    `Archive: ${storeName}.zip`,
    `Paired checksum: ${storeName}.sha256`,
    "",
    "Serve the extracted folder or upload this ZIP through a static web host. The build has no backend, and browser localStorage stores progress and preferences.",
    "For local testing, serve the extracted folder instead of double-clicking index.html from file://; browsers can block module and asset loading from local files.",
    "Before uploading to a store or host, verify this ZIP against the paired .sha256 file in the generated release folder.",
    "",
    "Basic controls:",
    "- Move the cursor around the room. It changes to a hand and the status line names usable objects.",
    "- On touch screens, first tap names a room object and second tap activates it; the preview clears after a short pause, and selected inventory still uses immediately.",
    "- Click inventory items at the bottom, then click room objects to try using them.",
    "- Press Escape, right-click, or press controller B to close ordinary panels or put away a selected inventory item.",
    "- Ordered-choice puzzles include Undo; Backspace and Delete remove the last entry while the panel is focused.",
    "- Keyboard focus: Tab / Shift+Tab cycles title actions, ending actions, room objects, and inventory when those targets are present; Enter / Space activates the focused target.",
    "- Screen readers receive hidden live status updates when keyboard focus moves between room objects, inventory, title actions, and ending actions.",
    "- Controller mode: D-pad or left stick cycles title actions, ending actions, room objects, inventory, and modal buttons; A selects; B cancels selected items or closes ordinary panels; the required Clock In orientation waits for its button; Back/View opens Map, X opens Notes, Y opens Hint, Start/Menu opens Help, and bumpers adjust volume.",
    "- Keyboard shortcuts: M Map, N Notes, H Hint, F1 Help, S Sound, [ and ] volume.",
    "- Help includes Large Text, Reduced Motion, Recover Position, and Reset Shift.",
    "- Progress saves in browser localStorage when available. Audio, Large Text, and Reduced Motion preferences survive Reset Shift.",
    "- If browser storage is blocked, the game warns that the current session is playable but progress will not survive closing or reloading the page.",
    "",
    "Portrait phones show a Rotate Device prompt so dense clues, buttons, and files stay readable in landscape.",
    "",
    "Credits are available from the title screen, Help, and ending screen. In-game Credits buttons open the source repository docs; bundled legal and asset provenance files are in the legal/ folder."
  ].join("\n")
);
const stagedStoreReadme = await readFile(join(tempStoreStageDir, "README.txt"), "utf8");
for (const required of [
  "Portrait phones show a Rotate Device prompt",
  "Move the cursor around the room. It changes to a hand",
  "On touch screens, first tap names a room object and second tap activates it; the preview clears after a short pause",
  "Press Escape, right-click, or press controller B to close ordinary panels or put away a selected inventory item",
  "Ordered-choice puzzles include Undo",
  "Keyboard focus: Tab / Shift+Tab cycles title actions, ending actions, room objects, and inventory",
  "Screen readers receive hidden live status updates when keyboard focus moves between room objects, inventory, title actions, and ending actions",
  "D-pad or left stick cycles title actions, ending actions, room objects, inventory, and modal buttons",
  "Back/View opens Map, X opens Notes, Y opens Hint, Start/Menu opens Help, and bumpers adjust volume",
  "Keyboard shortcuts: M Map, N Notes, H Hint, F1 Help, S Sound, [ and ] volume",
  "Help includes Large Text, Reduced Motion, Recover Position, and Reset Shift",
  "Progress saves in browser localStorage when available",
  "If browser storage is blocked",
  "Credits are available from the title screen, Help, and ending screen",
  "source repository docs",
  "legal/ folder",
  "serve the extracted folder instead of double-clicking index.html from file://",
  `Version: ${version}`,
  `Archive: ${storeName}.zip`,
  `Paired checksum: ${storeName}.sha256`,
  "verify this ZIP against the paired .sha256 file"
]) {
  if (!stagedStoreReadme.includes(required)) {
    throw new Error(`Generated store README is missing required release text: ${required}`);
  }
}
await writeFile(
  join(tempStoreStageDir, "PLAY.txt"),
  [
    "The Department of Misplaced Hours",
    "",
    `Version: ${version}`,
    `Archive: ${storeName}.zip`,
    `Paired checksum: ${storeName}.sha256`,
    "",
    "Upload this ZIP as an HTML/static web game, or serve this folder as a static web root.",
    "The playable entry point is index.html at the archive root.",
    "For local testing, use a static server instead of file:// double-click launch.",
    "Before uploading, verify the ZIP against the paired .sha256 file in the generated release folder."
  ].join("\n")
);
await assertLfOnlyFiles(
  tempStoreStageDir,
  [
    ...releaseTextDistFiles.map((file) => file.replace(/^dist\//, "")),
    "README.txt",
    "PLAY.txt",
    "legal/ASSETS.md",
    "legal/NOTICE.md",
    "legal/THIRD_PARTY_NOTICES.md",
    "legal/ASSET_PROVENANCE.md"
  ],
  "Store release staging"
);
await writeZip(tempStoreStageDir, tempStoreArchivePath);
const storeListing = (await listZipEntries(tempStoreArchivePath)).map((entry) => entry.trim().replaceAll("\\", "/")).filter(Boolean);
const expectedStoreEntries = [
  ...expectedDistEntries(referencedAssets).map((file) => file.replace(/^dist\//, "")),
  "README.txt",
  "PLAY.txt",
  "legal/ASSETS.md",
  "legal/NOTICE.md",
  "legal/THIRD_PARTY_NOTICES.md",
  "legal/ASSET_PROVENANCE.md"
];
assertExactEntries("Store archive", storeListing, expectedStoreEntries);
if (!storeListing.includes("index.html")) {
  throw new Error("Store archive is missing root index.html.");
}
const missingStoreReferencedAssets = referencedAssets
  .map((file) => file.replace(/^dist\//, ""))
  .filter((file) => !storeListing.includes(file));
if (missingStoreReferencedAssets.length > 0) {
  throw new Error(
    `Store archive does not contain the exact JS/CSS assets referenced by root index.html.\nReferenced:\n${referencedAssets
      .map((file) => file.replace(/^dist\//, ""))
      .join("\n")}\nMissing:\n${missingStoreReferencedAssets.join("\n")}`
  );
}
if (
  !storeListing.includes("legal/NOTICE.md") ||
  !storeListing.includes("legal/ASSETS.md") ||
  !storeListing.includes("legal/THIRD_PARTY_NOTICES.md") ||
  !storeListing.includes("legal/ASSET_PROVENANCE.md")
) {
  throw new Error("Store archive is missing required legal/provenance files.");
}
const storeForbidden = storeListing.filter((entry) => forbiddenArchivePatterns.some((pattern) => pattern.test(entry)));
if (storeForbidden.length > 0) {
  throw new Error(`Store archive contains forbidden files:\n${storeForbidden.join("\n")}`);
}
const storeHash = await sha256(tempStoreArchivePath);
await writeFile(tempStoreShaPath, `${storeHash}  ${storeName}.zip\n`);

try {
  run(
    process.execPath,
    [
      "scripts/smoke-release-archives.mjs",
      `--standard-archive=${tempArchivePath}`,
      `--standard-sha=${tempShaPath}`,
      `--store-archive=${tempStoreArchivePath}`,
      `--store-sha=${tempStoreShaPath}`
    ],
    { echo: true }
  );

  await promoteReleaseFiles(
    [
      { pending: tempStageDir, final: stageDir, backup: join(releaseDir, `.previous-${releaseName}`), directory: true },
      { pending: tempStoreStageDir, final: storeStageDir, backup: join(releaseDir, `.previous-${storeName}`), directory: true },
      { pending: tempArchivePath, final: archivePath, backup: join(releaseDir, `.${releaseName}.previous.zip`) },
      { pending: tempShaPath, final: shaPath, backup: join(releaseDir, `.${releaseName}.previous.sha256`) },
      { pending: tempStoreArchivePath, final: storeArchivePath, backup: join(releaseDir, `.${storeName}.previous.zip`) },
      { pending: tempStoreShaPath, final: storeShaPath, backup: join(releaseDir, `.${storeName}.previous.sha256`) }
    ],
    async () => {
      await assertPromotedArchive(archivePath, shaPath, hash, `${releaseName}.zip`);
      await assertPromotedArchive(storeArchivePath, storeShaPath, storeHash, `${storeName}.zip`);
    }
  );
} finally {
  await rm(tempStageDir, { recursive: true, force: true });
  await rm(tempStoreStageDir, { recursive: true, force: true });
  await rm(tempArchivePath, { force: true });
  await rm(tempShaPath, { force: true });
  await rm(tempStoreArchivePath, { force: true });
  await rm(tempStoreShaPath, { force: true });
}

await assertCleanReleaseDirectory();

console.log(`Packaged ${archivePath}`);
console.log(`SHA-256 ${hash}`);
console.log(`Packaged ${storeArchivePath}`);
console.log(`SHA-256 ${storeHash}`);
