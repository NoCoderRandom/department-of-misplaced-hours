import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const distDir = "dist";
const maxDistBytes = 5 * 1024 * 1024;
const maxEntryJsBytes = 200 * 1024;
const maxPhaserVendorBytes = 1400 * 1024;
const maxRuntimeHelperBytes = 10 * 1024;
const maxCssBytes = 32 * 1024;
const forbiddenDistExtensions = [".map"];
const forbiddenPackagePrefixes = ["public/", "release/", "release_backups/", "scripts/", "src/", "tmp/"];
const forbiddenPackageNames = ["promt.txt", "DESIGN_NOTES.md", "PROGRESS.md", "docs/QA_WALKTHROUGH.md"];
const requiredPackageFiles = [
  "dist/index.html",
  "dist/favicon.svg",
  "dist/icon-192.png",
  "dist/icon-512.png",
  "dist/social-card.png",
  "dist/site.webmanifest",
  "dist/assets/images/title-department.webp"
];
const requiredReleaseDocs = [
  "ASSETS.md",
  "NOTICE.md",
  "THIRD_PARTY_NOTICES.md",
  "docs/ASSET_PROVENANCE.md"
];
const requiredThirdPartyNoticeTerms = [
  "Phaser 3",
  "Earcut",
  "Simplify.js",
  "Matter.js",
  "EventEmitter3",
  "Vite Runtime Helper",
  "Kenney Sound Effects"
];
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

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path)));
    } else {
      files.push(path.replaceAll("\\", "/"));
    }
  }
  return files;
}

function runNpmPackDryRun() {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const args = npmExecPath
    ? [npmExecPath, "pack", "--dry-run", "--json"]
    : process.platform === "win32"
      ? ["/d", "/s", "/c", "npm", "pack", "--dry-run", "--json"]
      : ["pack", "--dry-run", "--json"];
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`npm pack dry run failed:\n${result.error?.message ?? ""}\n${result.stdout ?? ""}\n${result.stderr ?? ""}`);
  }
  return JSON.parse(result.stdout)[0].files.map((file) => file.path.replaceAll("\\", "/"));
}

