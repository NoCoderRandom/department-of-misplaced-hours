import { createServer } from "node:http";
import { createReadStream, promises as fs } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { chromium } from "playwright";

const GAME_W = 1200;
const GAME_H = 800;
const DIST_ROOT = resolve("dist");
const OUT_DIR = resolve("tmp", "visual-audit");
const SAVE_KEY = "department-misplaced-hours-save-v1";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".ogg", "audio/ogg"],
  [".txt", "text/plain; charset=utf-8"]
]);

await fs.rm(OUT_DIR, { recursive: true, force: true });
await fs.mkdir(OUT_DIR, { recursive: true });

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
    const filePath = normalize(join(DIST_ROOT, pathname));
    if (filePath !== DIST_ROOT && !filePath.startsWith(`${DIST_ROOT}${sep}`)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) {
      throw new Error("Not a file");
    }

    response.writeHead(200, { "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream" });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

const listen = () => new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
await listen();

const { port } = server.address();
const baseUrl = `http://127.0.0.1:${port}/`;
const browser = await chromium.launch();
const seriousLogs = [];
const results = [];

const browserWarningAllowed = (message) => message.includes("CONTEXT_LOST_WEBGL");

const clickGame = async (page, gameX, gameY) => {
  const rect = await page.locator("canvas").boundingBox();
  if (!rect) {
    throw new Error("Missing Phaser canvas");
  }
  await page.mouse.click(rect.x + (gameX / GAME_W) * rect.width, rect.y + (gameY / GAME_H) * rect.height);
};

const moveGame = async (page, gameX, gameY) => {
  const rect = await page.locator("canvas").boundingBox();
  if (!rect) {
    throw new Error("Missing Phaser canvas");
  }
  await page.mouse.move(rect.x + (gameX / GAME_W) * rect.width, rect.y + (gameY / GAME_H) * rect.height);
};

const recordBrowserLogs = (page) => {
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "error" || (message.type() === "warning" && !browserWarningAllowed(text))) {
      seriousLogs.push(`${message.type()}: ${text}`);
    }
  });
  page.on("pageerror", (error) => seriousLogs.push(`pageerror: ${error.message}`));
};

const openStartedPage = async (viewport) => {
  const page = await browser.newPage({ viewport });
  recordBrowserLogs(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 15000 });
  await clickGame(page, 600, 390);
  await page.locator(".game-modal-panel").waitFor({ state: "visible", timeout: 15000 });
  return page;
};

const openSavedPage = async (viewport, saveData) => {
  const page = await browser.newPage({ viewport });
  recordBrowserLogs(page);
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.evaluate(
    ({ saveKey, data }) => {
      localStorage.setItem(saveKey, JSON.stringify(data));
    },
    { saveKey: SAVE_KEY, data: saveData }
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 15000 });
  await clickGame(page, 600, 462);
  await page.waitForTimeout(350);
  return page;
};

