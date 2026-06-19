import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";
import { chromium } from "playwright";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const releaseName = `department-of-misplaced-hours-${packageJson.version}`;
const host = "127.0.0.1";
const sourceDocBase = "https://github.com/NoCoderRandom/department-of-misplaced-hours/blob/main/";
const sourceDocs = [
  { label: "Assets", path: "ASSETS.md" },
  { label: "Notice", path: "NOTICE.md" },
  { label: "3rd Party", path: "THIRD_PARTY_NOTICES.md" }
];

function option(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) {
    return inline.slice(prefix.length);
  }
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const smokeTargets = [
  {
    label: "release ZIP dist",
    archivePath: option("standard-archive", join("release", `${releaseName}.zip`)),
    shaPath: option("standard-sha", join("release", `${releaseName}.sha256`)),
    extractRoot: resolve("tmp", "release-archive-smoke"),
    webRootSubdir: "dist",
    expectedEntry: "dist/index.html"
  },
  {
    label: "store ZIP root",
    archivePath: option("store-archive", join("release", `${releaseName}-store.zip`)),
    shaPath: option("store-sha", join("release", `${releaseName}-store.sha256`)),
    extractRoot: resolve("tmp", "release-store-smoke"),
    webRootSubdir: "",
    expectedEntry: "index.html"
  }
];

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".ogg", "audio/ogg"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"]
]);

async function sha256(path) {
  const hash = createHash("sha256");
  await new Promise((resolvePromise, reject) => {
    createReadStream(path).on("data", (chunk) => hash.update(chunk)).on("error", reject).on("end", resolvePromise);
  });
  return hash.digest("hex");
}

async function assertChecksum(target) {
  const expected = (await readFile(target.shaPath, "utf8")).trim().split(/\s+/)[0];
  const actual = await sha256(target.archivePath);
  if (actual !== expected) {
    throw new Error(`${target.label} checksum mismatch. Expected ${expected}, got ${actual}.`);
  }
}

function zipEntries(archive, target) {
  let endOffset = -1;
  for (let i = archive.length - 22; i >= Math.max(0, archive.length - 0xffff - 22); i -= 1) {
    if (archive.readUInt32LE(i) === 0x06054b50) {
      endOffset = i;
      break;
    }
  }
  if (endOffset < 0) {
    throw new Error(`${target.label} is not a readable ZIP file.`);
  }

  const entryCount = archive.readUInt16LE(endOffset + 10);
  let cursor = archive.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let i = 0; i < entryCount; i += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`${target.label} central directory is malformed.`);
    }
    const method = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function safeDestination(target, name) {
  const normalized = normalize(name.replaceAll("\\", "/"));
  if (normalized.startsWith("..") || normalized.includes(`${sep}..${sep}`) || normalized === "..") {
    throw new Error(`${target.label} contains unsafe path: ${name}`);
  }
  const destination = resolve(target.extractRoot, normalized);
  if (!destination.startsWith(`${target.extractRoot}${sep}`)) {
    throw new Error(`${target.label} path escapes smoke directory: ${name}`);
  }
  return destination;
}

async function extractArchive(target) {
  const archive = await readFile(target.archivePath);
  const entries = zipEntries(archive, target);
  if (!entries.some((entry) => entry.name === target.expectedEntry)) {
    throw new Error(`${target.label} is missing ${target.expectedEntry}.`);
  }

  await rm(target.extractRoot, { recursive: true, force: true });
  await mkdir(target.extractRoot, { recursive: true });

  for (const entry of entries) {
    if (entry.name.endsWith("/")) {
      continue;
    }
    const localOffset = entry.localHeaderOffset;
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`${target.label} local header is malformed for ${entry.name}.`);
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + entry.compressedSize);
    const content =
      entry.method === 0
        ? compressed
        : entry.method === 8
          ? inflateRawSync(compressed)
          : undefined;
    if (!content) {
      throw new Error(`${target.label} uses unsupported ZIP method ${entry.method} for ${entry.name}.`);
    }
    if (content.length !== entry.uncompressedSize) {
      throw new Error(`${target.label} entry size mismatch for ${entry.name}.`);
    }
    const destination = safeDestination(target, entry.name);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }
}