async function referencedBuildAssets() {
  const html = await readFile("dist/index.html", "utf8");
  return [
    ...new Set(
      [...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+\.(?:js|css))"/g)].map((match) => `dist/assets/${match[1]}`)
    )
  ].sort();
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function assertAssetBudget(label, path, maxBytes) {
  const info = await stat(path);
  if (info.size > maxBytes) {
    throw new Error(
      `Release check failed: ${label} ${path} is ${(info.size / 1024).toFixed(1)} KB, above ${(maxBytes / 1024).toFixed(1)} KB budget.`
    );
  }
}

async function assertStaticSiteMetadata() {
  const html = await readFile("dist/index.html", "utf8");
  const normalizedHtml = html.replace(/\s+/g, " ");
  for (const required of [
    'rel="canonical"',
    'rel="apple-touch-icon"',
    'rel="manifest"',
    'http-equiv="Content-Security-Policy"',
    "default-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "img-src 'self' data: blob:",
    "form-action 'none'",
    'name="referrer" content="no-referrer"',
    'property="og:title"',
    'property="og:image"',
    'property="og:image:type" content="image/png"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'property="og:image:alt"',
    'name="twitter:card"',
    'name="twitter:image:alt"',
    'id="game-accessibility-summary"',
    'id="game-live-status"',
    'id="orientation-gate"',
    "Interactive point-and-click mystery game canvas",
    "Tab and Shift+Tab",
    "Arrow keys move between modal buttons",
    "Escape closes panels or puts away a selected inventory item",
    "F1 opens Help",
    "[ / ] adjust volume",
    "Rotate Device",
    "Landscape mode keeps the files, buttons, and clues readable.",
    "needs JavaScript enabled",
    "static web game",
    "does not require a backend server",
    "The Department of Misplaced Hours"
  ]) {
    if (!html.includes(required) && !normalizedHtml.includes(required)) {
      throw new Error(`Release check failed: dist/index.html is missing metadata marker ${required}.`);
    }
  }
  if (/localhost|127\.0\.0\.1|ws:\/\//.test(html)) {
    throw new Error("Release check failed: production CSP still exposes localhost or websocket development endpoints.");
  }
  for (const socialImageUrl of [
    "https://nocoderrandom.github.io/department-of-misplaced-hours/social-card.png",
    "content=\"https://nocoderrandom.github.io/department-of-misplaced-hours/social-card.png\""
  ]) {
    if (!html.includes(socialImageUrl)) {
      throw new Error(`Release check failed: social metadata is missing ${socialImageUrl}.`);
    }
  }

  const manifest = JSON.parse(await readFile("dist/site.webmanifest", "utf8"));
  const requiredManifest = {
    name: "The Department of Misplaced Hours",
    short_name: "Misplaced Hours",
    description: "A surreal point-and-click mystery puzzle game for static web hosting.",
    start_url: "./",
    scope: "./",
    display: "fullscreen",
    orientation: "landscape",
    background_color: "#080a08",
    theme_color: "#10170f"
  };
  for (const [key, value] of Object.entries(requiredManifest)) {
    if (manifest[key] !== value) {
      throw new Error(`Release check failed: site.webmanifest ${key} expected ${value}, got ${manifest[key]}.`);
    }
  }
  if (
    !Array.isArray(manifest.categories) ||
    !manifest.categories.includes("games") ||
    !manifest.categories.includes("entertainment")
  ) {
    throw new Error(`Release check failed: site.webmanifest categories are incomplete: ${JSON.stringify(manifest.categories)}.`);
  }
  if (
    !Array.isArray(manifest.icons) ||
    !manifest.icons.some((icon) => icon.src === "./favicon.svg" && icon.type === "image/svg+xml" && icon.purpose === "any")
  ) {
    throw new Error("Release check failed: site.webmanifest is missing the SVG favicon icon.");
  }
  for (const expectedIcon of [
    { src: "./icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
    { src: "./icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" }
  ]) {
    if (
      !manifest.icons.some(
        (icon) =>
          icon.src === expectedIcon.src &&
          icon.sizes === expectedIcon.sizes &&
          icon.type === expectedIcon.type &&
          icon.purpose === expectedIcon.purpose
      )
    ) {
      throw new Error(`Release check failed: site.webmanifest is missing app icon ${expectedIcon.src}.`);
    }
  }

  const robots = await readFile("dist/robots.txt", "utf8");
  if (
    !robots.includes("User-agent: *") ||
    !robots.includes("Allow: /") ||
    !robots.includes("https://nocoderrandom.github.io/department-of-misplaced-hours/sitemap.xml")
  ) {
    throw new Error("Release check failed: robots.txt is missing crawler or sitemap directives.");
  }

  const sitemap = await readFile("dist/sitemap.xml", "utf8");
  if (!sitemap.includes("<urlset") || !sitemap.includes("https://nocoderrandom.github.io/department-of-misplaced-hours/")) {
    throw new Error("Release check failed: sitemap.xml is missing the public game URL.");
  }
}

async function assertImageProvenance() {
  const provenance = await readFile("docs/ASSET_PROVENANCE.md", "utf8");
  const rows = [...provenance.matchAll(/^\| `([^`]+\.webp)` \| \d+ \| `[a-f0-9]{64}` \| (\d+) \| `([a-f0-9]{64})` \|$/gm)];
  const records = new Map(rows.map((row) => [row[1], { bytes: Number(row[2]), hash: row[3] }]));
  const expectedImages = requiredDistFiles
    .filter((file) => file.startsWith("dist/assets/images/") && file.endsWith(".webp"))
    .map((file) => file.slice("dist/assets/images/".length))
    .sort();
  const documentedImages = [...records.keys()].sort();
  const missing = expectedImages.filter((name) => !records.has(name));
  const unexpected = documentedImages.filter((name) => !expectedImages.includes(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Release check failed: image provenance table does not match shipped images.\nMissing:\n${missing.join("\n")}\nUnexpected:\n${unexpected.join("\n")}`
    );
  }

  const failures = [];
  for (const image of expectedImages) {
    const record = records.get(image);
    const publicPath = `public/assets/images/${image}`;
    const distPath = `dist/assets/images/${image}`;
    const [publicStat, distStat, publicHash, distHash] = await Promise.all([
      stat(publicPath),
      stat(distPath),
      sha256(publicPath),
      sha256(distPath)
    ]);
    if (publicStat.size !== record.bytes) {
      failures.push(`${publicPath} size expected ${record.bytes}, got ${publicStat.size}`);
    }
    if (distStat.size !== record.bytes) {
      failures.push(`${distPath} size expected ${record.bytes}, got ${distStat.size}`);
    }
    if (publicHash !== record.hash) {
      failures.push(`${publicPath} hash expected ${record.hash}, got ${publicHash}`);
    }
    if (distHash !== record.hash) {
      failures.push(`${distPath} hash expected ${record.hash}, got ${distHash}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(`Release check failed: image provenance hashes are stale.\n${failures.join("\n")}`);
  }
}

const distFiles = await listFiles(distDir);
const missingDocs = [];
for (const doc of requiredReleaseDocs) {
  try {
    await access(doc);
  } catch {
    missingDocs.push(doc);
  }
}
if (missingDocs.length > 0) {
  throw new Error(`Release check failed: required release docs missing:\n${missingDocs.join("\n")}`);
}
const thirdPartyNotices = await readFile("THIRD_PARTY_NOTICES.md", "utf8");
const missingNoticeTerms = requiredThirdPartyNoticeTerms.filter((term) => !thirdPartyNotices.includes(term));
if (missingNoticeTerms.length > 0) {
  throw new Error(`Release check failed: THIRD_PARTY_NOTICES.md is missing shipped-runtime notices:\n${missingNoticeTerms.join("\n")}`);
}

if (!distFiles.includes("dist/index.html")) {
  throw new Error("Release check failed: dist/index.html is missing.");
}

const missingDistFiles = requiredDistFiles.filter((file) => !distFiles.includes(file));
if (missingDistFiles.length > 0) {
  throw new Error(`Release check failed: required dist files missing:\n${missingDistFiles.join("\n")}`);
}

const referencedAssets = await referencedBuildAssets();
const missingReferencedAssets = referencedAssets.filter((file) => !distFiles.includes(file));
const entryJsFiles = referencedAssets.filter((file) => /^dist\/assets\/index-.+\.js$/.test(file));
const vendorJsFiles = referencedAssets.filter((file) => /^dist\/assets\/phaser-.+\.js$/.test(file));
const cssFiles = referencedAssets.filter((file) => /^dist\/assets\/index-.+\.css$/.test(file));
const runtimeHelperFiles = referencedAssets.filter(
  (file) => file.endsWith(".js") && !entryJsFiles.includes(file) && !vendorJsFiles.includes(file)
);
if (entryJsFiles.length !== 1 || vendorJsFiles.length !== 1 || cssFiles.length !== 1) {
  throw new Error(
    `Release check failed: expected one entry JS, one Phaser vendor JS, and one CSS asset referenced by dist/index.html.\nReferenced:\n${referencedAssets.join("\n")}`
  );
}
if (missingReferencedAssets.length > 0) {
  throw new Error(
    `Release check failed: dist/index.html does not reference the current built JS/CSS assets.\nReferenced:\n${referencedAssets.join("\n")}\nMissing:\n${missingReferencedAssets.join("\n")}`
  );
}
await assertAssetBudget("entry JavaScript", entryJsFiles[0], maxEntryJsBytes);
await assertAssetBudget("Phaser vendor JavaScript", vendorJsFiles[0], maxPhaserVendorBytes);
await assertAssetBudget("entry CSS", cssFiles[0], maxCssBytes);
for (const runtimeHelper of runtimeHelperFiles) {
  await assertAssetBudget("runtime helper JavaScript", runtimeHelper, maxRuntimeHelperBytes);
}
await assertStaticSiteMetadata();
await assertImageProvenance();

const expectedDistFiles = new Set([...requiredDistFiles, ...referencedAssets]);
const unexpectedDistFiles = distFiles.filter((file) => !expectedDistFiles.has(file));
if (unexpectedDistFiles.length > 0) {
  throw new Error(`Release check failed: unexpected dist files:\n${unexpectedDistFiles.join("\n")}`);
}

const badDistFiles = distFiles.filter((file) => forbiddenDistExtensions.some((extension) => file.endsWith(extension)));
if (badDistFiles.length > 0) {
  throw new Error(`Release check failed: forbidden dist files:\n${badDistFiles.join("\n")}`);
}

const webpFiles = distFiles.filter((file) => file.endsWith(".webp"));
if (webpFiles.length !== 9) {
  throw new Error(`Release check failed: expected exactly 9 optimized WebP images, found ${webpFiles.length}.`);
}

let distBytes = 0;
for (const file of distFiles) {
  distBytes += (await stat(file)).size;
}
if (distBytes > maxDistBytes) {
  throw new Error(`Release check failed: dist is ${(distBytes / 1024 / 1024).toFixed(2)} MB, above 5 MB budget.`);
}

const packageFiles = runNpmPackDryRun();
const missingPackageFiles = requiredPackageFiles.filter((file) => !packageFiles.includes(file));
if (missingPackageFiles.length > 0) {
  throw new Error(`Release check failed: npm package would miss playable release files:\n${missingPackageFiles.join("\n")}`);
}
const badPackageFiles = packageFiles.filter(
  (file) =>
    forbiddenPackageNames.includes(file) ||
    forbiddenPackagePrefixes.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix)) ||
    forbiddenDistExtensions.some((extension) => file.endsWith(extension))
);
if (badPackageFiles.length > 0) {
  throw new Error(`Release check failed: package would include forbidden files:\n${badPackageFiles.join("\n")}`);
}

console.log(`Release check passed: ${distFiles.length} dist files, ${(distBytes / 1024 / 1024).toFixed(2)} MB, ${packageFiles.length} package files.`);
