import { chromium } from "playwright";

const defaultUrl = "https://nocoderrandom.github.io/department-of-misplaced-hours/";
const saveKey = "department-misplaced-hours-save-v1";
const preferencesKey = "department-misplaced-hours-preferences-v1";
const maxEntryJsBytes = 200 * 1024;
const maxPhaserVendorBytes = 1400 * 1024;
const maxRuntimeHelperBytes = 10 * 1024;
const maxCssBytes = 32 * 1024;
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

function cacheBustedUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.searchParams.set("live-smoke", `${Date.now()}`);
  return url.toString();
}

function runtimeAssetsFromHtml(html) {
  return [
    ...new Set([...html.matchAll(/(?:src|href)="\.\/assets\/([^"]+\.(?:js|css))"/g)].map((match) => match[1]))
  ].sort();
}

function splitRuntimeAssets(assets) {
  const entryJs = assets.filter((asset) => /^index-.+\.js$/.test(asset));
  const phaserVendorJs = assets.filter((asset) => /^phaser-.+\.js$/.test(asset));
  const css = assets.filter((asset) => /^index-.+\.css$/.test(asset));
  const runtimeHelpers = assets.filter(
    (asset) => asset.endsWith(".js") && !entryJs.includes(asset) && !phaserVendorJs.includes(asset)
  );
  return { entryJs, phaserVendorJs, css, runtimeHelpers };
}

function assertRuntimeContentType(response, kind, label) {
  const contentType = response.headers.get("content-type") ?? "";
  const isExpected =
    kind === "css" ? contentType.includes("text/css") : /javascript|ecmascript/.test(contentType.toLowerCase());
  if (!isExpected) {
    throw new Error(`Live ${label} served with unexpected content type: ${contentType || "(none)"}.`);
  }
}

async function assertLiveAssetBudget(label, url, maxBytes, kind) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Live ${label} returned HTTP ${response.status} for ${url}`);
  }
  assertRuntimeContentType(response, kind, label);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `Live ${label} is ${(bytes.byteLength / 1024).toFixed(1)} KB, above ${(maxBytes / 1024).toFixed(1)} KB budget: ${url}`
    );
  }
  return bytes.byteLength;
}

function pngDimensions(bytes) {
  const view = new DataView(bytes);
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.byteLength < 24 ||
    !signature.every((byte, index) => view.getUint8(index) === byte) ||
    String.fromCharCode(view.getUint8(12), view.getUint8(13), view.getUint8(14), view.getUint8(15)) !== "IHDR"
  ) {
    throw new Error("not a PNG with a readable IHDR chunk");
  }
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function assertLivePng(response, label, expectedWidth, expectedHeight, minBytes = 0) {
  if (!response.headers.get("content-type")?.includes("image/png")) {
    throw new Error(`Live ${label} did not serve as PNG.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength < minBytes) {
    throw new Error(`Live ${label} is unexpectedly small: ${bytes.byteLength} bytes.`);
  }
  const actual = pngDimensions(bytes);
  if (actual.width !== expectedWidth || actual.height !== expectedHeight) {
    throw new Error(`Live ${label} dimensions expected ${expectedWidth}x${expectedHeight}, got ${actual.width}x${actual.height}.`);
  }
  return { bytes: bytes.byteLength, ...actual };
}

async function assertLiveRuntimeAssets(rawUrl, html) {
  const assets = runtimeAssetsFromHtml(html);
  const { entryJs, phaserVendorJs, css, runtimeHelpers } = splitRuntimeAssets(assets);
  if (entryJs.length !== 1 || phaserVendorJs.length !== 1 || css.length !== 1) {
    throw new Error(
      `Live HTML expected one entry JS, one Phaser vendor JS, and one CSS runtime asset.\nReferenced:\n${assets.join("\n")}`
    );
  }

  const baseUrl = new URL(rawUrl);
  const assetUrl = (asset) => {
    const url = new URL(`assets/${asset}`, baseUrl);
    url.searchParams.set("live-smoke", `${Date.now()}`);
    return url;
  };
  const checked = {
    assets,
    entryJs: {
      file: entryJs[0],
      bytes: await assertLiveAssetBudget("entry JavaScript", assetUrl(entryJs[0]), maxEntryJsBytes, "js")
    },
    phaserVendorJs: {
      file: phaserVendorJs[0],
      bytes: await assertLiveAssetBudget(
        "Phaser vendor JavaScript",
        assetUrl(phaserVendorJs[0]),
        maxPhaserVendorBytes,
        "js"
      )
    },
    css: {
      file: css[0],
      bytes: await assertLiveAssetBudget("entry CSS", assetUrl(css[0]), maxCssBytes, "css")
    },
    runtimeHelpers: []
  };

  for (const helper of runtimeHelpers) {
    checked.runtimeHelpers.push({
      file: helper,
      bytes: await assertLiveAssetBudget("runtime helper JavaScript", assetUrl(helper), maxRuntimeHelperBytes, "js")
    });
  }

  return checked;
}

