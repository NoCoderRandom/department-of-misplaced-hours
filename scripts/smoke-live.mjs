import { chromium } from "playwright";

const defaultUrl = "https://nocoderrandom.github.io/department-of-misplaced-hours/";
const saveKey = "department-misplaced-hours-save-v1";
const preferencesKey = "department-misplaced-hours-preferences-v1";

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

async function assertCanvasAccessibility(page) {
  const attrs = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const summary = document.getElementById("game-accessibility-summary");
    return {
      tabIndex: canvas?.getAttribute("tabindex"),
      role: canvas?.getAttribute("role"),
      label: canvas?.getAttribute("aria-label"),
      describedBy: canvas?.getAttribute("aria-describedby"),
      keyShortcuts: canvas?.getAttribute("aria-keyshortcuts"),
      summaryText: summary?.textContent?.replace(/\s+/g, " ").trim() ?? ""
    };
  });
  if (
    attrs.tabIndex !== "0" ||
    attrs.role !== "application" ||
    attrs.label !== "The Department of Misplaced Hours playable game canvas" ||
    attrs.describedBy !== "game-accessibility-summary" ||
    attrs.keyShortcuts !== "Tab Shift+Tab Enter Space M N H F1 S" ||
    !attrs.summaryText.includes("Tab and Shift+Tab") ||
    !attrs.summaryText.includes("Enter or Space") ||
    !attrs.summaryText.includes("F1 for Help")
  ) {
    throw new Error(`Live canvas accessibility attributes are incomplete: ${JSON.stringify(attrs)}`);
  }
}

async function assertLiveHtml(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Live HTML returned HTTP ${response.status} for ${url}`);
  }
  const html = (await response.text()).replace(/\s+/g, " ");
  for (const required of [
    "The Department of Misplaced Hours",
    'http-equiv="Content-Security-Policy"',
    "default-src 'self'",
    "object-src 'none'",
    "script-src 'self'",
    "img-src 'self' data: blob:",
    "form-action 'none'",
    'name="referrer" content="no-referrer"',
    "Interactive point-and-click mystery game canvas",
    "Tab and Shift+Tab",
    "needs JavaScript enabled",
    "static web game",
    "does not require a backend server"
  ]) {
    if (!html.includes(required)) {
      throw new Error(`Live HTML is missing required text: ${required}`);
    }
  }
}

async function assertPublicMetadata(rawUrl) {
  const baseUrl = new URL(rawUrl);
  const checks = [
    {
      label: "manifest",
      url: new URL("site.webmanifest", baseUrl),
      assert: async (response) => {
        const manifest = await response.json();
        if (
          manifest.name !== "The Department of Misplaced Hours" ||
          manifest.short_name !== "Misplaced Hours" ||
          manifest.start_url !== "./" ||
          manifest.scope !== "./" ||
          manifest.display !== "fullscreen" ||
          manifest.orientation !== "landscape" ||
          !manifest.icons?.some((icon) => icon.src === "./favicon.svg" && icon.type === "image/svg+xml")
        ) {
          throw new Error(`Live manifest content is incomplete: ${JSON.stringify(manifest)}`);
        }
      }
    },
    {
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
      }
    },
    {
      label: "sitemap",
      url: new URL("sitemap.xml", baseUrl),
      assert: async (response) => {
        const sitemap = await response.text();
        if (!sitemap.includes("<urlset") || !sitemap.includes("https://nocoderrandom.github.io/department-of-misplaced-hours/")) {
          throw new Error(`Live sitemap.xml content is incomplete: ${sitemap}`);
        }
      }
    }
  ];

  for (const check of checks) {
    check.url.searchParams.set("live-smoke", `${Date.now()}`);
    const response = await fetch(check.url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Live ${check.label} returned HTTP ${response.status} for ${check.url}`);
    }
    await check.assert(response);
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
  return { title, save };
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

const rawUrl = option("url", process.env.LIVE_GAME_URL ?? defaultUrl);
const retries = Number.parseInt(option("retries", process.env.LIVE_SMOKE_RETRIES ?? "6"), 10);
const delayMs = Number.parseInt(option("delay-ms", process.env.LIVE_SMOKE_DELAY_MS ?? "10000"), 10);
let lastError;
let passed = false;

for (let attempt = 1; attempt <= retries; attempt += 1) {
  const url = cacheBustedUrl(rawUrl);
  let browser;
  try {
    await assertLiveHtml(url);
    await assertPublicMetadata(rawUrl);
    browser = await chromium.launch({ headless: true });
    const playable = await smokePlayable(browser, url);
    const noScript = await smokeNoScript(browser, url);
    console.log(JSON.stringify({ ok: true, url: rawUrl, attempts: attempt, playable, noScript }, null, 2));
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
