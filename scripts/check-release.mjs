import { access, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const distDir = "dist";
const maxDistBytes = 5 * 1024 * 1024;
const forbiddenDistExtensions = [".map", ".png"];
const forbiddenPackagePrefixes = ["public/", "release/", "release_backups/", "scripts/", "src/", "tmp/"];
const forbiddenPackageNames = ["promt.txt", "DESIGN_NOTES.md", "PROGRESS.md", "docs/QA_WALKTHROUGH.md"];
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
  return [...html.matchAll(/(?:src|href)="\.\/assets\/(index-[^"]+\.(?:js|css))"/g)].map((match) => `dist/assets/${match[1]}`);
}

async function assertStaticSiteMetadata() {
  const html = await readFile("dist/index.html", "utf8");
  for (const required of [
    'rel="canonical"',
    'rel="manifest"',
    'property="og:title"',
    'property="og:image"',
    'name="twitter:card"',
    "The Department of Misplaced Hours"
  ]) {
    if (!html.includes(required)) {
      throw new Error(`Release check failed: dist/index.html is missing metadata marker ${required}.`);
    }
  }

  const manifest = JSON.parse(await readFile("dist/site.webmanifest", "utf8"));
  const requiredManifest = {
    name: "The Department of Misplaced Hours",
    short_name: "Misplaced Hours",
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
  if (!Array.isArray(manifest.icons) || !manifest.icons.some((icon) => icon.src === "./favicon.svg" && icon.type === "image/svg+xml")) {
    throw new Error("Release check failed: site.webmanifest is missing the SVG favicon icon.");
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

const jsFiles = distFiles.filter((file) => /^dist\/assets\/index-.+\.js$/.test(file));
const cssFiles = distFiles.filter((file) => /^dist\/assets\/index-.+\.css$/.test(file));
if (jsFiles.length !== 1 || cssFiles.length !== 1) {
  throw new Error(`Release check failed: expected one built JS and one built CSS file, found JS=${jsFiles.length}, CSS=${cssFiles.length}.`);
}
const referencedAssets = await referencedBuildAssets();
const missingReferencedAssets = referencedAssets.filter((file) => !distFiles.includes(file));
if (referencedAssets.length !== 2 || missingReferencedAssets.length > 0) {
  throw new Error(
    `Release check failed: dist/index.html does not reference the current built JS/CSS assets.\nReferenced:\n${referencedAssets.join("\n")}\nMissing:\n${missingReferencedAssets.join("\n")}`
  );
}
await assertStaticSiteMetadata();

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