function watchPage(page, issues, label) {
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
      issues.push(`${label} ${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", (error) => issues.push(`${label} pageerror: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400) {
      issues.push(`${label} ${response.status()} ${response.url()}`);
    }
  });
}

async function gameClick(page, x, y) {
  const point = await page.evaluate(
    ({ gameX, gameY }) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        throw new Error("Canvas not found for game click.");
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
}

async function installWindowOpenCapture(page) {
  await page.evaluate(() => {
    window.__liveSmokeOpenedUrls = [];
    window.open = (url, target, features) => {
      window.__liveSmokeOpenedUrls.push({
        url: String(url),
        target: target === undefined ? "" : String(target),
        features: features === undefined ? "" : String(features)
      });
      return null;
    };
  });
}

async function assertCreditDocButton(page, label, path, smokeLabel) {
  const before = await page.evaluate(() => window.__liveSmokeOpenedUrls?.length ?? 0);
  await page.getByRole("button", { name: label }).click({ timeout: 30_000 });
  await page.waitForFunction((count) => (window.__liveSmokeOpenedUrls?.length ?? 0) === count + 1, before, {
    timeout: 30_000
  });
  const opened = await page.evaluate(() => window.__liveSmokeOpenedUrls.at(-1));
  const expectedUrl = `${sourceDocBase}${path}`;
  if (
    opened?.url !== expectedUrl ||
    opened.target !== "_blank" ||
    !opened.features.includes("noopener") ||
    !opened.features.includes("noreferrer")
  ) {
    throw new Error(`${smokeLabel} Credits ${label} opened wrong document target: ${JSON.stringify(opened)}.`);
  }
}

async function assertCanvasPainted(page) {
  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const context = canvas?.getContext("2d", { willReadFrequently: true });
    if (!canvas || !context) {
      throw new Error("Canvas unavailable for paint check.");
    }
    const points = [
      [96, 110],
      [260, 260],
      [600, 390],
      [920, 520],
      [1110, 690]
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
  if (metrics.width !== 1200 || metrics.height !== 800 || metrics.bright < 2 || metrics.uniqueBuckets < 3) {
    throw new Error(`Live canvas appears blank or wrongly sized: ${JSON.stringify(metrics)}`);
  }
}

function compactText(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function assertControllerShortcutText(label, text) {
  const normalized = compactText(text);
  for (const required of ["Back/View", "X", "Notes", "Y", "Hint", "Start/Menu", "Help", "bumpers"]) {
    if (!normalized.includes(required)) {
      throw new Error(`Live ${label} is missing controller shortcut text ${required}: ${normalized}`);
    }
  }
  return normalized;
}

async function assertCanvasAccessibility(page) {
  const attrs = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const summary = document.getElementById("game-accessibility-summary");
    const liveStatus = document.getElementById("game-live-status");
    return {
      tabIndex: canvas?.getAttribute("tabindex"),
      role: canvas?.getAttribute("role"),
      label: canvas?.getAttribute("aria-label"),
      describedBy: canvas?.getAttribute("aria-describedby"),
      keyShortcuts: canvas?.getAttribute("aria-keyshortcuts"),
      summaryText: summary?.textContent?.replace(/\s+/g, " ").trim() ?? "",
      liveStatusRole: liveStatus?.getAttribute("role"),
      liveStatusLive: liveStatus?.getAttribute("aria-live"),
      liveStatusAtomic: liveStatus?.getAttribute("aria-atomic")
    };
  });
  if (
    attrs.tabIndex !== "0" ||
    attrs.role !== "application" ||
    attrs.label !== "The Department of Misplaced Hours playable game canvas" ||
    attrs.describedBy !== "game-accessibility-summary" ||
    attrs.keyShortcuts !== "Tab Shift+Tab Enter Space Escape ArrowLeft ArrowRight ArrowUp ArrowDown M N H F1 S BracketLeft BracketRight Minus Equal" ||
    !attrs.summaryText.includes("Tab and Shift+Tab") ||
    !attrs.summaryText.includes("ending actions") ||
    !attrs.summaryText.includes("Enter or Space") ||
    !attrs.summaryText.includes("Arrow keys move between modal buttons") ||
    !attrs.summaryText.includes("Escape closes panels or puts away a selected inventory item") ||
    !attrs.summaryText.includes("F1 opens Help") ||
    !attrs.summaryText.includes("[ / ] adjust volume") ||
    attrs.liveStatusRole !== "status" ||
    attrs.liveStatusLive !== "polite" ||
    attrs.liveStatusAtomic !== "true"
  ) {
    throw new Error(`Live canvas accessibility attributes are incomplete: ${JSON.stringify(attrs)}`);
  }
}

async function assertLiveHtml(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Live HTML returned HTTP ${response.status} for ${url}`);
  }
  const rawHtml = await response.text();
  const runtime = await assertLiveRuntimeAssets(url, rawHtml);
  const html = rawHtml.replace(/\s+/g, " ");
  for (const required of [
    "The Department of Misplaced Hours",
    'http-equiv="Content-Security-Policy"',
    "default-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "img-src 'self' data: blob:",
    "form-action 'none'",
    "https://nocoderrandom.github.io/department-of-misplaced-hours/social-card.png",
    'property="og:image:type" content="image/png"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'name="twitter:image:alt"',
    'name="referrer" content="no-referrer"',
    "Interactive point-and-click mystery game canvas",
    "Tab and Shift+Tab",
    "ending actions",
    "game-live-status",
    "orientation-gate",
    "Rotate Device",
    "Landscape mode keeps the files, buttons, and clues readable.",
    "needs JavaScript enabled",
    "static web game",
    "does not require a backend server"
  ]) {
    if (!html.includes(required)) {
      throw new Error(`Live HTML is missing required text: ${required}`);
    }
  }
  if (/localhost|127\.0\.0\.1|ws:\/\//.test(html)) {
    throw new Error("Live HTML still exposes localhost or websocket development endpoints in its CSP.");
  }
  return runtime;
}

async function assertPublicMetadata(rawUrl) {
  const baseUrl = new URL(rawUrl);
  const checks = [
    {
      key: "manifest",
      label: "manifest",
      url: new URL("site.webmanifest", baseUrl),
      assert: async (response) => {
        const manifest = await response.json();
        if (
          manifest.name !== "The Department of Misplaced Hours" ||
          manifest.short_name !== "Misplaced Hours" ||
          manifest.description !== "A surreal point-and-click mystery puzzle game for static web hosting." ||
          manifest.start_url !== "./" ||
          manifest.scope !== "./" ||
          manifest.display !== "fullscreen" ||
          manifest.orientation !== "landscape" ||
          manifest.background_color !== "#080a08" ||
          manifest.theme_color !== "#10170f" ||
          !Array.isArray(manifest.categories) ||
          !manifest.categories.includes("games") ||
          !manifest.categories.includes("entertainment") ||
          !manifest.icons?.some((icon) => icon.src === "./favicon.svg" && icon.type === "image/svg+xml" && icon.purpose === "any") ||
          !manifest.icons?.some(
            (icon) =>
              icon.src === "./icon-192.png" &&
              icon.sizes === "192x192" &&
              icon.type === "image/png" &&
              icon.purpose === "any maskable"
          ) ||
          !manifest.icons?.some(
            (icon) =>
              icon.src === "./icon-512.png" &&
              icon.sizes === "512x512" &&
              icon.type === "image/png" &&
              icon.purpose === "any maskable"
          )
        ) {
          throw new Error(`Live manifest content is incomplete: ${JSON.stringify(manifest)}`);
        }
        return {
          name: manifest.name,
          shortName: manifest.short_name,
          display: manifest.display,
          orientation: manifest.orientation,
          categories: manifest.categories,
          icons: manifest.icons.map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose }))
        };
      }
    },
    {
      key: "icon192",
      label: "app icon 192",
      url: new URL("icon-192.png", baseUrl),
      assert: async (response) => {
        return assertLivePng(response, "icon-192.png", 192, 192);
      }
    },
    {
      key: "icon512",
      label: "app icon 512",
      url: new URL("icon-512.png", baseUrl),
      assert: async (response) => {
        return assertLivePng(response, "icon-512.png", 512, 512);
      }
    },
    {
      key: "socialCard",
      label: "social card",
      url: new URL("social-card.png", baseUrl),
      assert: async (response) => {
        return assertLivePng(response, "social-card.png", 1200, 630, 50_000);
      }
    },
    {
      key: "robots",
      label: "robots",
      url: new URL("robots.txt", baseUrl),
      assert: async (response) => {
        const robots = await response.text();
        if (
          !robots.includes("User-agent: *") ||
          !robots.includes("Allow: /") ||
          !robots.includes("https://nocoderrandom.github.io/department-of-misplaced-hours/sitemap.xml")
        ) {
          throw new Error(`Live robots.txt content is incomplete: ${robots}`);
        }
        return { bytes: new TextEncoder().encode(robots).byteLength, sitemap: "https://nocoderrandom.github.io/department-of-misplaced-hours/sitemap.xml" };
      }
    },
    {
      key: "sitemap",
      label: "sitemap",
      url: new URL("sitemap.xml", baseUrl),
      assert: async (response) => {
        const sitemap = await response.text();
        if (!sitemap.includes("<urlset") || !sitemap.includes("https://nocoderrandom.github.io/department-of-misplaced-hours/")) {
          throw new Error(`Live sitemap.xml content is incomplete: ${sitemap}`);
        }
        return { bytes: new TextEncoder().encode(sitemap).byteLength, listedUrl: "https://nocoderrandom.github.io/department-of-misplaced-hours/" };
      }
    }
  ];

  const metadata = {};
  for (const check of checks) {
    check.url.searchParams.set("live-smoke", `${Date.now()}`);
    const response = await fetch(check.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Live ${check.label} returned HTTP ${response.status} for ${check.url}`);
    }
    const publicUrl = new URL(check.url);
    publicUrl.search = "";
    metadata[check.key] = {
      url: publicUrl.toString(),
      ...(await check.assert(response))
    };
  }
  return metadata;
}