function fileForRequest(webRoot, urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const relativePath = normalize(decoded === "/" ? "index.html" : decoded.replace(/^\/+/, ""));
  if (relativePath.startsWith("..") || relativePath.includes(`${sep}..${sep}`)) {
    return undefined;
  }
  return resolve(webRoot, relativePath);
}

function createStaticServer(webRoot) {
  return createServer(async (request, response) => {
    try {
      const filePath = fileForRequest(webRoot, request.url ?? "/");
      if (!filePath || !filePath.startsWith(`${webRoot}${sep}`)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      const info = await stat(filePath);
      if (info.isDirectory()) {
        response.writeHead(403).end("Directory listing disabled");
        return;
      }
      response.writeHead(200, { "content-type": mime.get(extname(filePath)) ?? "application/octet-stream" });
      response.end(await readFile(filePath));
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

function watchPage(page, issues) {
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "warning" && text.includes("AudioContext was not allowed to start")) {
      return;
    }
    if (message.type() === "warning" && text.includes("CONTEXT_LOST_WEBGL")) {
      return;
    }
    if (message.type() === "log" && text.includes("Phaser v")) {
      return;
    }
    if (["error", "warning"].includes(message.type())) {
      issues.push(`${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      issues.push(`${response.status()} ${response.url()}`);
    }
  });
}

async function gameClick(page, x, y) {
  const point = await page.evaluate(
    ({ gameX, gameY }) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        throw new Error("Canvas not found.");
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + (gameX / 1200) * rect.width,
        y: rect.top + (gameY / 800) * rect.height
      };
    },
    { gameX: x, gameY: y }
  );
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(150);
}

async function installWindowOpenCapture(page) {
  await page.evaluate(() => {
    window.__archiveSmokeOpenedUrls = [];
    window.open = (url, target, features) => {
      window.__archiveSmokeOpenedUrls.push({
        url: String(url),
        target: target === undefined ? "" : String(target),
        features: features === undefined ? "" : String(features)
      });
      return null;
    };
  });
}

async function assertCreditDocButton(page, label, path, target) {
  const before = await page.evaluate(() => window.__archiveSmokeOpenedUrls?.length ?? 0);
  await page.getByRole("button", { name: label }).click({ timeout: 8_000 });
  await page.waitForFunction((count) => (window.__archiveSmokeOpenedUrls?.length ?? 0) === count + 1, before, {
    timeout: 8_000
  });
  const opened = await page.evaluate(() => window.__archiveSmokeOpenedUrls.at(-1));
  const expectedUrl = `${sourceDocBase}${path}`;
  if (
    opened?.url !== expectedUrl ||
    opened.target !== "_blank" ||
    !opened.features.includes("noopener") ||
    !opened.features.includes("noreferrer")
  ) {
    throw new Error(`${target.label} Credits ${label} opened wrong document target: ${JSON.stringify(opened)}.`);
  }
}

async function paintedCanvasMetrics(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      throw new Error("Canvas unavailable.");
    }
    const points = [
      [100, 100],
      [300, 220],
      [600, 390],
      [900, 500],
      [1120, 700]
    ];
    const buckets = new Set();
    let bright = 0;
    for (const [x, y] of points) {
      const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
      if (r + g + b > 45 && a > 0) {
        bright += 1;
      }
      buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
    return { width: canvas.width, height: canvas.height, bright, uniqueBuckets: buckets.size };
  });
}

async function smokeOrientationGate(browser, url, target) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const issues = [];
  watchPage(page, issues);
  try {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
    await page.locator("#orientation-gate").waitFor({ state: "visible", timeout: 8_000 });
    const gateText = ((await page.locator("#orientation-gate").textContent()) ?? "").replace(/\s+/g, " ").trim();
    for (const required of ["Rotate Device", "Landscape mode"]) {
      if (!gateText.includes(required)) {
        throw new Error(`${target.label} orientation gate is missing required text: ${required}`);
      }
    }

    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("orientation-gate")).display === "none", null, {
      timeout: 5_000
    });
    if (issues.length > 0) {
      throw new Error(`${target.label} orientation-gate smoke issues:\n${issues.join("\n")}`);
    }
  } finally {
    await page.close().catch(() => {});
  }
}

async function smokeNoScriptFallback(browser, url, target) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const issues = [];
  watchPage(page, issues);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 8_000 });
    const fallback = page.getByRole("alert");
    await fallback.waitFor({ state: "visible", timeout: 8_000 });
    const fallbackText = ((await fallback.textContent()) ?? "").replace(/\s+/g, " ").trim();
    for (const required of ["needs JavaScript enabled", "static web game", "does not require a backend server"]) {
      if (!fallbackText.includes(required)) {
        throw new Error(`${target.label} no-JavaScript fallback is missing required text: ${required}`);
      }
    }
    if ((await page.locator("canvas").count()) !== 0) {
      throw new Error(`${target.label} no-JavaScript fallback unexpectedly created a canvas.`);
    }
    if (issues.length > 0) {
      throw new Error(`${target.label} no-JavaScript smoke issues:\n${issues.join("\n")}`);
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function smokeExtractedArchive(target) {
  await assertChecksum(target);
  await extractArchive(target);
  const webRoot = resolve(target.extractRoot, target.webRootSubdir);
  const server = createStaticServer(webRoot);
  await new Promise((resolvePromise) => server.listen(0, host, resolvePromise));
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error(`Could not determine smoke-test port for ${target.label}.`);
  }

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const url = `http://${host}:${address.port}/`;
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    const issues = [];
    watchPage(page, issues);

    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      localStorage.removeItem("department-misplaced-hours-save-v1");
      localStorage.removeItem("department-misplaced-hours-preferences-v1");
    });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
    await page.waitForTimeout(700);

    const metrics = await paintedCanvasMetrics(page);
    if (metrics.width !== 1200 || metrics.height !== 800 || metrics.bright < 2 || metrics.uniqueBuckets < 3) {
      throw new Error(`${target.label} title canvas did not paint correctly: ${JSON.stringify(metrics)}`);
    }

    await installWindowOpenCapture(page);
    await gameClick(page, 600, 594);
    await page.getByRole("dialog", { name: "Credits" }).waitFor({ state: "visible", timeout: 8_000 });
    await page.getByText("source repository").waitFor({ state: "visible", timeout: 8_000 });
    for (const doc of sourceDocs) {
      await page.getByRole("button", { name: doc.label }).waitFor({ state: "visible", timeout: 8_000 });
      await assertCreditDocButton(page, doc.label, doc.path, target);
    }
    await page.getByRole("button", { name: "Close" }).click({ timeout: 8_000 });

    await gameClick(page, 600, 390);
    await page.getByRole("button", { name: "Clock In" }).click({ timeout: 8_000 });
    await page.waitForTimeout(300);
    const save = await page.evaluate(() => JSON.parse(localStorage.getItem("department-misplaced-hours-save-v1")));
    if (!save?.inventory?.includes("visitorBadge") || save.room !== "reception") {
      throw new Error(`${target.label} did not start a playable shift: ${JSON.stringify(save)}`);
    }
    if (issues.length > 0) {
      throw new Error(`${target.label} smoke issues:\n${issues.join("\n")}`);
    }
    await smokeOrientationGate(browser, url, target);
    await smokeNoScriptFallback(browser, url, target);
  } finally {
    await browser?.close().catch(() => {});
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
}

for (const target of smokeTargets) {
  await smokeExtractedArchive(target);
  console.log(
    `Release archive smoke passed: ${target.archivePath} served from ${target.webRootSubdir || "root"}, verified Credits document targets, started a new shift, passed touch-phone orientation gating, and showed the no-JavaScript fallback.`
  );
}
