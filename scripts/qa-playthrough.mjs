import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const PREVIEW_MODE = process.argv.includes("--preview");
const PORT = PREVIEW_MODE ? 5180 : 5179;
const APP_URL = `http://${HOST}:${PORT}/`;
const SAVE_KEY = "department-misplaced-hours-save-v1";
const PREFERENCES_KEY = "department-misplaced-hours-preferences-v1";
const GAME_W = 1200;
const GAME_H = 800;

async function waitForServer(server) {
  const deadline = Date.now() + 30_000;
  let lastError;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      throw new Error(`Vite exited before QA could start with code ${server.exitCode}.`);
    }
    try {
      const response = await fetch(APP_URL);
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Timed out waiting for ${APP_URL}: ${lastError?.message ?? "unknown error"}`);
}

async function launchBrowser() {
  if (process.env.PLAYWRIGHT_CHROME_PATH) {
    return chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROME_PATH });
  }
  return chromium.launch({ headless: true });
}

function watchPage(page, issues, label) {
  page.on("console", (message) => {
    const text = message.text();
    if (message.type() === "warning" && text.includes("AudioContext was not allowed to start")) {
      return;
    }
    if (message.type() === "debug" && text.startsWith("[vite]")) {
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

async function click(page, x, y, wait = 140) {
  const point = await page.evaluate(
    ({ gameX, gameY, gameW, gameH }) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        throw new Error("Canvas not found for game-coordinate click.");
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + (gameX / gameW) * rect.width,
        y: rect.top + (gameY / gameH) * rect.height
      };
    },
    { gameX: x, gameY: y, gameW: GAME_W, gameH: GAME_H }
  );
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(wait);
}

async function move(page, x, y, wait = 120) {
  const point = await page.evaluate(
    ({ gameX, gameY, gameW, gameH }) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        throw new Error("Canvas not found for game-coordinate move.");
      }
      const rect = canvas.getBoundingClientRect();
      return {
        x: rect.left + (gameX / gameW) * rect.width,
        y: rect.top + (gameY / gameH) * rect.height
      };
    },
    { gameX: x, gameY: y, gameW: GAME_W, gameH: GAME_H }
  );
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(wait);
}

async function expectCanvasCursor(page, expected, label) {
  const cursor = await page.locator("canvas").evaluate((canvas) => getComputedStyle(canvas).cursor || "default");
  const isPointer = cursor.includes("pointer");
  if (expected === "pointer" && !isPointer) {
    throw new Error(`${label} did not show a hand cursor; cursor=${cursor}`);
  }
  if (expected === "default" && isPointer) {
    throw new Error(`${label} showed a hand cursor on empty space; cursor=${cursor}`);
  }
}

async function button(page, name, timeout = 8_000) {
  await page.getByRole("button", { name }).click({ timeout });
  await page.waitForTimeout(100);
}

async function expectLeadingButtonOrderNot(page, forbiddenOrder, label) {
  const labels = await page.locator(".game-modal-button").evaluateAll((buttons) =>
    buttons.map((button) => button.textContent?.trim() ?? "").filter(Boolean)
  );
  const actual = labels.slice(0, forbiddenOrder.length);
  if (JSON.stringify(actual) === JSON.stringify(forbiddenOrder)) {
    throw new Error(`${label} buttons are displayed in solution order: ${actual.join(" -> ")}`);
  }
}

async function pressTab(page, count = 1) {
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(70);
  }
}

async function pressGamepadButton(page, index, hold = 120) {
  await page.evaluate(
    ({ buttonIndex }) => {
      const pad = window.__qaGamepad;
      if (!pad) {
        throw new Error("QA gamepad was not installed.");
      }
      pad.buttons[buttonIndex].pressed = true;
      pad.buttons[buttonIndex].value = 1;
      pad.timestamp = performance.now();
    },
    { buttonIndex: index }
  );
  await page.waitForTimeout(hold);
  await page.evaluate(
    ({ buttonIndex }) => {
      const pad = window.__qaGamepad;
      pad.buttons[buttonIndex].pressed = false;
      pad.buttons[buttonIndex].value = 0;
      pad.timestamp = performance.now();
    },
    { buttonIndex: index }
  );
  await page.waitForTimeout(170);
}

async function installQaGamepad(page) {
  await page.addInitScript(() => {
    const state = {
      buttons: Array.from({ length: 16 }, () => ({ pressed: false, value: 0 })),
      axes: [0, 0, 0, 0],
      timestamp: 0
    };
    const pad = {
      id: "QA Standard Gamepad",
      index: 0,
      connected: true,
      mapping: "standard",
      buttons: state.buttons,
      axes: state.axes,
      timestamp: 0
    };
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => {
        pad.timestamp = state.timestamp;
        return [pad, null, null, null];
      }
    });
    window.__qaGamepad = state;
  });
}

async function expectCanvasPainted(page, label) {
  const metrics = await page.evaluate(
    ({ gameW, gameH }) => {
      const canvas = document.querySelector("canvas");
      if (!canvas) {
        throw new Error("Canvas not found for paint check.");
      }
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("2D canvas context unavailable for paint check.");
      }

      const xs = [80, 200, 340, 500, 660, 820, 980, 1120];
      const ys = [92, 180, 300, 420, 560, 690];
      const luminanceValues = [];
      const buckets = new Set();
      let visible = 0;
      let bright = 0;

      for (const y of ys) {
        for (const x of xs) {
          const pixel = context.getImageData(x, y, 1, 1).data;
          const [r, g, b, a] = pixel;
          if (a > 0) {
            visible += 1;
          }
          if (r + g + b > 45) {
            bright += 1;
          }
          buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
          luminanceValues.push(0.2126 * r + 0.7152 * g + 0.0722 * b);
        }
      }

      const mean = luminanceValues.reduce((sum, value) => sum + value, 0) / luminanceValues.length;
      const variance =
        luminanceValues.reduce((sum, value) => sum + (value - mean) ** 2, 0) / luminanceValues.length;

      return {
        width: canvas.width,
        height: canvas.height,
        expectedWidth: gameW,
        expectedHeight: gameH,
        samples: luminanceValues.length,
        visible,
        bright,
        uniqueBuckets: buckets.size,
        variance
      };
    },
    { gameW: GAME_W, gameH: GAME_H }
  );

  if (metrics.width !== metrics.expectedWidth || metrics.height !== metrics.expectedHeight) {
    throw new Error(`${label} canvas has wrong internal size: ${JSON.stringify(metrics)}`);
  }
  if (metrics.visible < metrics.samples || metrics.bright < 8 || metrics.uniqueBuckets < 8 || metrics.variance < 60) {
    throw new Error(`${label} canvas appears blank or too uniform: ${JSON.stringify(metrics)}`);
  }
}

async function expectCanvasAccessibility(page, label) {
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
    attrs.keyShortcuts !== "Tab Shift+Tab Enter Space ArrowLeft ArrowRight ArrowUp ArrowDown M N H F1 S" ||
    !attrs.summaryText.includes("Tab and Shift+Tab") ||
    !attrs.summaryText.includes("Enter or Space") ||
    !attrs.summaryText.includes("Arrow keys move between modal buttons") ||
    !attrs.summaryText.includes("F1 for Help")
  ) {
    throw new Error(`${label} canvas accessibility attributes are incomplete: ${JSON.stringify(attrs)}`);
  }
}

async function expectFailureScreenPainted(page) {
  const metrics = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Canvas not found for asset failure paint check.");
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("2D canvas context unavailable for asset failure paint check.");
    }
    const points = [
      [600, 248],
      [600, 392],
      [600, 610],
      [210, 400],
      [990, 400],
      [600, 190]
    ];
    const buckets = new Set();
    let visible = 0;
    let bright = 0;
    for (const [x, y] of points) {
      const [r, g, b, a] = context.getImageData(x, y, 1, 1).data;
      if (a > 0) {
        visible += 1;
      }
      if (r + g + b > 120) {
        bright += 1;
      }
      buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      visible,
      bright,
      uniqueBuckets: buckets.size
    };
  });
  if (metrics.width !== GAME_W || metrics.height !== GAME_H) {
    throw new Error(`Asset failure canvas has wrong internal size: ${JSON.stringify(metrics)}`);
  }
  if (metrics.visible < 6 || metrics.bright < 1 || metrics.uniqueBuckets < 2) {
    throw new Error(`Asset failure screen does not appear visibly painted: ${JSON.stringify(metrics)}`);
  }
}

async function canvasFingerprint(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Canvas not found for fingerprint.");
    }
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      throw new Error("2D canvas context unavailable for fingerprint.");
    }
    const points = [
      [90, 120],
      [220, 240],
      [360, 360],
      [500, 520],
      [650, 180],
      [780, 420],
      [940, 600],
      [1100, 300]
    ];
    return points
      .map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data).join(","))
      .join("|");
  });
}

async function modalMetrics(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".game-modal-panel");
    const body = document.querySelector(".game-modal-body");
    const button = document.querySelector(".game-modal-button");
    if (!panel || !body || !button) {
      throw new Error("Modal metrics requested without a visible modal.");
    }
    const panelRect = panel.getBoundingClientRect();
    const bodyRect = body.getBoundingClientRect();
    return {
      bodyFont: Number.parseFloat(getComputedStyle(body).fontSize),
      buttonFont: Number.parseFloat(getComputedStyle(button).fontSize),
      panelTop: panelRect.top,
      panelBottom: panelRect.bottom,
      panelLeft: panelRect.left,
      panelRight: panelRect.right,
      bodyTop: bodyRect.top,
      bodyBottom: bodyRect.bottom,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      bodyClass: document.body.className,
      bodyScrollHeight: body.scrollHeight,
      bodyClientHeight: body.clientHeight
    };
  });
}

function expectModalInsideViewport(metrics, label) {
  if (
    metrics.panelTop < -1 ||
    metrics.panelLeft < -1 ||
    metrics.panelRight > metrics.viewportW + 1 ||
    metrics.panelBottom > metrics.viewportH + 1 ||
    metrics.bodyTop < metrics.panelTop - 1 ||
    metrics.bodyBottom > metrics.panelBottom + 1
  ) {
    throw new Error(`${label} modal escapes viewport or panel: ${JSON.stringify(metrics)}`);
  }
}

async function save(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY);
}

async function preferences(page) {
  return page.evaluate((key) => JSON.parse(localStorage.getItem(key)), PREFERENCES_KEY);
}

async function clearGameStorage(page) {
  await page.evaluate(
    ({ saveKey, preferencesKey }) => {
      localStorage.removeItem(saveKey);
      localStorage.removeItem(preferencesKey);
    },
    { saveKey: SAVE_KEY, preferencesKey: PREFERENCES_KEY }
  );
}

async function seedSave(page, data) {
  await page.evaluate(
    ({ saveKey, preferencesKey, value }) => {
      localStorage.setItem(saveKey, JSON.stringify(value));
      localStorage.setItem(
        preferencesKey,
        JSON.stringify({
          audioVolume: typeof value.audioVolume === "number" ? value.audioVolume : 0.72,
          muted: value.muted === true,
          largeText: value.largeText === true,
          reducedMotion: value.reducedMotion === true
        })
      );
    },
    { saveKey: SAVE_KEY, preferencesKey: PREFERENCES_KEY, value: data }
  );
}

async function selectItem(page, itemId) {
  const data = await save(page);
  const index = data.inventory.indexOf(itemId);
  if (index < 0) {
    throw new Error(`Inventory missing ${itemId}; has ${data.inventory.join(", ")}`);
  }
  const len = data.inventory.length;
  const first = len > 10 ? 64 : 116;
  const gap = len <= 1 ? 96 : Math.min(96, (GAME_W - 64 - first) / (len - 1));
  await click(page, first + index * gap, 752);
}

async function mapTo(page, name) {
  await click(page, 548, 32);
  await button(page, name);
  await expectCanvasPainted(page, `map destination ${name}`);
}

async function continueSaved(page, data) {
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(page);
  await seedSave(page, data);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(650);
  await expectCanvasPainted(page, "seeded continue title");
  await click(page, 600, 462);
  await page.waitForTimeout(400);
  await expectCanvasPainted(page, `seeded continue room ${data.room}`);
  return save(page);
}

async function reloadAndContinue(page, label) {
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(650);
  await expectCanvasPainted(page, `reload title ${label}`);
  await click(page, 600, 462);
  await page.waitForTimeout(400);
  await expectCanvasPainted(page, `reload room ${label}`);
  const data = await save(page);
  if (!data) {
    throw new Error(`Reload checkpoint ${label} did not restore a save.`);
  }
  return data;
}

function expectInventory(data, items, label) {
  for (const item of items) {
    if (!data.inventory.includes(item)) {
      throw new Error(`${label} missing ${item}: ${JSON.stringify(data)}`);
    }
  }
}

async function startNew(page) {
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await expectCanvasAccessibility(page, "new game");
  await page.waitForTimeout(750);
  if ((await page.locator("#boot-screen").count()) !== 0) {
    throw new Error("Boot screen was not removed after Phaser startup.");
  }
  await expectCanvasPainted(page, "title screen");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await click(page, 600, 390, 300);
    if (await page.getByRole("button", { name: "Clock In" }).count()) {
      const preClockIn = await save(page);
      if (preClockIn?.inventory?.includes("visitorBadge") || preClockIn?.flags?.introSeen) {
        throw new Error(`New shift granted intro rewards before Clock In: ${JSON.stringify(preClockIn)}`);
      }
      await button(page, "Clock In");
      await page.waitForFunction(() => !document.querySelector(".game-modal-panel"), null, { timeout: 8_000 });
      await expectCanvasPainted(page, "reception");
      return;
    }
  }
  throw new Error("Could not start a new shift from the title screen.");
}

async function testIntroBadgeRecovery(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "intro-badge-recovery");
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await expectCanvasPainted(page, "intro badge recovery title");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await click(page, 600, 390, 300);
    if (await page.getByRole("button", { name: "Clock In" }).count()) {
      break;
    }
  }
  await page.getByRole("button", { name: "Clock In" }).waitFor({ state: "visible", timeout: 8_000 });
  const preClockIn = await save(page);
  if (preClockIn?.inventory?.includes("visitorBadge") || preClockIn?.flags?.introSeen) {
    throw new Error(`Intro recovery setup granted badge before Clock In: ${JSON.stringify(preClockIn)}`);
  }

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".game-modal-panel"), null, { timeout: 8_000 });
  const escapedIntro = await save(page);
  if (escapedIntro?.inventory?.includes("visitorBadge") || escapedIntro?.flags?.introSeen) {
    throw new Error(`Escaping intro granted badge or intro flag: ${JSON.stringify(escapedIntro)}`);
  }

  await click(page, 456, 430);
  await page.getByText("second chance").waitFor({ state: "visible", timeout: 8_000 });
  const recoveredBadge = await save(page);
  if (!recoveredBadge?.inventory?.includes("visitorBadge")) {
    throw new Error(`Badge drawer recovery did not grant Visitor Badge: ${JSON.stringify(recoveredBadge)}`);
  }
  await button(page, "Close");
  await page.close();
}

async function testAssetLoadFailure(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/assets/images/title-department.webp", (route) => route.abort("failed"));
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForFunction(
    () => document.getElementById("game")?.getAttribute("data-load-state") === "asset-failed-visible",
    null,
    { timeout: 8_000 }
  );
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      })
  );
  if ((await page.locator("#boot-screen").count()) !== 0) {
    throw new Error("Boot screen stayed visible after an asset load failure.");
  }
  const loadError = await page.evaluate(() => document.getElementById("game")?.getAttribute("data-load-error") ?? "");
  if (!loadError.includes("bg-title")) {
    throw new Error(`Asset failure did not identify the missing title image: ${loadError}`);
  }
  await expectFailureScreenPainted(page);
  if (pageErrors.length > 0) {
    throw new Error(`Asset failure screen produced page errors:\n${pageErrors.join("\n")}`);
  }
  await page.close();
}

async function testOptionalAudioLoadFailure(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/assets/audio/ui/click.ogg", (route) => route.abort("failed"));
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(750);
  if ((await page.locator("#boot-screen").count()) !== 0) {
    throw new Error("Boot screen stayed visible after optional audio failed.");
  }
  const loadState = await page.evaluate(() => document.getElementById("game")?.getAttribute("data-load-state") ?? "");
  if (loadState.includes("asset-failed")) {
    throw new Error(`Optional audio failure incorrectly entered fatal load state: ${loadState}`);
  }
  const warning = await page.evaluate(() => document.getElementById("game")?.getAttribute("data-audio-load-warning") ?? "");
  if (!warning.includes("sfx-click")) {
    throw new Error(`Optional audio failure was not recorded for diagnostics: ${warning}`);
  }
  await expectCanvasPainted(page, "title with missing optional click audio");
  await click(page, 600, 390);
  await button(page, "Clock In");
  await expectCanvasPainted(page, "new game with missing optional click audio");
  if (pageErrors.length > 0) {
    throw new Error(`Optional audio fallback produced page errors:\n${pageErrors.join("\n")}`);
  }
  await page.close();
}

async function testNoScriptFallback(browser, issues) {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  watchPage(page, issues, "noscript-fallback");
  try {
    await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
    const fallback = page.getByRole("alert");
    await fallback.waitFor({ state: "visible", timeout: 8_000 });
    const text = (await fallback.textContent())?.replace(/\s+/g, " ").trim();
    if (
      !text?.includes("needs JavaScript enabled") ||
      !text.includes("static web game") ||
      !text.includes("does not require a backend server")
    ) {
      throw new Error(`No-JavaScript fallback copy is incomplete: ${JSON.stringify(text)}`);
    }
    if ((await page.locator("canvas").count()) !== 0) {
      throw new Error("No-JavaScript page unexpectedly created a canvas.");
    }
  } finally {
    await context.close();
  }
}

async function solveIntroAndClock(page, options = {}) {
  await startNew(page);
  if (options.phone) {
    await click(page, 875, 635);
    await button(page, "Close");
  }
  await click(page, 226, 650);
  await click(page, 590, 660);
  await click(page, 590, 660);
  await button(page, "Accept");
  await selectItem(page, "stampedForm");
  await click(page, 360, 374);
  await expectCanvasPainted(page, "clock hall");
  await click(page, 610, 274);
  await page.getByText("The clocks refuse blind calibration.").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Close");
  await click(page, 936, 314);
  await button(page, "Close");
  await click(page, 610, 274);
  await page.getByText("The clocks refuse blind calibration.").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Close");
  await click(page, 604, 662);
  await expectCanvasPainted(page, "reception before clock memo");
  await click(page, 706, 656);
  await button(page, "Close");
  await mapTo(page, "Clock Hall");
  await click(page, 610, 274);
  await expectLeadingButtonOrderNot(page, ["Regret", "Hunger", "Calm", "Joy"], "Mood Clocks");
  await button(page, "Review Clue");
  await page.getByText("Reception Memo: Regret knocks first.").waitFor({ state: "visible", timeout: 8_000 });
  await page.getByText("Personnel Calendar: Paperwork makes the building hungry.").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Back");
  for (const answer of ["Joy", "Regret", "Hunger", "Calm"]) {
    await button(page, answer);
  }
  await button(page, "Try Again");
  for (const answer of ["Regret", "Hunger", "Calm", "Joy"]) {
    await button(page, answer);
  }
  await button(page, "Continue");
}

async function getWarrant(page, exerciseRewardEscape = false) {
  await click(page, 768, 492);
  await expectCanvasPainted(page, "security office");
  await click(page, 200, 386);
  await button(page, "Close");
  await selectItem(page, "visitorBadge");
  await click(page, 696, 352);
  if (exerciseRewardEscape) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const escapedKeyData = await save(page);
    if (escapedKeyData.inventory.includes("securityKey")) {
      throw new Error("Security key was granted before Take Key.");
    }
    await click(page, 696, 352);
  }
  await button(page, "Take Key");
  await selectItem(page, "securityKey");
  await click(page, 522, 392);
  if (exerciseRewardEscape) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const escapedWarrantData = await save(page);
    if (escapedWarrantData.inventory.includes("auditWarrant") || escapedWarrantData.flags.evidenceSafeOpened) {
      throw new Error("Audit warrant was granted before Take Warrant.");
    }
    await click(page, 522, 392);
  }
  await button(page, "Take Warrant");
}

async function getRainAndVending(page, exerciseRewardEscape = false) {
  await mapTo(page, "Interrogation");
  await click(page, 292, 300);
  if (exerciseRewardEscape) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const escapedRainData = await save(page);
    if (escapedRainData.inventory.includes("rainCipher")) {
      throw new Error("Rain Cipher was granted before Take Note.");
    }
    if (!escapedRainData.flags.rainCipherSeen) {
      throw new Error("Rain Window did not save seen state before Take Note.");
    }
    await click(page, 292, 300);
  }
  await button(page, "Take Note");
  await mapTo(page, "Break Room");
  await solveVending(page);
}

async function getPhoneAndVending(page, exerciseRewardEscape = false) {
  await mapTo(page, "Break Room");
  await solveVending(page, exerciseRewardEscape);
}

async function solveVending(page, exerciseRewardEscape = false) {
  await click(page, 398, 606);
  await click(page, 854, 396);
  for (const digit of ["1", "2", "3"]) {
    await button(page, digit);
  }
  await page.getByText("Incorrect code. The keypad clears.").waitFor({ state: "visible", timeout: 8_000 });
  if ((await page.getByText("Accessibility transcript: the groups count seven, three, one.").count()) !== 0) {
    throw new Error("Unmuted vending failure revealed the exact accessibility transcript.");
  }
  for (const digit of ["7", "3", "1"]) {
    await button(page, digit);
  }
  if (exerciseRewardEscape) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    const escapedVendingData = await save(page);
    if (escapedVendingData.flags.vendingSolved || escapedVendingData.inventory.includes("memoryCup")) {
      throw new Error("Vending rewards were granted before Take Them.");
    }
    await click(page, 854, 396);
    for (const digit of ["7", "3", "1"]) {
      await button(page, digit);
    }
  }
  await button(page, "Take Them");
}

async function finishFinalAct(page, identityItem, endingItem) {
  await mapTo(page, "Mirror Office");
  await selectItem(page, "mirrorShard");
  await click(page, 334, 346);
  await button(page, "Continue");
  await selectItem(page, "serverFuse");
  await click(page, 858, 438);
  await button(page, "Continue");
  await selectItem(page, identityItem);
  await click(page, 612, 596);
  await button(page, "Continue");
  await selectItem(page, "memoryCup");
  await click(page, 612, 596);
  await button(page, "Answer");
  await expectLeadingButtonOrderNot(
    page,
    ["The clerk holding the file.", "The vending machine.", "No one. This is normal."],
    "Auditor identity question"
  );
  await button(page, "The clerk holding the file.");
  await expectLeadingButtonOrderNot(page, ["Seven-three-one.", "One-three-seven.", "Twelve sharp."], "Auditor clue question");
  await button(page, "Seven-three-one.");
  await expectLeadingButtonOrderNot(
    page,
    ["Outside the system.", "In the microwave.", "Under management review."],
    "Auditor impossible-hour question"
  );
  await button(page, "Outside the system.");
  await button(page, "Proceed");
  await click(page, 858, 438);
  await expectLeadingButtonOrderNot(page, ["Circle", "Triangle", "Eye", "Square"], "Server Console");
  for (const answer of ["Eye", "Circle", "Triangle", "Square"]) {
    await button(page, answer);
  }
  await button(page, "Try Again");
  for (const answer of ["Circle", "Triangle", "Eye", "Square"]) {
    await button(page, answer);
  }
  await button(page, "Continue");
  await selectItem(page, endingItem);
  await click(page, 1080, 386);
  await page.waitForTimeout(350);
  await expectCanvasPainted(page, `ending ${endingItem}`);
}

async function playSecurityOverrideRoute(page) {
  await solveIntroAndClock(page, { phone: true });
  await getWarrant(page, true);
  let checkpoint = await reloadAndContinue(page, "after warrant");
  if (checkpoint.room !== "security" || !checkpoint.inventory.includes("auditWarrant")) {
    throw new Error(`Reload after warrant lost progress: ${JSON.stringify(checkpoint)}`);
  }
  await click(page, 1060, 682);
  await selectItem(page, "auditWarrant");
  await click(page, 356, 420);
  await button(page, "Continue");
  await click(page, 706, 394);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const escapedGlassData = await save(page);
  if (escapedGlassData.flags.glassCaseCollected || escapedGlassData.inventory.includes("mirrorShard")) {
    throw new Error("Glass case rewards were granted before Take Them.");
  }
  await click(page, 706, 394);
  await button(page, "Take Them");
  await page.getByText("only your own record proves who is being corrected.").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Continue");
  checkpoint = await reloadAndContinue(page, "after glass case");
  expectInventory(checkpoint, ["misfiledFolder", "mirrorShard", "selfFile"], "reload after glass case");
  await click(page, 910, 558);
  await getPhoneAndVending(page, true);
  checkpoint = await reloadAndContinue(page, "after vending");
  expectInventory(checkpoint, ["memoryCup", "serverFuse"], "reload after vending");
  await finishFinalAct(page, "auditWarrant", "memoryCup");
  const data = await save(page);
  if (data.ending !== "escaped") {
    throw new Error(`Security override route did not save escaped ending: ${JSON.stringify(data)}`);
  }
  for (const flag of [
    "securityFootageSeen",
    "evidenceSafeOpened",
    "archiveSolved",
    "glassCaseCollected",
    "selfFileReviewed",
    "vendingSolved",
    "identityVerifiedByWarrant",
    "dialoguePassed",
    "serverSolved"
  ]) {
    if (!data.flags[flag]) {
      throw new Error(`Security override route missing flag ${flag}.`);
    }
  }
  if (!data.flags.heardPhone || data.inventory.includes("rainCipher")) {
    throw new Error(`Security override route did not stay on the phone-clue path: ${JSON.stringify(data)}`);
  }
}

async function playDeductionRoute(page) {
  await solveIntroAndClock(page);
  await getWarrant(page);
  await mapTo(page, "Archive");
  await click(page, 610, 646);
  await button(page, "Close");
  await click(page, 910, 558);
  await mapTo(page, "Break Room");
  await click(page, 304, 250);
  await button(page, "Close");
  await click(page, 398, 606);
  await click(page, 854, 396);
  await page.getByText("refuses to sell an hour to someone without a file").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Close");
  await mapTo(page, "Archive");
  await click(page, 356, 420);
  await expectLeadingButtonOrderNot(page, ["Triangle", "Circle", "Eye", "Square"], "Index Drawers");
  for (const answer of ["Triangle", "Circle", "Eye", "Square"]) {
    await button(page, answer);
  }
  await button(page, "Continue");
  await click(page, 706, 394);
  await button(page, "Take Them");
  await page.getByText("only your own record proves who is being corrected.").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Continue");
  await getRainAndVending(page, true);
  await finishFinalAct(page, "selfFile", "selfFile");
  const data = await save(page);
  if (data.ending !== "filed") {
    throw new Error(`Deduction route did not save filed ending: ${JSON.stringify(data)}`);
  }
  for (const flag of ["archiveTableSeen", "breakBoardSeen", "selfFileReviewed", "identityVerified", "hourVerified", "serverSolved"]) {
    if (!data.flags[flag]) {
      throw new Error(`Deduction route missing flag ${flag}.`);
    }
  }
}

async function testBadSaveAndMobile(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(page);
  await page.evaluate((key) => {
    localStorage.setItem(
      key,
      JSON.stringify({ room: "reception", inventory: ["visitorBadge"], flags: {}, audioVolume: "nope", muted: "false" })
    );
  }, SAVE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(650);
  await click(page, 600, 462);
  await page.waitForTimeout(400);
  const data = await save(page);
  if (data.audioVolume !== 0.72) {
    throw new Error(`Bad save volume was not normalized: ${data.audioVolume}`);
  }
  if (data.muted !== false) {
    throw new Error(`Bad save muted flag was not normalized: ${data.muted}`);
  }
  await page.close();

  const protectedStart = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await protectedStart.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(protectedStart);
  await seedSave(protectedStart, {
    room: "archive",
    inventory: ["visitorBadge", "stampedForm", "auditWarrant"],
    flags: { formStamped: true, clockUnlocked: true, clockSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  await protectedStart.reload({ waitUntil: "networkidle" });
  await protectedStart.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await protectedStart.waitForTimeout(650);
  await click(protectedStart, 600, 390);
  await protectedStart.getByRole("dialog", { name: "Start New Shift?" }).waitFor({ state: "visible", timeout: 8_000 });
  await protectedStart.waitForFunction(() => document.activeElement?.textContent === "Continue", null, { timeout: 8_000 });
  let protectedData = await save(protectedStart);
  if (protectedData.room !== "archive" || !protectedData.inventory.includes("auditWarrant")) {
    throw new Error(`Start New prompt wiped existing save before confirmation: ${JSON.stringify(protectedData)}`);
  }
  await protectedStart.keyboard.press("Escape");
  await protectedStart.waitForTimeout(200);
  protectedData = await save(protectedStart);
  if (protectedData.room !== "archive" || !protectedData.inventory.includes("auditWarrant")) {
    throw new Error(`Cancelling Start New did not preserve existing save: ${JSON.stringify(protectedData)}`);
  }
  await protectedStart.keyboard.press("Enter");
  await protectedStart.getByRole("dialog", { name: "Start New Shift?" }).waitFor({ state: "visible", timeout: 8_000 });
  await protectedStart.waitForFunction(() => document.activeElement?.textContent === "Continue", null, { timeout: 8_000 });
  protectedData = await save(protectedStart);
  if (protectedData.room !== "archive" || !protectedData.inventory.includes("auditWarrant")) {
    throw new Error(`Keyboard Start New prompt wiped existing save before confirmation: ${JSON.stringify(protectedData)}`);
  }
  await protectedStart.keyboard.press("Escape");
  await protectedStart.waitForTimeout(200);
  protectedData = await save(protectedStart);
  if (protectedData.room !== "archive" || !protectedData.inventory.includes("auditWarrant")) {
    throw new Error(`Cancelling keyboard Start New did not preserve existing save: ${JSON.stringify(protectedData)}`);
  }
  await protectedStart.close();

  const invalidRoom = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await invalidRoom.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(invalidRoom);
  await seedSave(invalidRoom, {
    room: "not-a-room",
    inventory: ["visitorBadge", "stampedForm", "auditWarrant"],
    flags: { formStamped: true, clockUnlocked: true, clockSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  await invalidRoom.reload({ waitUntil: "networkidle" });
  await invalidRoom.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await invalidRoom.waitForTimeout(650);
  await click(invalidRoom, 600, 462);
  await invalidRoom.waitForTimeout(400);
  const invalidRoomData = await save(invalidRoom);
  if (
    invalidRoomData.room !== "reception" ||
    !invalidRoomData.inventory.includes("auditWarrant") ||
    !invalidRoomData.flags.clockSolved
  ) {
    throw new Error(`Invalid-room save was not repaired without wiping progress: ${JSON.stringify(invalidRoomData)}`);
  }
  await invalidRoom.close();

  const corrupt = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await corrupt.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(corrupt);
  await corrupt.evaluate((key) => localStorage.setItem(key, "{not-json"), SAVE_KEY);
  await corrupt.reload({ waitUntil: "networkidle" });
  await corrupt.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await corrupt.waitForTimeout(650);
  await expectCanvasPainted(corrupt, "corrupt save title");
  await click(corrupt, 600, 462);
  await corrupt.getByText("That saved shift is corrupt or unavailable.").waitFor({ state: "visible", timeout: 8_000 });
  const corruptRawSave = await corrupt.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  if (corruptRawSave !== null) {
    throw new Error(`Corrupt save was not cleared after failed Continue: ${corruptRawSave}`);
  }
  await button(corrupt, "Close");
  await corrupt.waitForFunction(() => !document.querySelector(".game-modal-panel"), null, { timeout: 8_000 });
  await click(corrupt, 600, 462);
  if ((await corrupt.getByText("That saved shift is corrupt or unavailable.").count()) > 0) {
    throw new Error("Corrupt-save recovery left a stale Continue button on the title screen.");
  }
  await click(corrupt, 600, 390);
  await button(corrupt, "Clock In");
  await expectCanvasPainted(corrupt, "new game after corrupt save");
  await corrupt.close();

  const keyboardTitle = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await keyboardTitle.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(keyboardTitle);
  await keyboardTitle.reload({ waitUntil: "networkidle" });
  await keyboardTitle.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await keyboardTitle.waitForTimeout(650);
  await keyboardTitle.keyboard.press("Enter");
  await button(keyboardTitle, "Clock In");
  await expectCanvasPainted(keyboardTitle, "keyboard title start");
  await keyboardTitle.close();

  const blockedStorage = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  await blockedStorage.addInitScript(() => {
    const blocked = () => {
      throw new Error("localStorage blocked for QA");
    };
    Object.defineProperty(Storage.prototype, "getItem", { value: blocked });
    Object.defineProperty(Storage.prototype, "setItem", { value: blocked });
    Object.defineProperty(Storage.prototype, "removeItem", { value: blocked });
  });
  await blockedStorage.goto(APP_URL, { waitUntil: "networkidle" });
  await blockedStorage.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await blockedStorage.waitForTimeout(650);
  await expectCanvasPainted(blockedStorage, "blocked storage title");
  await click(blockedStorage, 600, 390);
  await button(blockedStorage, "Clock In");
  await blockedStorage.getByRole("dialog", { name: "Saves Unavailable" }).waitFor({ state: "visible", timeout: 8_000 });
  await button(blockedStorage, "Continue");
  await expectCanvasPainted(blockedStorage, "blocked storage new game");
  await blockedStorage.reload({ waitUntil: "networkidle" });
  await blockedStorage.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await blockedStorage.waitForTimeout(650);
  if ((await blockedStorage.getByRole("button", { name: "Continue Shift" }).count()) !== 0) {
    throw new Error("Blocked storage reload unexpectedly offered Continue Shift.");
  }
  await blockedStorage.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await mobile.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(mobile);
  await mobile.reload({ waitUntil: "networkidle" });
  await mobile.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await mobile.waitForTimeout(650);
  const rect = await mobile.evaluate(() => {
    const bounds = document.querySelector("canvas").getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, viewportWidth: innerWidth };
  });
  if (rect.x < -1 || rect.x + rect.width > rect.viewportWidth + 1) {
    throw new Error(`Mobile canvas is cropped horizontally: ${JSON.stringify(rect)}`);
  }
  await mobile.close();
}

async function testScaledInteraction(browser, issues) {
  const desktop = await browser.newPage({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
  watchPage(desktop, issues, "scaled-desktop");
  await solveIntroAndClock(desktop, { phone: true });
  await mapTo(desktop, "Security");
  await click(desktop, 200, 386);
  await button(desktop, "Close");
  const desktopData = await save(desktop);
  if (desktopData.room !== "security" || !desktopData.flags.clockSolved || !desktopData.flags.securityFootageSeen) {
    throw new Error(`Scaled desktop interaction failed: ${JSON.stringify(desktopData)}`);
  }
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  watchPage(mobile, issues, "scaled-mobile");
  await startNew(mobile);
  await click(mobile, 226, 650);
  let mobileData = await save(mobile);
  if (!mobileData.inventory.includes("blankForm")) {
    throw new Error(`Scaled mobile room click did not collect the blank form: ${JSON.stringify(mobileData)}`);
  }
  await click(mobile, 638, 32);
  await mobile.locator(".game-modal-panel").waitFor({ state: "visible", timeout: 8_000 });
  await mobile.keyboard.press("Escape");
  await mobile.waitForTimeout(250);
  if ((await mobile.locator(".game-modal-panel").count()) !== 0) {
    throw new Error("Scaled mobile Escape did not close the Notes panel.");
  }
  await mobile.close();
}

async function testHotspotCursorBehavior(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "hotspot-cursor");

  const roomStates = [
    {
      label: "reception stamp",
      target: [590, 660],
      save: {
        room: "reception",
        inventory: ["visitorBadge"],
        flags: { introSeen: true }
      }
    },
    {
      label: "clock mood clocks",
      target: [610, 274],
      save: {
        room: "clock",
        inventory: ["visitorBadge", "stampedForm"],
        flags: { introSeen: true, formStamped: true, clockUnlocked: true }
      }
    },
    {
      label: "security key cabinet",
      target: [696, 352],
      save: {
        room: "security",
        inventory: ["visitorBadge", "stampedForm"],
        flags: { introSeen: true, formStamped: true, clockUnlocked: true, clockSolved: true }
      }
    },
    {
      label: "interrogation rain window",
      target: [292, 300],
      save: {
        room: "interrogation",
        inventory: ["visitorBadge", "stampedForm"],
        flags: { introSeen: true, formStamped: true, clockUnlocked: true, clockSolved: true }
      }
    },
    {
      label: "archive index drawers",
      target: [356, 420],
      save: {
        room: "archive",
        inventory: ["visitorBadge", "stampedForm"],
        flags: { introSeen: true, formStamped: true, clockUnlocked: true, clockSolved: true }
      }
    },
    {
      label: "break memory vending",
      target: [854, 396],
      save: {
        room: "break",
        inventory: ["visitorBadge", "stampedForm", "timeToken", "paperCup"],
        flags: { introSeen: true, formStamped: true, clockUnlocked: true, clockSolved: true }
      }
    },
    {
      label: "mirror red intercom",
      target: [612, 596],
      save: {
        room: "mirror",
        inventory: ["auditWarrant", "memoryCup"],
        flags: { introSeen: true, serverSolved: true }
      }
    }
  ];

  for (const scenario of roomStates) {
    await continueSaved(page, {
      ...scenario.save,
      audioVolume: 0.72,
      muted: false,
      reducedMotion: true
    });
    await move(page, 30, 120);
    await expectCanvasCursor(page, "default", `${scenario.label} empty picture space`);
    await move(page, scenario.target[0], scenario.target[1]);
    await expectCanvasCursor(page, "pointer", `${scenario.label} hotspot`);
    await move(page, 30, 120);
    await expectCanvasCursor(page, "default", `${scenario.label} after leaving hotspot`);
  }

  await continueSaved(page, {
    room: "reception",
    inventory: ["visitorBadge", "stampedForm"],
    flags: { introSeen: true, formStamped: true, clockUnlocked: true },
    audioVolume: 0.72,
    muted: false,
    reducedMotion: true
  });
  await move(page, 30, 120);
  await expectCanvasCursor(page, "default", "inventory test empty picture space");
  await move(page, 116, 752);
  await expectCanvasCursor(page, "pointer", "inventory item hover");
  await move(page, 30, 120);
  await expectCanvasCursor(page, "default", "inventory after leaving item");

  await page.close();
}

async function testAudioControlsAndMutedClue(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "audio-controls");
  await startNew(page);

  await click(page, 1066, 32);
  let data = await save(page);
  if (Math.abs(data.audioVolume - 0.84) > 0.001) {
    throw new Error(`Volume + did not persist expected value: ${JSON.stringify(data)}`);
  }

  await click(page, 1014, 32);
  data = await save(page);
  if (Math.abs(data.audioVolume - 0.72) > 0.001) {
    throw new Error(`Volume - did not persist expected value: ${JSON.stringify(data)}`);
  }

  await click(page, 928, 32);
  data = await save(page);
  if (data.muted !== true) {
    throw new Error(`Sound toggle did not persist muted=true: ${JSON.stringify(data)}`);
  }

  await page.close();

  const mutedClue = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(mutedClue, issues, "muted-clue");
  await continueSaved(mutedClue, {
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
    muted: true
  });
  await click(mutedClue, 854, 396);
  await mutedClue.getByText("Accessibility transcript: the groups count seven, three, one.").waitFor({
    state: "visible",
    timeout: 8_000
  });
  for (const digit of ["7", "3", "1"]) {
    await button(mutedClue, digit);
  }
  await button(mutedClue, "Take Them");
  data = await save(mutedClue);
  if (!data.flags.vendingSolved || !data.inventory.includes("memoryCup") || data.inventory.includes("rainCipher")) {
    throw new Error(`Muted accessibility clue route failed: ${JSON.stringify(data)}`);
  }
  await mutedClue.close();

  const seenRainClue = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(seenRainClue, issues, "rain-seen-clue");
  await continueSaved(seenRainClue, {
    room: "break",
    inventory: ["visitorBadge", "stampedForm", "timeToken", "paperCup", "misfiledFolder", "mirrorShard", "selfFile"],
    flags: {
      introSeen: true,
      formStamped: true,
      clockUnlocked: true,
      clockSolved: true,
      archiveSolved: true,
      glassCaseCollected: true,
      rainCipherSeen: true
    },
    audioVolume: 0.72,
    muted: false
  });
  await click(seenRainClue, 854, 396);
  await seenRainClue.getByText("You remember the rain cipher: seven, three, one.").waitFor({ state: "visible", timeout: 8_000 });
  for (const digit of ["7", "3", "1"]) {
    await button(seenRainClue, digit);
  }
  await button(seenRainClue, "Take Them");
  data = await save(seenRainClue);
  if (!data.flags.vendingSolved || !data.inventory.includes("memoryCup") || data.inventory.includes("rainCipher")) {
    throw new Error(`Rain-seen clue route failed without Take Note: ${JSON.stringify(data)}`);
  }
  await seenRainClue.close();
}

async function testKeyboardShortcuts(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "keyboard-shortcuts");
  await startNew(page);

  await page.keyboard.press("N");
  await page.getByRole("dialog", { name: "Notes" }).waitFor({ state: "visible", timeout: 8_000 });
  await page.keyboard.press("M");
  if ((await page.getByRole("dialog", { name: "Floor Map" }).count()) !== 0) {
    throw new Error("Map shortcut fired while Notes modal was open.");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  await page.keyboard.press("M");
  await page.getByRole("dialog", { name: "Floor Map" }).waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Close");

  await page.keyboard.press("H");
  await page.getByRole("dialog", { name: "Hint" }).waitFor({ state: "visible", timeout: 8_000 });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  await page.keyboard.press("F1");
  await page.getByRole("dialog", { name: "Help" }).waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Close");

  await page.keyboard.press("]");
  let data = await save(page);
  if (Math.abs(data.audioVolume - 0.84) > 0.001) {
    throw new Error(`Keyboard volume up did not persist expected value: ${JSON.stringify(data)}`);
  }

  await page.keyboard.press("[");
  data = await save(page);
  if (Math.abs(data.audioVolume - 0.72) > 0.001) {
    throw new Error(`Keyboard volume down did not persist expected value: ${JSON.stringify(data)}`);
  }

  await page.keyboard.press("s");
  await page.waitForTimeout(250);
  if ((await save(page)).muted !== true) {
    await page.locator("canvas").focus();
    await page.keyboard.press("KeyS");
    await page.waitForTimeout(250);
  }
  data = await save(page);
  if (data.muted !== true) {
    const keyboardState = await page.evaluate(() => ({
      active: document.activeElement?.tagName,
      overlay: Boolean(document.querySelector(".game-modal-panel")),
      canvasTabIndex: document.querySelector("canvas")?.getAttribute("tabindex")
    }));
    throw new Error(`Keyboard sound toggle did not persist muted=true: data=${JSON.stringify(data)} state=${JSON.stringify(keyboardState)}`);
  }
  await page.close();
}

async function testLargeTextPreference(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "large-text");
  await startNew(page);

  await page.keyboard.press("F1");
  await page.getByRole("dialog", { name: "Help" }).waitFor({ state: "visible", timeout: 8_000 });
  const normal = await modalMetrics(page);
  expectModalInsideViewport(normal, "normal Help");
  await button(page, "Reduced Motion");
  await page.getByRole("button", { name: "Full Motion" }).waitFor({ state: "visible", timeout: 8_000 });
  let prefs = await preferences(page);
  if (!prefs || prefs.reducedMotion !== true) {
    throw new Error(`Reduced Motion preference did not save: ${JSON.stringify(prefs)}`);
  }
  const reducedMotionState = await page.evaluate(() => ({
    mode: document.getElementById("game")?.getAttribute("data-motion-mode"),
    bodyClass: document.body.className
  }));
  if (reducedMotionState.mode !== "reduced" || !reducedMotionState.bodyClass.includes("game-reduced-motion")) {
    throw new Error(`Reduced Motion did not apply visual state: ${JSON.stringify(reducedMotionState)}`);
  }
  await button(page, "Close");
  const stillA = await canvasFingerprint(page);
  await page.waitForTimeout(900);
  const stillB = await canvasFingerprint(page);
  if (stillA !== stillB) {
    throw new Error("Reduced Motion room canvas changed while idle, indicating active motion remains.");
  }

  await page.keyboard.press("F1");
  await page.getByRole("dialog", { name: "Help" }).waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Large Text");
  await page.getByRole("button", { name: "Normal Text" }).waitFor({ state: "visible", timeout: 8_000 });
  const large = await modalMetrics(page);
  expectModalInsideViewport(large, "large-text Help");
  if (!large.bodyClass.includes("game-text-large")) {
    throw new Error(`Large Text did not add body class: ${JSON.stringify(large)}`);
  }
  if (large.bodyFont < normal.bodyFont + 4 || large.buttonFont < normal.buttonFont + 3) {
    throw new Error(`Large Text did not materially increase modal text: normal=${JSON.stringify(normal)} large=${JSON.stringify(large)}`);
  }
  let data = await save(page);
  if (data.largeText !== true) {
    throw new Error(`Large Text preference did not save: ${JSON.stringify(data)}`);
  }
  await button(page, "Close");

  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(650);
  await click(page, 600, 462);
  await page.waitForTimeout(350);
  data = await save(page);
  if (data.largeText !== true) {
    throw new Error(`Large Text preference did not persist after reload/continue: ${JSON.stringify(data)}`);
  }
  await page.keyboard.press("F1");
  await page.getByRole("button", { name: "Normal Text" }).waitFor({ state: "visible", timeout: 8_000 });
  const restored = await modalMetrics(page);
  expectModalInsideViewport(restored, "restored large-text Help");
  if (!restored.bodyClass.includes("game-text-large") || restored.bodyFont < normal.bodyFont + 4) {
    throw new Error(`Large Text preference did not restore visually: ${JSON.stringify(restored)}`);
  }
  await button(page, "Close");

  const prefsBeforeAudioToggle = await preferences(page);
  const expectedAudioVolume = Math.min(1, (prefsBeforeAudioToggle?.audioVolume ?? 0.72) + 0.12);
  const expectedMuted = prefsBeforeAudioToggle?.muted !== true;
  await click(page, 1066, 32);
  await click(page, 928, 32);
  prefs = await preferences(page);
  if (
    !prefs ||
    prefs.largeText !== true ||
    prefs.reducedMotion !== true ||
    prefs.muted !== expectedMuted ||
    Math.abs(prefs.audioVolume - expectedAudioVolume) > 0.001
  ) {
    throw new Error(`Preferences were not mirrored before reset: ${JSON.stringify(prefs)}`);
  }

  const saveBeforeResetCancel = await save(page);
  await click(page, 1132, 32);
  await page.getByRole("dialog", { name: "Reset Shift" }).waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForFunction(() => document.activeElement?.textContent === "Cancel", null, { timeout: 8_000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => !document.querySelector(".game-modal-panel"), null, { timeout: 8_000 });
  const resetGuardData = await save(page);
  if (JSON.stringify(resetGuardData) !== JSON.stringify(saveBeforeResetCancel)) {
    throw new Error(`Reset confirmation default Enter changed progress: before=${JSON.stringify(saveBeforeResetCancel)} after=${JSON.stringify(resetGuardData)}`);
  }
  await click(page, 1132, 32);
  await button(page, "Reset");
  await page.waitForTimeout(350);
  const rawSaveAfterReset = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  if (rawSaveAfterReset !== null) {
    throw new Error(`Reset kept progress save when only preferences should remain: ${rawSaveAfterReset}`);
  }
  prefs = await preferences(page);
  if (
    !prefs ||
    prefs.largeText !== true ||
    prefs.reducedMotion !== true ||
    prefs.muted !== expectedMuted ||
    Math.abs(prefs.audioVolume - expectedAudioVolume) > 0.001
  ) {
    throw new Error(`Reset did not preserve preferences: ${JSON.stringify(prefs)}`);
  }
  const titleState = await page.evaluate(() => ({
    mode: document.getElementById("game")?.getAttribute("data-motion-mode"),
    bodyClass: document.body.className
  }));
  if (!titleState.bodyClass.includes("game-text-large") || !titleState.bodyClass.includes("game-reduced-motion") || titleState.mode !== "reduced") {
    throw new Error(`Accessibility classes were not kept on title after Reset: ${JSON.stringify(titleState)}`);
  }

  await page.keyboard.press("Enter");
  await button(page, "Clock In");
  data = await save(page);
  if (
    data.largeText !== true ||
    data.reducedMotion !== true ||
    data.muted !== expectedMuted ||
    Math.abs(data.audioVolume - expectedAudioVolume) > 0.001
  ) {
    throw new Error(`New shift did not inherit preserved preferences: ${JSON.stringify(data)}`);
  }
  await page.close();
}

async function testSystemReducedMotionDefault(browser, issues) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    deviceScaleFactor: 1,
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  watchPage(page, issues, "system-reduced-motion");
  await startNew(page);

  let prefs = await preferences(page);
  let data = await save(page);
  if (!prefs || prefs.reducedMotion !== true || data.reducedMotion !== true) {
    throw new Error(`System reduced-motion preference was not adopted on first launch: prefs=${JSON.stringify(prefs)} save=${JSON.stringify(data)}`);
  }

  const reducedState = await page.evaluate(() => ({
    mode: document.getElementById("game")?.getAttribute("data-motion-mode"),
    bodyClass: document.body.className
  }));
  if (reducedState.mode !== "reduced" || !reducedState.bodyClass.includes("game-reduced-motion")) {
    throw new Error(`System reduced-motion visual state did not apply: ${JSON.stringify(reducedState)}`);
  }

  const stillA = await canvasFingerprint(page);
  await page.waitForTimeout(900);
  const stillB = await canvasFingerprint(page);
  if (stillA !== stillB) {
    throw new Error("System reduced-motion room canvas changed while idle.");
  }

  await page.keyboard.press("F1");
  await page.getByRole("dialog", { name: "Help" }).waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Full Motion");
  await page.getByRole("button", { name: "Reduced Motion" }).waitFor({ state: "visible", timeout: 8_000 });
  prefs = await preferences(page);
  data = await save(page);
  if (!prefs || prefs.reducedMotion !== false || data.reducedMotion !== false) {
    throw new Error(`Full Motion override did not persist: prefs=${JSON.stringify(prefs)} save=${JSON.stringify(data)}`);
  }
  const fullState = await page.evaluate(() => ({
    mode: document.getElementById("game")?.getAttribute("data-motion-mode"),
    bodyClass: document.body.className
  }));
  if (fullState.mode !== "full" || fullState.bodyClass.includes("game-reduced-motion")) {
    throw new Error(`Full Motion override did not update visual state: ${JSON.stringify(fullState)}`);
  }

  const legacy = await context.newPage();
  watchPage(legacy, issues, "legacy-reduced-motion-save");
  await legacy.goto(APP_URL, { waitUntil: "networkidle" });
  await legacy.evaluate(
    ({ saveKey, preferencesKey }) => {
      localStorage.removeItem(preferencesKey);
      localStorage.setItem(
        saveKey,
        JSON.stringify({
          room: "reception",
          inventory: ["visitorBadge"],
          flags: { introSeen: true },
          audioVolume: 0.72,
          muted: false,
          largeText: false
        })
      );
    },
    { saveKey: SAVE_KEY, preferencesKey: PREFERENCES_KEY }
  );
  await legacy.reload({ waitUntil: "networkidle" });
  await legacy.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await legacy.waitForTimeout(650);
  await click(legacy, 600, 462);
  await expectCanvasPainted(legacy, "legacy reduced-motion save");
  prefs = await preferences(legacy);
  data = await save(legacy);
  if (!prefs || prefs.reducedMotion !== true || data.reducedMotion !== true) {
    throw new Error(`Legacy save did not preserve system reduced-motion default: prefs=${JSON.stringify(prefs)} save=${JSON.stringify(data)}`);
  }
  await legacy.close();

  await context.close();
}

async function testKeyboardObjectInteraction(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "keyboard-object-interaction");
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(650);
  await expectCanvasPainted(page, "keyboard object title");

  await page.keyboard.press("Enter");
  await button(page, "Clock In");
  await expectCanvasPainted(page, "keyboard object reception");

  await pressTab(page);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  let data = await save(page);
  if (!data.inventory.includes("blankForm")) {
    throw new Error(`Keyboard focus did not collect Blank Form: ${JSON.stringify(data)}`);
  }

  await pressTab(page, 2);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  data = await save(page);
  if (!data.inventory.includes("rubberStamp")) {
    throw new Error(`Keyboard focus did not collect Rubber Stamp: ${JSON.stringify(data)}`);
  }

  await pressTab(page, 2);
  await page.keyboard.press("Enter");
  await page.getByRole("dialog", { name: "Form 11-H" }).waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Accept");
  data = await save(page);
  if (!data.inventory.includes("stampedForm") || data.inventory.includes("blankForm") || data.inventory.includes("rubberStamp")) {
    throw new Error(`Keyboard focus did not create Stamped Form cleanly: ${JSON.stringify(data)}`);
  }

  await pressTab(page, 9);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(250);
  await pressTab(page, 5);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  await expectCanvasPainted(page, "keyboard object clock hall");
  data = await save(page);
  if (data.room !== "clock" || !data.flags.clockUnlocked) {
    throw new Error(`Keyboard focus did not open Clock Hall: ${JSON.stringify(data)}`);
  }

  await page.close();
}

async function testGamepadNavigation(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "gamepad-navigation");
  await installQaGamepad(page);
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(650);
  await expectCanvasPainted(page, "gamepad title");

  await pressGamepadButton(page, 0);
  await page.getByRole("dialog", { name: "Midnight Orientation" }).waitFor({ state: "visible", timeout: 8_000 });
  await pressGamepadButton(page, 0);
  await page.waitForFunction(() => !document.querySelector(".game-modal-panel"), null, { timeout: 8_000 });
  await expectCanvasPainted(page, "gamepad reception");
  let data = await save(page);
  if (!data.inventory.includes("visitorBadge")) {
    throw new Error(`Gamepad confirm did not complete intro: ${JSON.stringify(data)}`);
  }

  await pressGamepadButton(page, 15);
  await pressGamepadButton(page, 0);
  data = await save(page);
  if (!data.inventory.includes("blankForm")) {
    throw new Error(`Gamepad focus did not collect Blank Form: ${JSON.stringify(data)}`);
  }

  await pressGamepadButton(page, 15);
  await pressGamepadButton(page, 15);
  await pressGamepadButton(page, 0);
  data = await save(page);
  if (!data.inventory.includes("rubberStamp")) {
    throw new Error(`Gamepad focus did not collect Rubber Stamp: ${JSON.stringify(data)}`);
  }

  await pressGamepadButton(page, 9);
  await page.getByRole("dialog", { name: "Help" }).waitFor({ state: "visible", timeout: 8_000 });
  await pressGamepadButton(page, 15);
  const focusedHelpButton = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  if (focusedHelpButton !== "Reduced Motion") {
    throw new Error(`Gamepad D-pad did not move modal focus to Reduced Motion: ${focusedHelpButton || "nothing"}`);
  }
  await pressGamepadButton(page, 1);
  await page.locator(".game-modal-panel").waitFor({ state: "detached", timeout: 8_000 });

  await pressGamepadButton(page, 8);
  await page.getByRole("dialog", { name: "Floor Map" }).waitFor({ state: "visible", timeout: 8_000 });
  await pressGamepadButton(page, 1);
  await page.locator(".game-modal-panel").waitFor({ state: "detached", timeout: 8_000 });

  await pressGamepadButton(page, 2);
  await page.getByRole("dialog", { name: "Notes" }).waitFor({ state: "visible", timeout: 8_000 });
  await pressGamepadButton(page, 1);
  await page.locator(".game-modal-panel").waitFor({ state: "detached", timeout: 8_000 });

  await page.close();
}

async function testAuditEndingFromLateSave(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "audit-ending");

  const repaired = await continueSaved(page, {
    room: "mirror",
    inventory: ["auditWarrant"],
    flags: { serverSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  if (repaired.room !== "mirror" || !repaired.flags.serverSolved || !repaired.inventory.includes("auditWarrant")) {
    throw new Error(`Audit ending setup did not repair to a valid late-game state: ${JSON.stringify(repaired)}`);
  }

  await selectItem(page, "auditWarrant");
  await click(page, 1080, 386);
  await page.waitForTimeout(350);
  await expectCanvasPainted(page, "audit ending");
  const data = await save(page);
  if (data.ending !== "audited") {
    throw new Error(`Audit ending was not saved: ${JSON.stringify(data)}`);
  }

  await page.close();
}

async function testWrongItemFeedback(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "wrong-item-feedback");

  await continueSaved(page, {
    room: "reception",
    inventory: ["visitorBadge"],
    flags: { introSeen: true },
    audioVolume: 0.72,
    muted: false
  });
  await selectItem(page, "visitorBadge");
  await click(page, 360, 374);
  await page.getByText("Visitor Badge is selected, but the circular seal only accepts the Stamped Form.").waitFor({
    state: "visible",
    timeout: 8_000
  });
  let data = await save(page);
  if (data.flags.clockUnlocked) {
    throw new Error(`Wrong item opened the Circle Door: ${JSON.stringify(data)}`);
  }
  await button(page, "Close");

  await continueSaved(page, {
    room: "security",
    inventory: ["visitorBadge", "stampedForm", "rainCipher"],
    flags: { introSeen: true, formStamped: true, clockUnlocked: true, clockSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  await selectItem(page, "rainCipher");
  await click(page, 696, 352);
  await page.getByText("Rain Cipher is selected, but the reader wants a Visitor Badge or a Stamped Form.").waitFor({
    state: "visible",
    timeout: 8_000
  });
  data = await save(page);
  if (data.inventory.includes("securityKey")) {
    throw new Error(`Wrong item granted the Security Key: ${JSON.stringify(data)}`);
  }
  await button(page, "Close");

  await selectItem(page, "visitorBadge");
  await click(page, 522, 392);
  await page.getByText("Visitor Badge is selected, but the old lock only fits the Security Key.").waitFor({
    state: "visible",
    timeout: 8_000
  });
  data = await save(page);
  if (data.inventory.includes("auditWarrant") || data.flags.evidenceSafeOpened) {
    throw new Error(`Wrong item opened the Evidence Safe: ${JSON.stringify(data)}`);
  }
  await button(page, "Close");

  await continueSaved(page, {
    room: "archive",
    inventory: ["stampedForm", "rainCipher"],
    flags: { formStamped: true, clockUnlocked: true, clockSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  await selectItem(page, "rainCipher");
  await click(page, 356, 420);
  await page.getByText("Rain Cipher is selected, but the drawers only accept a warrant-backed security override.").waitFor({
    state: "visible",
    timeout: 8_000
  });
  data = await save(page);
  if (data.flags.archiveSolved) {
    throw new Error(`Wrong item solved the archive drawers: ${JSON.stringify(data)}`);
  }
  await button(page, "Close");

  await continueSaved(page, {
    room: "mirror",
    inventory: ["memoryCup"],
    flags: { mirrorShardInstalled: true },
    audioVolume: 0.72,
    muted: false
  });
  await selectItem(page, "memoryCup");
  await click(page, 612, 596);
  await page.getByText("Cup of Missing Hour is selected, but the Auditor accepts a Missing-Person File or the Audit Warrant for identity.").waitFor({
    state: "visible",
    timeout: 8_000
  });
  data = await save(page);
  if (data.flags.identityVerified) {
    throw new Error(`Wrong item verified identity at the intercom: ${JSON.stringify(data)}`);
  }
  await button(page, "Close");

  await continueSaved(page, {
    room: "mirror",
    inventory: ["rainCipher"],
    flags: { serverSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  await selectItem(page, "rainCipher");
  await click(page, 1080, 386);
  await page.getByText("Rain Cipher is selected, but the final mechanisms respond only to Your Missing-Person File").waitFor({
    state: "visible",
    timeout: 8_000
  });
  data = await save(page);
  if (data.ending) {
    throw new Error(`Wrong item triggered an ending: ${JSON.stringify(data)}`);
  }

  await page.close();
}

async function testAuditorConsultation(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "auditor-consultation");

  await continueSaved(page, {
    room: "mirror",
    inventory: ["auditWarrant", "memoryCup", "selfFile"],
    flags: { serverSolved: true },
    audioVolume: 0.72,
    muted: false
  });

  await click(page, 612, 596);
  await page.getByText("One sanctioned question").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Ask About File");
  await page.getByText("still inside the building's idea of mercy").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Ask More");
  await button(page, "Ask About Hour");
  await page.getByText("Freedom is rarely complete documentation").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Ask More");
  await button(page, "Ask Warrant");
  await page.getByText("make the Department answer").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Leave");

  const data = await save(page);
  for (const flag of ["auditorFileAsked", "auditorHourAsked", "auditorWarrantAsked"]) {
    if (!data.flags[flag]) {
      throw new Error(`Auditor consultation did not persist ${flag}: ${JSON.stringify(data)}`);
    }
  }
  if (data.ending) {
    throw new Error(`Auditor consultation unexpectedly triggered an ending: ${JSON.stringify(data)}`);
  }

  await click(page, 638, 32);
  await page.getByText("the file ending makes you findable").waitFor({ state: "visible", timeout: 8_000 });
  await page.getByText("the hour ending breaks the ledger").waitFor({ state: "visible", timeout: 8_000 });
  await page.getByText("the warrant ending turns the correction outward").waitFor({ state: "visible", timeout: 8_000 });

  await page.close();
}

async function testSaveRepairAndArchiveGates(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "save-repair-gates");

  const repaired = await continueSaved(page, {
    room: "mirror",
    inventory: [],
    flags: {
      formStamped: true,
      clockUnlocked: true,
      clockSolved: true,
      evidenceSafeOpened: true,
      archiveSolved: true,
      glassCaseCollected: true,
      vendingSolved: true
    },
    audioVolume: 0.72,
    muted: false
  });
  if (repaired.room !== "mirror") {
    throw new Error(`Repairable mirror save did not stay in Mirror Office: ${JSON.stringify(repaired)}`);
  }
  expectInventory(repaired, ["stampedForm", "auditWarrant", "misfiledFolder", "mirrorShard", "selfFile", "memoryCup", "serverFuse"], "repaired save");

  const repairedGlassCase = await continueSaved(page, {
    room: "archive",
    inventory: [],
    flags: { glassCaseCollected: true },
    audioVolume: 0.72,
    muted: false
  });
  if (
    repairedGlassCase.room !== "archive" ||
    !repairedGlassCase.flags.clockSolved ||
    !repairedGlassCase.flags.clockUnlocked ||
    !repairedGlassCase.flags.formStamped ||
    !repairedGlassCase.flags.archiveSolved ||
    !repairedGlassCase.flags.glassCaseCollected
  ) {
    throw new Error(`Glass-case downstream save did not repair upstream archive access: ${JSON.stringify(repairedGlassCase)}`);
  }
  expectInventory(
    repairedGlassCase,
    ["stampedForm", "misfiledFolder", "mirrorShard", "selfFile"],
    "repaired glass-case downstream save"
  );

  const repairedServer = await continueSaved(page, {
    room: "mirror",
    inventory: [],
    flags: { serverSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  for (const flag of [
    "formStamped",
    "clockUnlocked",
    "clockSolved",
    "evidenceSafeOpened",
    "archiveSolved",
    "glassCaseCollected",
    "vendingSolved",
    "mirrorShardInstalled",
    "fuseInstalled",
    "identityVerified",
    "hourVerified",
    "serverSolved"
  ]) {
    if (!repairedServer.flags[flag]) {
      throw new Error(`Server downstream save did not repair flag ${flag}: ${JSON.stringify(repairedServer)}`);
    }
  }
  if (repairedServer.room !== "mirror") {
    throw new Error(`Server downstream save did not remain in Mirror Office: ${JSON.stringify(repairedServer)}`);
  }
  expectInventory(repairedServer, ["stampedForm", "auditWarrant", "misfiledFolder", "selfFile", "memoryCup"], "repaired server save");
  if (repairedServer.inventory.includes("serverFuse") || repairedServer.inventory.includes("mirrorShard")) {
    throw new Error(`Installed late-game items were not removed from repaired server save: ${JSON.stringify(repairedServer)}`);
  }

  const downgraded = await continueSaved(page, {
    room: "mirror",
    inventory: [],
    flags: {},
    audioVolume: 0.72,
    muted: false
  });
  if (downgraded.room !== "reception") {
    throw new Error(`Invalid mirror save was not moved to Reception: ${JSON.stringify(downgraded)}`);
  }

  await continueSaved(page, {
    room: "archive",
    inventory: ["stampedForm"],
    flags: { formStamped: true, clockUnlocked: true, clockSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  await click(page, 356, 420);
  await page.getByText("The drawers refuse blind guesses.").waitFor({ state: "visible", timeout: 8_000 });

  await continueSaved(page, {
    room: "archive",
    inventory: ["stampedForm", "auditWarrant"],
    flags: { formStamped: true, clockUnlocked: true, clockSolved: true, securityFootageSeen: true },
    audioVolume: 0.72,
    muted: false
  });
  await click(page, 356, 420);
  await page.getByText("The drawers refuse blind guesses.").waitFor({ state: "visible", timeout: 8_000 });

  await continueSaved(page, {
    room: "archive",
    inventory: ["auditWarrant"],
    flags: { formStamped: true, clockUnlocked: true, clockSolved: true },
    audioVolume: 0.72,
    muted: false
  });
  await selectItem(page, "auditWarrant");
  await click(page, 356, 420);
  await page.getByText("The warrant has authority, but the archive wants a witness.").waitFor({ state: "visible", timeout: 8_000 });

  await page.close();
}

async function testPanelEscapeAndReset(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "panel-reset");
  await startNew(page);
  await click(page, 226, 650);
  await click(page, 816, 32);
  await button(page, "Recover Position");
  await page.getByText("No progress was deleted.").waitFor({ state: "visible", timeout: 8_000 });
  await button(page, "Close");
  const recoveredData = await save(page);
  if (recoveredData.room !== "reception" || !recoveredData.inventory.includes("blankForm")) {
    throw new Error(`Recover Position deleted progress or moved to the wrong room: ${JSON.stringify(recoveredData)}`);
  }

  await click(page, 638, 32);
  await page.locator(".game-modal-panel").waitFor({ state: "visible", timeout: 8_000 });
  await page.keyboard.press("Tab");
  const activeButton = await page.evaluate(() => document.activeElement?.textContent ?? "");
  if (!activeButton.includes("Close")) {
    throw new Error(`Notes modal did not trap Tab focus on its Close button: ${activeButton}`);
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press("Tab");
  const recoveredFocus = await page.evaluate(() => document.activeElement?.textContent ?? "");
  if (!recoveredFocus.includes("Close")) {
    throw new Error(`Notes modal did not recover Tab focus after blur: ${recoveredFocus}`);
  }
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  if ((await page.locator(".game-modal-panel").count()) !== 0) {
    throw new Error("Escape did not close the Notes panel after focus left the button.");
  }

  await click(page, 1132, 32);
  await button(page, "Reset");
  await page.waitForTimeout(350);
  const rawSave = await page.evaluate((key) => localStorage.getItem(key), SAVE_KEY);
  if (rawSave !== null) {
    throw new Error("Reset did not clear the saved shift.");
  }
  if ((await page.locator(".game-modal-panel").count()) !== 0) {
    throw new Error("Reset left a modal overlay open.");
  }
  await page.close();
}

async function testLateGameNotesScroll(browser, issues) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
  watchPage(page, issues, "late-notes");
  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await clearGameStorage(page);
  await seedSave(page, {
    room: "mirror",
    inventory: [
      "visitorBadge",
      "rubberStamp",
      "stampedForm",
      "securityKey",
      "auditWarrant",
      "misfiledFolder",
      "selfFile",
      "rainCipher",
      "memoryCup"
    ],
    flags: {
      introSeen: true,
      formStamped: true,
      clockUnlocked: true,
      clockSolved: true,
      securityFootageSeen: true,
      incidentBoardSeen: true,
      securityLogSeen: true,
      evidenceSafeOpened: true,
      archiveTableSeen: true,
      breakBoardSeen: true,
      archiveSolved: true,
      glassCaseCollected: true,
      rainCipherSeen: true,
      vendingSolved: true,
      fuseInstalled: true,
      mirrorClueSeen: true,
      identityVerified: true,
      hourVerified: true
    },
    audioVolume: 0.72,
    muted: false
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 8_000 });
  await page.waitForTimeout(650);
  await click(page, 600, 462);
  await click(page, 638, 32);
  await page.locator(".game-modal-panel").waitFor({ state: "visible", timeout: 8_000 });
  const geometry = await page.evaluate(() => {
    const panel = document.querySelector(".game-modal-panel").getBoundingClientRect();
    const body = document.querySelector(".game-modal-body");
    const rect = body.getBoundingClientRect();
    body.scrollTop = 9999;
    return {
      panelTop: panel.top,
      panelBottom: panel.bottom,
      bodyTop: rect.top,
      bodyBottom: rect.bottom,
      scrollTop: body.scrollTop,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight
    };
  });
  if (geometry.bodyTop < geometry.panelTop - 1 || geometry.bodyBottom > geometry.panelBottom + 1) {
    throw new Error(`Late-game Notes body escapes panel: ${JSON.stringify(geometry)}`);
  }
  if (geometry.scrollHeight > geometry.clientHeight && geometry.scrollTop === 0) {
    throw new Error(`Late-game Notes content is not scrollable: ${JSON.stringify(geometry)}`);
  }
  await page.close();
}

async function run() {
  const viteBin = fileURLToPath(new URL("../node_modules/vite/bin/vite.js", import.meta.url));
  const projectRoot = fileURLToPath(new URL("..", import.meta.url));
  const viteArgs = PREVIEW_MODE
    ? [viteBin, "preview", "--host", HOST, "--port", String(PORT), "--strictPort"]
    : [viteBin, "--host", HOST, "--port", String(PORT), "--strictPort"];
  const server = spawn(process.execPath, viteArgs, {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const serverOutput = [];
  server.stdout.on("data", (chunk) => serverOutput.push(chunk.toString()));
  server.stderr.on("data", (chunk) => serverOutput.push(chunk.toString()));

  let browser;
  let failed = false;
  try {
    await waitForServer(server);
    browser = await launchBrowser();
    const issues = [];

    await testAssetLoadFailure(browser);
    await testOptionalAudioLoadFailure(browser);
    await testNoScriptFallback(browser, issues);
    await testIntroBadgeRecovery(browser, issues);

    const securityPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    watchPage(securityPage, issues, "security-route");
    await playSecurityOverrideRoute(securityPage);
    await securityPage.close();

    const deductionPage = await browser.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });
    watchPage(deductionPage, issues, "deduction-route");
    await playDeductionRoute(deductionPage);
    await deductionPage.close();

    await testBadSaveAndMobile(browser);
    await testScaledInteraction(browser, issues);
    await testHotspotCursorBehavior(browser, issues);
    await testAudioControlsAndMutedClue(browser, issues);
    await testKeyboardShortcuts(browser, issues);
    await testLargeTextPreference(browser, issues);
    await testSystemReducedMotionDefault(browser, issues);
    await testKeyboardObjectInteraction(browser, issues);
    await testGamepadNavigation(browser, issues);
    await testAuditEndingFromLateSave(browser, issues);
    await testWrongItemFeedback(browser, issues);
    await testAuditorConsultation(browser, issues);
    await testSaveRepairAndArchiveGates(browser, issues);
    await testPanelEscapeAndReset(browser, issues);
    await testLateGameNotesScroll(browser, issues);

    if (issues.length > 0) {
      throw new Error(`Browser issues detected:\n${issues.join("\n")}`);
    }
    const mode = PREVIEW_MODE ? "production preview" : "development server";
    console.log(`QA passed on ${mode}: asset-load failure recovery, optional audio fallback, no-JavaScript static-host fallback, intro badge recovery, security override route, deduction route, audit ending, canvas paint and accessibility checks, mid-game reloads, phone/rain/muted clue paths, hand-cursor hotspot/inventory behavior, audio controls, keyboard shortcuts, keyboard title start, controller title/object/modal navigation, protected Start New, clue-gated Mood Clocks, large-text and reduced-motion preference/reset survival, system reduced-motion default and legacy migration, keyboard object/inventory interaction, wrong-item feedback, Auditor consultation notes, answer-order anti-spoiler checks, failed-puzzle recovery, rain/glass/vending reward Escape checks, downstream save repair, invalid-room save recovery, corrupt/unavailable storage recovery with save warning, recover position, archive gates, pre-file vending gate, scaled interaction, malformed save, mobile fit, modal focus/Escape, reset, and late-game Notes scroll.`);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    await browser?.close().catch(() => {});
    server.kill();
    await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 2_000))]);
    if (failed && serverOutput.length > 0) {
      console.error(serverOutput.join(""));
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