async function smokeCredits(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const issues = [];
  watchPage(page, issues, "live-credits");
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
    await page.evaluate(
      ({ save, preferences }) => {
        localStorage.removeItem(save);
        localStorage.removeItem(preferences);
      },
      { save: saveKey, preferences: preferencesKey }
    );
    await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(900);
    await installWindowOpenCapture(page);
    await assertCanvasPainted(page);
    await gameClick(page, 600, 594);
    await page.getByRole("dialog", { name: "Credits" }).waitFor({ state: "visible", timeout: 30_000 });
    await page.getByText("source repository").waitFor({ state: "visible", timeout: 30_000 });
    for (const doc of sourceDocs) {
      await page.getByRole("button", { name: doc.label }).waitFor({ state: "visible", timeout: 30_000 });
      await assertCreditDocButton(page, doc.label, doc.path, "Live");
    }
    const openedUrls = await page.evaluate(() => window.__liveSmokeOpenedUrls.map((entry) => entry.url));
    await page.getByRole("button", { name: "Close" }).click({ timeout: 30_000 });
    if (issues.length > 0) {
      throw new Error(`Live Credits browser issues:\n${issues.join("\n")}`);
    }
    return { openedUrls };
  } finally {
    await page.close().catch(() => {});
  }
}

async function smokeTitleControls(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const issues = [];
  watchPage(page, issues, "live-controls");
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
    await page.evaluate(
      ({ save, preferences }) => {
        localStorage.removeItem(save);
        localStorage.removeItem(preferences);
      },
      { save: saveKey, preferences: preferencesKey }
    );
    await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(900);
    await assertCanvasPainted(page);
    await gameClick(page, 600, 534);
    const dialog = page.getByRole("dialog", { name: "Controls" });
    await dialog.waitFor({ state: "visible", timeout: 30_000 });
    const controlsText = assertControllerShortcutText("title Controls panel", await dialog.textContent());
    await page.getByRole("button", { name: "Close" }).click({ timeout: 30_000 });
    if (issues.length > 0) {
      throw new Error(`Live Controls browser issues:\n${issues.join("\n")}`);
    }
    return { controlsText };
  } finally {
    await page.close().catch(() => {});
  }
}