const modalMetrics = async (page) =>
  page.evaluate(() => {
    const panel = document.querySelector(".game-modal-panel");
    const title = document.querySelector(".game-modal-title");
    const body = document.querySelector(".game-modal-body");
    const button = document.querySelector(".game-modal-button");
    if (!(panel instanceof HTMLElement) || !(title instanceof HTMLElement) || !(body instanceof HTMLElement) || !(button instanceof HTMLElement)) {
      return null;
    }

    const panelRect = panel.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const bodyStyle = getComputedStyle(body);
    const buttonStyle = getComputedStyle(button);
    const buttons = [...panel.querySelectorAll(".game-modal-button")].filter((element) => element instanceof HTMLElement);
    const checkedElements = [title, body, ...panel.querySelectorAll(".game-modal-actions, .game-modal-button")].filter(
      (element) => element instanceof HTMLElement
    );
    const minChildLeft = Math.min(...checkedElements.map((element) => element.getBoundingClientRect().left));
    const maxChildRight = Math.max(...checkedElements.map((element) => element.getBoundingClientRect().right));
    const buttonTextOverflowing = buttons.some(
      (element) => element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2
    );
    const verticalOverflowing = panel.scrollHeight > panel.clientHeight + 2 || body.scrollHeight > body.clientHeight + 2;
    const horizontalOverflowing =
      panelRect.left < -2 ||
      panelRect.right > window.innerWidth + 2 ||
      minChildLeft < panelRect.left - 2 ||
      maxChildRight > panelRect.right + 2;
    const viewportOverflowing = panelRect.top < -2 || panelRect.bottom > window.innerHeight + 2;

    return {
      panel: {
        w: Math.round(panelRect.width),
        h: Math.round(panelRect.height),
        scrollH: panel.scrollHeight,
        clientH: panel.clientHeight
      },
      title: {
        w: Math.round(titleRect.width),
        h: Math.round(titleRect.height)
      },
      body: {
        w: Math.round(bodyRect.width),
        h: Math.round(bodyRect.height),
        scrollH: body.scrollHeight,
        clientH: body.clientHeight,
        fontSize: bodyStyle.fontSize
      },
      button: {
        w: Math.round(buttonRect.width),
        h: Math.round(buttonRect.height),
        fontSize: buttonStyle.fontSize
      },
      overflowing: verticalOverflowing || horizontalOverflowing || viewportOverflowing || buttonTextOverflowing,
      verticalOverflowing,
      horizontalOverflowing,
      viewportOverflowing,
      buttonTextOverflowing,
      bounds: {
        viewportW: Math.round(window.innerWidth),
        viewportH: Math.round(window.innerHeight),
        panelTop: Math.round(panelRect.top),
        panelBottom: Math.round(panelRect.bottom),
        panelLeft: Math.round(panelRect.left),
        panelRight: Math.round(panelRect.right),
        minChildLeft: Math.round(minChildLeft),
        maxChildRight: Math.round(maxChildRight)
      },
      focusedButton: document.activeElement instanceof HTMLButtonElement ? document.activeElement.textContent : null
    };
  });

const recordModal = async (page, label) => {
  const metrics = await modalMetrics(page);
  if (!metrics) {
    throw new Error(`Missing modal metrics for ${label}`);
  }
  results.push(`${label} ${JSON.stringify(metrics)}`);
  if (!metrics.focusedButton) {
    throw new Error(`Modal did not focus an action button in ${label}: ${JSON.stringify(metrics)}`);
  }
  if (metrics.overflowing) {
    throw new Error(`Modal text overflowed in ${label}: ${JSON.stringify(metrics)}`);
  }
};

const canvasRegionMetrics = async (page, region) =>
  page.evaluate(({ sampleRegion }) => {
    const canvas = document.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("Missing Phaser canvas for visual metrics.");
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("2D canvas context unavailable for visual metrics.");
    }

    const { x, y, w, h, step } = sampleRegion;
    let samples = 0;
    let bright = 0;
    let visible = 0;
    const buckets = new Set();
    const luminanceValues = [];

    for (let sampleY = y; sampleY <= y + h; sampleY += step) {
      for (let sampleX = x; sampleX <= x + w; sampleX += step) {
        const [r, g, b, a] = context.getImageData(sampleX, sampleY, 1, 1).data;
        samples += 1;
        if (a > 0) {
          visible += 1;
        }
        if (r + g + b > 245) {
          bright += 1;
        }
        buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
        luminanceValues.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
      }
    }

    const mean = luminanceValues.reduce((sum, value) => sum + value, 0) / luminanceValues.length;
    const variance = luminanceValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / luminanceValues.length;

    return {
      width: canvas.width,
      height: canvas.height,
      samples,
      visible,
      bright,
      uniqueBuckets: buckets.size,
      variance: Math.round(variance)
    };
  }, { sampleRegion: region });

