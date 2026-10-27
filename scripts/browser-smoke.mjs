import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium } from "playwright-core";

const BASE_URL = process.env.VEIL_BASE_URL || "http://127.0.0.1:4200";
const SCREENSHOT_DIR = process.env.VEIL_SCREENSHOT_DIR || "";
const SCAN_TIMEOUT = Number(process.env.VEIL_SCAN_TIMEOUT) || 180_000;

const BROWSER_CANDIDATES = [
  process.env.VEIL_BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/microsoft-edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
].filter(Boolean);

const executablePath = BROWSER_CANDIDATES.find((candidate) => existsSync(candidate));
if (!executablePath) {
  throw new Error("No supported Chromium browser found. Set VEIL_BROWSER_PATH.");
}

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-component-extensions-with-background-pages",
  ],
});

const requests = [];
const failures = [];
const pageErrors = [];
const consoleErrors = [];
const consoleMessages = [];

try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  page.on("request", (request) => requests.push(request.url()));
  page.on("requestfailed", (request) =>
    failures.push({ url: request.url(), error: request.failure()?.errorText }),
  );
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForFunction(
    () => document.querySelector("#demo-button") && window.lucide,
    null,
    { timeout: 30_000 },
  );
  await page.click("#demo-button");
  await page.waitForFunction(
    () => !document.querySelector("#scan-button").disabled,
    null,
    { timeout: 30_000 },
  );
  await page.click("#scan-button");
  const progressSamples = [];
  const progressTimer = setInterval(async () => {
    try {
      const sample = await page.evaluate(() => ({
        time: new Date().toISOString(),
        status: document.querySelector("#scan-status")?.textContent,
        progress: document.querySelector("#scan-progress-label")?.textContent,
        scanning: document.querySelector("#scan-button")?.disabled,
      }));
      progressSamples.push(sample);
    } catch {
      // The page may be between navigations; the main assertion will report that.
    }
  }, 10_000);
  try {
    await page.waitForFunction(
      () =>
        document.querySelector("#scan-overlay").hidden &&
        !document.querySelector("#scan-button").disabled,
      null,
      { timeout: SCAN_TIMEOUT },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => ({
      status: document.querySelector("#scan-status")?.textContent,
      progress: document.querySelector("#scan-progress-label")?.textContent,
      overlayHidden: document.querySelector("#scan-overlay")?.hidden,
      scanButtonDisabled: document.querySelector("#scan-button")?.disabled,
      toast: document.querySelector("#toast")?.textContent,
    }));
    console.error(
      JSON.stringify(
        {
          diagnostics,
          progressSamples,
          assetRequests: requests.filter((url) =>
            /tesseract|traineddata|blazeface|model\.json/i.test(url),
          ),
          failures,
          consoleErrors,
          consoleMessages: consoleMessages.slice(-120),
          pageErrors,
        },
        null,
        2,
      ),
    );
    throw error;
  } finally {
    clearInterval(progressTimer);
  }

  await page.waitForTimeout(400);
  const detection = await page.evaluate(() => ({
    regionCount: Number(document.querySelector("#region-count").textContent),
    faceCount: Number(document.querySelector("#face-count").textContent),
    textCount: Number(document.querySelector("#text-count").textContent),
    qrCount: Number(document.querySelector("#qr-count").textContent),
    regionLabels: [...document.querySelectorAll(".region-copy strong")].map(
      (node) => node.textContent,
    ),
    toast: document.querySelector("#toast").textContent,
  }));

  if (detection.qrCount < 1) throw new Error("QR smoke test did not find the demo QR code.");
  if (detection.textCount < 2) throw new Error("OCR smoke test found too few text regions.");
  if (detection.toast.includes("人脸模块未完成")) {
    throw new Error("BlazeFace initialization failed during the browser smoke test.");
  }

  const canvasBox = await page.locator("#editor-canvas").boundingBox();
  if (!canvasBox) throw new Error("Editor canvas is not visible.");
  const startX = canvasBox.x + canvasBox.width * 0.72;
  const startY = canvasBox.y + canvasBox.height * 0.67;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 90, startY + 48, { steps: 8 });
  await page.mouse.up();
  const afterManual = Number(await page.locator("#region-count").textContent());
  if (afterManual !== detection.regionCount + 1) {
    throw new Error("Manual redaction rectangle was not added.");
  }

  await page.click("#undo-button");
  const afterUndo = Number(await page.locator("#region-count").textContent());
  await page.click("#redo-button");
  const afterRedo = Number(await page.locator("#region-count").textContent());
  if (afterUndo !== detection.regionCount || afterRedo !== afterManual) {
    throw new Error("Undo/redo did not restore the expected region counts.");
  }

  const downloadPromise = page.waitForEvent("download");
  await page.click("#export-button");
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("PNG export did not produce a local file.");
  const png = await readFile(downloadPath);
  const pngSignature = png.subarray(0, 8).toString("hex");
  if (pngSignature !== "89504e470d0a1a0a") {
    throw new Error("Exported file is not a valid PNG.");
  }

  const desktopLayout = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    canvasWidth: document.querySelector("#editor-canvas").width,
    canvasHeight: document.querySelector("#editor-canvas").height,
  }));
  if (desktopLayout.bodyScrollWidth > desktopLayout.viewportWidth + 1) {
    throw new Error("Desktop layout has horizontal overflow.");
  }

  if (SCREENSHOT_DIR) {
    await mkdir(SCREENSHOT_DIR, { recursive: true });
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "preview-desktop.png"),
      fullPage: true,
    });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("#studio-title");
  const mobileLayout = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    titleBox: document.querySelector("#page-title").getBoundingClientRect().toJSON(),
    studioBox: document.querySelector("#redaction-studio").getBoundingClientRect().toJSON(),
  }));
  if (mobileLayout.bodyScrollWidth > mobileLayout.viewportWidth + 1) {
    throw new Error("Mobile layout has horizontal overflow.");
  }
  if (SCREENSHOT_DIR) {
    await page.screenshot({
      path: join(SCREENSHOT_DIR, "preview-mobile.png"),
      fullPage: false,
    });
  }

  await page.goto(`${BASE_URL}/guide.html`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForSelector("#guide-title");
  const guideLayout = await page.evaluate(() => ({
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth,
    sections: document.querySelectorAll(".guide-section").length,
  }));
  if (guideLayout.bodyScrollWidth > guideLayout.viewportWidth + 1) {
    throw new Error("Guide page has horizontal overflow on mobile.");
  }

  const origin = new URL(BASE_URL).origin;
  const externalRequests = [
    ...new Set(
      requests.filter((url) => {
        if (url.startsWith("blob:") || url.startsWith("data:")) return false;
        return new URL(url).origin !== origin;
      }),
    ),
  ];
  const browserInjectedRequests = externalRequests.filter((url) =>
    url.startsWith("http://me.kis.v2.scr.kaspersky-labs.com/"),
  );
  const unexpectedRequests = externalRequests.filter(
    (url) => !browserInjectedRequests.includes(url),
  );
  if (unexpectedRequests.length) {
    throw new Error(`Unexpected external requests: ${unexpectedRequests.join(", ")}`);
  }
  if (pageErrors.length) {
    throw new Error(`Page errors: ${pageErrors.join(" | ")}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        browser: executablePath,
        detection,
        manualRedaction: { before: detection.regionCount, after: afterManual },
        undoRedo: { afterUndo, afterRedo },
        export: { bytes: png.length, signature: pngSignature },
        layouts: { desktop: desktopLayout, mobile: mobileLayout, guide: guideLayout },
        externalRequests,
        browserInjectedRequests,
        requests: requests.length,
        failures,
        consoleErrors,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