async function smokePlayable(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const issues = [];
  watchPage(page, issues, "live");
  await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.evaluate(
    ({ save, preferences }) => {
      localStorage.removeItem(save);
      localStorage.removeItem(preferences);
    },
    { save: saveKey, preferences: preferencesKey }
  );
  await page.reload({ waitUntil: "networkidle", timeout: 60_000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(900);
  await assertCanvasAccessibility(page);
  await assertCanvasPainted(page);
  await gameClick(page, 600, 390);
  await page.getByRole("button", { name: "Clock In" }).click({ timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector(".game-modal-panel"), null, { timeout: 30_000 });
  await page.keyboard.press("F1");
  const helpDialog = page.getByRole("dialog", { name: "Help" });
  await helpDialog.waitFor({ state: "visible", timeout: 30_000 });
  const helpText = assertControllerShortcutText("Help panel", await helpDialog.textContent());
  await page.getByRole("button", { name: "Close" }).click({ timeout: 30_000 });
  const save = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), saveKey);
  const title = await page.title();
  await page.close();
  if (title !== "The Department of Misplaced Hours") {
    throw new Error(`Live page title is wrong: ${title}`);
  }
  if (!save?.inventory?.includes("visitorBadge") || save.room !== "reception") {
    throw new Error(`Live game did not start a playable shift: ${JSON.stringify(save)}`);
  }
  if (issues.length > 0) {
    throw new Error(`Live browser issues:\n${issues.join("\n")}`);
  }
  return { title, save, helpText };
}

async function smokeNoScript(browser, url) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  const issues = [];
  watchPage(page, issues, "live-noscript");
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const fallback = page.getByRole("alert");
    await fallback.waitFor({ state: "visible", timeout: 30_000 });
    const fallbackText = ((await fallback.textContent()) ?? "").replace(/\s+/g, " ").trim();
    for (const required of ["needs JavaScript enabled", "static web game", "does not require a backend server"]) {
      if (!fallbackText.includes(required)) {
        throw new Error(`Live no-JavaScript fallback is missing required text: ${required}`);
      }
    }
    if ((await page.locator("canvas").count()) !== 0) {
      throw new Error("Live no-JavaScript fallback unexpectedly created a canvas.");
    }
    if (issues.length > 0) {
      throw new Error(`Live no-JavaScript browser issues:\n${issues.join("\n")}`);
    }
    return { fallbackText };
  } finally {
    await context.close();
  }
}