const recordEnding = async (page, label) => {
  const title = await canvasRegionMetrics(page, { x: 250, y: 80, w: 700, h: 85, step: 12 });
  const body = await canvasRegionMetrics(page, { x: 200, y: 175, w: 800, h: 165, step: 12 });
  const buttons = await canvasRegionMetrics(page, { x: 395, y: 575, w: 450, h: 85, step: 10 });
  const metrics = { title, body, buttons };
  results.push(`${label} ${JSON.stringify(metrics)}`);

  for (const [regionName, region] of Object.entries(metrics)) {
    if (region.width !== GAME_W || region.height !== GAME_H) {
      throw new Error(`${label} ${regionName} canvas has wrong internal size: ${JSON.stringify(region)}`);
    }
    if (region.visible < region.samples || region.uniqueBuckets < 5 || region.variance < 24) {
      throw new Error(`${label} ${regionName} region lacks visible detail: ${JSON.stringify(region)}`);
    }
  }

  if (title.bright < 10 || body.bright < 10 || buttons.bright < 12) {
    throw new Error(`${label} ending text/buttons are not bright enough to read: ${JSON.stringify(metrics)}`);
  }
};

const assertDenseModalKeyboard = async (page, label) => {
  const initialFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (initialFocus !== "1") {
    throw new Error(`${label} did not focus the first keypad button; focused ${initialFocus || "nothing"}.`);
  }
  await page.keyboard.press("Shift+Tab");
  const wrappedFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (wrappedFocus !== "Leave") {
    throw new Error(`${label} did not wrap Shift+Tab to Leave; focused ${wrappedFocus || "nothing"}.`);
  }
  await page.keyboard.press("Tab");
  const returnedFocus = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (returnedFocus !== "1") {
    throw new Error(`${label} did not wrap Tab back to 1; focused ${returnedFocus || "nothing"}.`);
  }
  await page.keyboard.press("Escape");
  await page.locator(".game-modal-panel").waitFor({ state: "detached", timeout: 5000 });
};

try {
  const desktop = await openStartedPage({ width: 1536, height: 1000 });
  await desktop.screenshot({ path: join(OUT_DIR, "desktop-welcome-modal.png"), fullPage: true });
  await recordModal(desktop, "desktop welcome");
  await desktop.keyboard.press("Escape");
  await desktop.locator(".game-modal-panel").waitFor({ state: "detached", timeout: 5000 });
  await moveGame(desktop, 590, 660);
  await desktop.waitForTimeout(250);
  const hoverCursor = await desktop.locator("canvas").evaluate((canvas) => getComputedStyle(canvas).cursor);
  if (!hoverCursor.includes("pointer")) {
    throw new Error(`Expected hover target to show pointer cursor, got ${hoverCursor || "default"}.`);
  }
  results.push(`desktop hover cursor ${hoverCursor}`);
  await desktop.screenshot({ path: join(OUT_DIR, "desktop-hover-stamp.png"), fullPage: true });
  await clickGame(desktop, 816, 32);
  await desktop.locator(".game-modal-panel").waitFor({ state: "visible", timeout: 5000 });
  await desktop.screenshot({ path: join(OUT_DIR, "desktop-help-normal.png"), fullPage: true });
  await recordModal(desktop, "desktop help normal");
  await desktop.getByRole("button", { name: "Large Text" }).click();
  await desktop.waitForTimeout(250);
  await desktop.screenshot({ path: join(OUT_DIR, "desktop-help-large.png"), fullPage: true });
  await recordModal(desktop, "desktop help large");
  await desktop.close();

  const mobile = await openStartedPage({ width: 390, height: 844 });
  await mobile.screenshot({ path: join(OUT_DIR, "mobile-welcome-modal.png"), fullPage: true });
  await recordModal(mobile, "mobile welcome");
  await mobile.keyboard.press("Escape");
  await mobile.locator(".game-modal-panel").waitFor({ state: "detached", timeout: 5000 });
  await clickGame(mobile, 816, 32);
  await mobile.locator(".game-modal-panel").waitFor({ state: "visible", timeout: 5000 });
  await mobile.screenshot({ path: join(OUT_DIR, "mobile-help-normal.png"), fullPage: true });
  await recordModal(mobile, "mobile help normal");
  await mobile.getByRole("button", { name: "Large Text" }).click();
  await mobile.waitForTimeout(250);
  await mobile.screenshot({ path: join(OUT_DIR, "mobile-help-large.png"), fullPage: true });
  await recordModal(mobile, "mobile help large");
  await mobile.close();

  const vendingState = {
    room: "break",
    inventory: ["visitorBadge", "stampedForm", "timeToken", "paperCup", "misfiledFolder", "mirrorShard", "selfFile"],
    flags: {
      introSeen: true,
      formStamped: true,
      clockUnlocked: true,
      clockSolved: true,
      archiveSolved: true,
      glassCaseCollected: true,
      heardPhone: true
    },
    audioVolume: 0.72,
    muted: false,
    largeText: false,
    reducedMotion: true
  };
  const vendingScenarios = [
    { label: "mobile vending keypad normal", viewport: { width: 390, height: 844 }, largeText: false, file: "mobile-vending-keypad-normal.png" },
    { label: "mobile vending keypad large", viewport: { width: 390, height: 844 }, largeText: true, file: "mobile-vending-keypad-large.png" },
    { label: "short mobile vending keypad large", viewport: { width: 390, height: 640 }, largeText: true, file: "short-mobile-vending-keypad-large.png" },
    { label: "small short mobile vending keypad large", viewport: { width: 360, height: 568 }, largeText: true, file: "small-short-mobile-vending-keypad-large.png" }
  ];

  for (const scenario of vendingScenarios) {
    const page = await openSavedPage(scenario.viewport, { ...vendingState, largeText: scenario.largeText });
    await clickGame(page, 854, 396);
    await page.locator(".game-modal-panel").waitFor({ state: "visible", timeout: 5000 });
    await page.screenshot({ path: join(OUT_DIR, scenario.file), fullPage: true });
    await recordModal(page, scenario.label);
    await assertDenseModalKeyboard(page, scenario.label);
    await page.close();
  }

  const endingBaseState = {
    room: "mirror",
    inventory: ["visitorBadge", "stampedForm", "auditWarrant", "selfFile", "memoryCup"],
    flags: {
      introSeen: true,
      formStamped: true,
      clockUnlocked: true,
      clockSolved: true,
      evidenceSafeOpened: true,
      archiveSolved: true,
      glassCaseCollected: true,
      vendingSolved: true,
      mirrorShardInstalled: true,
      fuseInstalled: true,
      identityVerified: true,
      hourVerified: true,
      mirrorClueSeen: true,
      serverSolved: true
    },
    audioVolume: 0.72,
    muted: false,
    largeText: false,
    reducedMotion: true
  };
  const endingScenarios = [
    { label: "desktop filed ending", viewport: { width: 1536, height: 1000 }, ending: "filed", file: "desktop-ending-filed.png" },
    { label: "desktop escaped ending", viewport: { width: 1536, height: 1000 }, ending: "escaped", file: "desktop-ending-escaped.png" },
    { label: "desktop audit ending", viewport: { width: 1536, height: 1000 }, ending: "audited", file: "desktop-ending-audit.png" },
    { label: "mobile escaped ending", viewport: { width: 390, height: 844 }, ending: "escaped", file: "mobile-ending-escaped.png" }
  ];

  for (const scenario of endingScenarios) {
    const page = await openSavedPage(scenario.viewport, { ...endingBaseState, ending: scenario.ending });
    await page.screenshot({ path: join(OUT_DIR, scenario.file), fullPage: true });
    await recordEnding(page, scenario.label);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

if (seriousLogs.length > 0) {
  throw new Error(`Visual audit browser errors:\n${seriousLogs.join("\n")}`);
}

console.log(`Visual audit passed. Screenshots written to ${OUT_DIR}`);
console.log(results.join("\n"));