async function smokeOrientationGate(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true
  });
  const page = await context.newPage();
  const issues = [];
  watchPage(page, issues, "live-orientation");
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 60_000 });
    await page.locator("canvas").waitFor({ state: "visible", timeout: 30_000 });
    await page.locator("#orientation-gate").waitFor({ state: "visible", timeout: 30_000 });
    const gateText = ((await page.locator("#orientation-gate").textContent()) ?? "").replace(/\s+/g, " ").trim();
    for (const required of ["Rotate Device", "Landscape mode"]) {
      if (!gateText.includes(required)) {
        throw new Error(`Live phone portrait orientation gate is missing required text: ${required}`);
      }
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForFunction(() => getComputedStyle(document.getElementById("orientation-gate")).display === "none", null, {
      timeout: 30_000
    });
    if (issues.length > 0) {
      throw new Error(`Live orientation-gate browser issues:\n${issues.join("\n")}`);
    }
    return { gateText };
  } finally {
    await context.close();
  }
}

const rawUrl = option("url", process.env.LIVE_GAME_URL ?? defaultUrl);
const retries = Number.parseInt(option("retries", process.env.LIVE_SMOKE_RETRIES ?? "6"), 10);
const delayMs = Number.parseInt(option("delay-ms", process.env.LIVE_SMOKE_DELAY_MS ?? "10000"), 10);
let lastError;
let passed = false;

for (let attempt = 1; attempt <= retries; attempt += 1) {
  const url = cacheBustedUrl(rawUrl);
  let browser;
  try {
    const runtime = await assertLiveHtml(url);
    const metadata = await assertPublicMetadata(rawUrl);
    browser = await chromium.launch({ headless: true });
    const credits = await smokeCredits(browser, url);
    const controls = await smokeTitleControls(browser, url);
    const playable = await smokePlayable(browser, url);
    const noScript = await smokeNoScript(browser, url);
    const orientation = await smokeOrientationGate(browser, url);
    console.log(
      JSON.stringify({ ok: true, url: rawUrl, attempts: attempt, runtime, metadata, credits, controls, playable, noScript, orientation }, null, 2)
    );
    await browser.close();
    passed = true;
    break;
  } catch (error) {
    lastError = error;
    await browser?.close().catch(() => {});
    if (attempt < retries) {
      console.warn(`Live smoke attempt ${attempt}/${retries} failed: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

if (!passed) {
  console.error(lastError);
  process.exitCode = 1;
}
