import {
  DEFAULT_DETECTION_OPTIONS,
  clampRectangle,
  createRegion,
  dedupeRegions,
  detectSensitiveLines,
  flattenTesseractLines,
  padRectangle,
  qrLocationToRectangle,
} from "../src/redaction.js";

const SETTINGS_KEY = "veil-redactor-settings-v1";
const MAX_IMAGE_EDGE = 4096;
const MAX_SCAN_EDGE = 1800;
const HISTORY_LIMIT = 30;

const STYLE_HINTS = {
  mosaic: "不可逆的像素化",
  blur: "边缘更柔和，建议高强度",
  solid: "最稳妥的纯色覆盖",
};

const REGION_ICONS = {
  face: "scan-face",
  phone: "phone",
  id: "badge-info",
  plate: "car-front",
  qr: "qr-code",
  manual: "scan",
};

const storedSettings = readStoredSettings();
const state = {
  imageCanvas: null,
  sourceName: "image",
  sourceDimensions: null,
  resized: false,
  regions: [],
  history: [],
  future: [],
  selectedRegionId: null,
  style: ["mosaic", "blur", "solid"].includes(storedSettings.style)
    ? storedSettings.style
    : "mosaic",
  strength: clampNumber(storedSettings.strength ?? 6, 1, 10),
  padding: clampNumber(storedSettings.padding ?? 6, 0, 32),
  format: ["image/png", "image/jpeg"].includes(storedSettings.format)
    ? storedSettings.format
    : "image/png",
  quality: clampNumber(storedSettings.quality ?? 92, 60, 100),
  detection: {
    ...DEFAULT_DETECTION_OPTIONS,
    ...(storedSettings.detection || {}),
  },
  scanning: false,
  scanToken: 0,
  revealOriginal: false,
  manualStart: null,
  manualPreview: null,
  faceModel: null,
  faceModelPromise: null,
  ocrWorker: null,
  ocrWorkerPromise: null,
  installPrompt: null,
  toastTimer: null,
};

const elements = {
  imageInput: document.querySelector("#image-input"),
  uploadButton: document.querySelector("#upload-button"),
  emptyUploadButton: document.querySelector("#empty-upload-button"),
  demoButton: document.querySelector("#demo-button"),
  scanButton: document.querySelector("#scan-button"),
  detectFaces: document.querySelector("#detect-faces"),
  detectPhones: document.querySelector("#detect-phones"),
  detectIds: document.querySelector("#detect-ids"),
  detectPlates: document.querySelector("#detect-plates"),
  detectQr: document.querySelector("#detect-qr"),
  styleControl: document.querySelector("#redaction-style"),
  styleHint: document.querySelector("#style-hint"),
  strengthRange: document.querySelector("#strength-range"),
  strengthValue: document.querySelector("#strength-value"),
  paddingRange: document.querySelector("#padding-range"),
  paddingValue: document.querySelector("#padding-value"),
  undoButton: document.querySelector("#undo-button"),
  redoButton: document.querySelector("#redo-button"),
  revealButton: document.querySelector("#reveal-button"),
  resetRegionsButton: document.querySelector("#reset-regions-button"),
  imageCounter: document.querySelector("#image-counter"),
  canvasStage: document.querySelector("#canvas-stage"),
  emptyState: document.querySelector("#empty-state"),
  canvasScroll: document.querySelector("#canvas-scroll"),
  editorCanvas: document.querySelector("#editor-canvas"),
  manualSelection: document.querySelector("#manual-selection"),
  scanOverlay: document.querySelector("#scan-overlay"),
  scanStatus: document.querySelector("#scan-status"),
  scanProgressFill: document.querySelector("#scan-progress-fill"),
  scanProgressLabel: document.querySelector("#scan-progress-label"),
  dragOverlay: document.querySelector("#drag-overlay"),
  editorHint: document.querySelector("#editor-hint"),
  imageDimensions: document.querySelector("#image-dimensions"),
  regionCount: document.querySelector("#region-count"),
  faceCount: document.querySelector("#face-count"),
  textCount: document.querySelector("#text-count"),
  qrCount: document.querySelector("#qr-count"),
  regionList: document.querySelector("#region-list"),
  regionEmpty: document.querySelector("#region-empty"),
  formatControl: document.querySelector("#format-control"),
  qualityRange: document.querySelector("#quality-range"),
  qualityValue: document.querySelector("#quality-value"),
  exportButton: document.querySelector("#export-button"),
  copyImageButton: document.querySelector("#copy-image-button"),
  installButton: document.querySelector("#install-button"),
  toast: document.querySelector("#toast"),
  year: document.querySelector("#year"),
};

function readStoredSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function storeSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        style: state.style,
        strength: state.strength,
        padding: state.padding,
        format: state.format,
        quality: state.quality,
        detection: state.detection,
      }),
    );
  } catch {
    // Preferences are optional.
  }
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2600);
}

function createIcons() {
  if (window.lucide?.createIcons) {
    window.lucide.createIcons({
      attrs: {
        "aria-hidden": "true",
        "stroke-width": 1.8,
      },
    });
  }
}

function renderControls() {
  elements.detectFaces.checked = state.detection.faces;
  elements.detectPhones.checked = state.detection.phones;
  elements.detectIds.checked = state.detection.ids;
  elements.detectPlates.checked = state.detection.plates;
  elements.detectQr.checked = state.detection.qr;

  for (const button of elements.styleControl.querySelectorAll("[data-style]")) {
    const active = button.dataset.style === state.style;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  elements.styleHint.textContent = STYLE_HINTS[state.style];
  elements.strengthRange.value = String(state.strength);
  elements.strengthValue.textContent = String(state.strength);
  elements.paddingRange.value = String(state.padding);
  elements.paddingValue.textContent = `${state.padding} px`;

  for (const button of elements.formatControl.querySelectorAll("[data-format]")) {
    const active = button.dataset.format === state.format;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  elements.qualityRange.value = String(state.quality);
  elements.qualityValue.textContent = String(state.quality);
  elements.qualityRange.closest(".range-row").hidden = state.format !== "image/jpeg";

  const hasImage = Boolean(state.imageCanvas);
  elements.scanButton.disabled = !hasImage || state.scanning;
  elements.revealButton.disabled = !hasImage;
  elements.exportButton.disabled = !hasImage || !state.regions.some((region) => region.enabled);
  elements.copyImageButton.disabled = elements.exportButton.disabled;
  elements.undoButton.disabled = state.history.length === 0;
  elements.redoButton.disabled = state.future.length === 0;
  elements.resetRegionsButton.disabled = !hasImage || state.regions.length === 0;
}

function getAllRegions() {
  return state.imageCanvas ? dedupeRegions(state.regions) : [];
}

function pushHistory() {
  state.history.push(structuredClone(state.regions));
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.future = [];
}

function applyRegions(nextRegions) {
  pushHistory();
  state.regions = nextRegions;
  state.selectedRegionId = null;
  renderAll();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(structuredClone(state.regions));
  state.regions = state.history.pop();
  state.selectedRegionId = null;
  renderAll();
}

function redo() {
  if (!state.future.length) return;
  state.history.push(structuredClone(state.regions));
  state.regions = state.future.pop();
  state.selectedRegionId = null;
  renderAll();
}

function clearRegions() {
  if (!state.regions.length) return;
  applyRegions([]);
  showToast("所有遮挡区域已清除，可撤销恢复");
}

function setRedactionStyle(style) {
  if (!STYLE_HINTS[style]) return;
  state.style = style;
  renderControls();
  storeSettings();
  renderCanvas();
}

function setFormat(format) {
  if (!["image/png", "image/jpeg"].includes(format)) return;
  state.format = format;
  renderControls();
  storeSettings();
}

function drawImageSource() {
  if (!state.imageCanvas) return;
  elements.editorCanvas.width = state.imageCanvas.width;
  elements.editorCanvas.height = state.imageCanvas.height;
  elements.editorCanvas.style.aspectRatio = `${state.imageCanvas.width} / ${state.imageCanvas.height}`;
  renderCanvas();
}

function drawMosaic(context, sourceCanvas, rectangle) {
  const blockSize = Math.round(4 + state.strength * 2.1);
  const reducedWidth = Math.max(1, Math.ceil(rectangle.width / blockSize));
  const reducedHeight = Math.max(1, Math.ceil(rectangle.height / blockSize));
  const temp = document.createElement("canvas");
  temp.width = reducedWidth;
  temp.height = reducedHeight;
  const tempContext = temp.getContext("2d");
  tempContext.imageSmoothingEnabled = false;
  tempContext.drawImage(
    sourceCanvas,
    rectangle.x,
    rectangle.y,
    rectangle.width,
    rectangle.height,
    0,
    0,
    reducedWidth,
    reducedHeight,
  );
  context.save();
  context.imageSmoothingEnabled = false;
  context.drawImage(
    temp,
    0,
    0,
    reducedWidth,
    reducedHeight,
    rectangle.x,
    rectangle.y,
    rectangle.width,
    rectangle.height,
  );
  context.restore();
}

function drawBlur(context, sourceCanvas, rectangle) {
  if (!("filter" in context)) {
    drawMosaic(context, sourceCanvas, rectangle);
    return;
  }

  const radius = Math.round(4 + state.strength * 1.65);
  context.save();
  context.beginPath();
  context.rect(rectangle.x, rectangle.y, rectangle.width, rectangle.height);
  context.clip();
  context.filter = `blur(${radius}px)`;
  context.drawImage(
    sourceCanvas,
    Math.max(0, rectangle.x - radius * 2),
    Math.max(0, rectangle.y - radius * 2),
    Math.min(sourceCanvas.width - Math.max(0, rectangle.x - radius * 2), rectangle.width + radius * 4),
    Math.min(sourceCanvas.height - Math.max(0, rectangle.y - radius * 2), rectangle.height + radius * 4),
    Math.max(0, rectangle.x - radius * 2),
    Math.max(0, rectangle.y - radius * 2),
    Math.min(sourceCanvas.width - Math.max(0, rectangle.x - radius * 2), rectangle.width + radius * 4),
    Math.min(sourceCanvas.height - Math.max(0, rectangle.y - radius * 2), rectangle.height + radius * 4),
  );
  context.restore();
}

function applyRedaction(context, sourceCanvas, rectangle) {
  const padded = padRectangle(
    rectangle,
    state.padding,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  if (padded.width < 1 || padded.height < 1) return;

  if (state.style === "solid") {
    context.save();
    context.fillStyle = "#18221e";
    context.fillRect(padded.x, padded.y, padded.width, padded.height);
    context.restore();
    return;
  }
  if (state.style === "blur") {
    drawBlur(context, sourceCanvas, padded);
    return;
  }
  drawMosaic(context, sourceCanvas, padded);
}

function renderCanvas() {
  if (!state.imageCanvas) return;
  const context = elements.editorCanvas.getContext("2d");
  context.clearRect(0, 0, elements.editorCanvas.width, elements.editorCanvas.height);
  context.drawImage(state.imageCanvas, 0, 0);

  if (!state.revealOriginal) {
    for (const region of state.regions) {
      if (!region.enabled) continue;
      applyRedaction(context, state.imageCanvas, region.rect);
    }
  }

  for (const region of state.regions) {
    if (!region.enabled) continue;
    const padded = padRectangle(
      region.rect,
      state.padding,
      state.imageCanvas.width,
      state.imageCanvas.height,
    );
    const selected = region.id === state.selectedRegionId;
    context.save();
    context.setLineDash(selected ? [] : [6, 5]);
    context.lineWidth = selected ? 2 : 1;
    context.strokeStyle = selected ? "#fffaf4" : "rgba(255,250,244,.74)";
    context.strokeRect(padded.x + 0.5, padded.y + 0.5, padded.width - 1, padded.height - 1);
    context.restore();
  }

  if (state.manualPreview) {
    context.save();
    context.setLineDash([7, 5]);
    context.lineWidth = 1.5;
    context.strokeStyle = "#fffaf4";
    context.fillStyle = "rgba(227, 95, 98, .22)";
    context.fillRect(
      state.manualPreview.x,
      state.manualPreview.y,
      state.manualPreview.width,
      state.manualPreview.height,
    );
    context.strokeRect(
      state.manualPreview.x,
      state.manualPreview.y,
      state.manualPreview.width,
      state.manualPreview.height,
    );
    context.restore();
  }
}

function renderAll() {
  renderControls();
  renderCanvas();
  renderRegionList();
  createIcons();
}

function maskValue(value = "") {
  const compact = String(value).replace(/\s+/g, "");
  if (compact.length <= 5) return compact;
  return `${compact.slice(0, 3)}••••${compact.slice(-3)}`;
}

function renderRegionList() {
  const counts = {
    face: state.regions.filter((region) => region.type === "face").length,
    text: state.regions.filter((region) => ["phone", "id", "plate"].includes(region.type)).length,
    qr: state.regions.filter((region) => region.type === "qr").length,
  };
  elements.regionCount.textContent = String(state.regions.length);
  elements.faceCount.textContent = String(counts.face);
  elements.textCount.textContent = String(counts.text);
  elements.qrCount.textContent = String(counts.qr);
  elements.regionEmpty.hidden = state.regions.length > 0;

  const fragment = document.createDocumentFragment();
  for (const region of state.regions) {
    const item = document.createElement("div");
    item.className = `region-item${region.enabled ? "" : " is-disabled"}`;
    item.dataset.type = region.type;
    item.dataset.regionId = region.id;

    const icon = document.createElement("span");
    icon.className = "region-type-icon";
    icon.innerHTML = `<i data-lucide="${REGION_ICONS[region.type] || "scan"}"></i>`;

    const copy = document.createElement("div");
    copy.className = "region-copy";
    const title = document.createElement("strong");
    title.textContent =
      region.value && region.type !== "face" && region.type !== "qr"
        ? `${region.label} · ${maskValue(region.value)}`
        : region.label;
    const detail = document.createElement("small");
    detail.textContent =
      region.source === "manual"
        ? "手动补框"
        : region.source === "ocr"
          ? `OCR · 置信度 ${Math.round(region.confidence || 0)}%`
          : region.type === "face"
            ? `本地 AI · ${Math.round((region.confidence || 0) * 100)}%`
            : "本地识别";
    copy.append(title, detail);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "region-action";
    toggle.dataset.regionAction = "toggle";
    toggle.setAttribute("aria-label", region.enabled ? "临时取消遮挡" : "恢复遮挡");
    toggle.title = region.enabled ? "临时取消遮挡" : "恢复遮挡";
    toggle.innerHTML = `<i data-lucide="${region.enabled ? "eye" : "eye-off"}"></i>`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "region-action";
    remove.dataset.regionAction = "remove";
    remove.setAttribute("aria-label", "删除这个遮挡区域");
    remove.title = "删除遮挡区域";
    remove.innerHTML = '<i data-lucide="x"></i>';

    item.append(icon, copy, toggle, remove);
    fragment.append(item);
  }
  elements.regionList.replaceChildren(fragment);
  if (!state.regions.length) elements.regionList.append(elements.regionEmpty);
  renderControls();
}

function updateImageMetadata(name, dimensions, resized) {
  state.sourceName = (name || "image").replace(/\.[^.]+$/, "") || "image";
  state.sourceDimensions = dimensions;
  state.resized = resized;
  elements.imageCounter.textContent = resized ? "RESIZED FOR MEMORY" : "LOCAL IMAGE";
  elements.imageDimensions.textContent = resized
    ? `${dimensions.width} × ${dimensions.height} · 已优化`
    : `${dimensions.width} × ${dimensions.height}`;
  elements.editorHint.textContent = resized
    ? "超大图片已缩小到安全编辑尺寸，导出会保留当前画布分辨率。"
    : "图片只在当前标签页内处理，刷新即清除。";
}

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return createImageBitmap(file);
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasFromSource(source, name, originalDimensions = null) {
  const width = source.width;
  const height = source.height;
  if (!width || !height) throw new Error("Empty image.");

  const ratio = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * ratio));
  const targetHeight = Math.max(1, Math.round(height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  if (typeof source.close === "function") source.close();

  state.imageCanvas = canvas;
  state.regions = [];
  state.history = [];
  state.future = [];
  state.selectedRegionId = null;
  state.manualStart = null;
  state.manualPreview = null;
  state.scanToken += 1;
  state.scanning = false;
  elements.scanOverlay.hidden = true;
  elements.emptyState.hidden = true;
  elements.canvasScroll.hidden = false;
  updateImageMetadata(name, originalDimensions || { width, height }, ratio < 1);
  drawImageSource();
  renderAll();
}

async function loadImageFile(file) {
  if (!file?.type?.startsWith("image/")) {
    showToast("请选择 PNG、JPEG、WebP、GIF 或 BMP 图片");
    return;
  }
  if (file.size > 80 * 1024 * 1024) {
    showToast("图片超过 80 MB，建议先压缩后再导入");
    return;
  }

  try {
    elements.editorHint.textContent = "正在本地解码图片…";
    const source = await decodeImage(file);
    canvasFromSource(
      source,
      file.name,
      { width: source.width, height: source.height },
    );
    showToast("图片已载入，点击自动识别或直接拖动补框");
  } catch {
    elements.editorHint.textContent = "图片解码失败，请尝试其他格式。";
    showToast("无法读取这张图片");
  }
}

async function loadDemo() {
  try {
    const qr = new Image();
    qr.src = "assets/demo-qr.png";
    await qr.decode();

    const canvas = document.createElement("canvas");
    canvas.width = 1440;
    canvas.height = 900;
    const context = canvas.getContext("2d");
    context.fillStyle = "#e7dccd";
    context.fillRect(0, 0, canvas.width, canvas.height);

    context.save();
    context.shadowColor = "rgba(51, 38, 25, .18)";
    context.shadowBlur = 36;
    context.shadowOffsetY = 18;
    context.fillStyle = "#fffdf7";
    context.fillRect(110, 100, 1220, 700);
    context.restore();

    context.fillStyle = "#20231f";
    context.font = '700 28px "Segoe UI", sans-serif';
    context.fillText("VEIL CLINIC · DEMO DOCUMENT", 165, 170);
    context.fillStyle = "#e35f62";
    context.fillRect(165, 190, 220, 3);

    context.fillStyle = "#d9d1c6";
    context.beginPath();
    context.arc(255, 345, 78, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.ellipse(255, 500, 115, 78, 0, Math.PI, 0);
    context.fill();

    context.font = '600 27px "Courier New", monospace';
    context.fillStyle = "#303630";
    context.fillText("PHONE", 430, 290);
    context.fillText("138 0013 8000", 610, 290);
    context.fillText("ID", 430, 355);
    context.fillText("11010519491231002X", 610, 355);
    context.fillText("PLATE", 430, 420);
    context.fillText("AB-1234", 610, 420);
    context.fillText("VISIT", 430, 485);
    context.fillText("2026-10-28", 610, 485);

    context.font = '400 22px "Segoe UI", sans-serif';
    context.fillStyle = "#777b74";
    context.fillText("This document is generated for local testing.", 165, 655);
    context.fillText("All names, numbers and identifiers above are fictitious.", 165, 692);

    context.drawImage(qr, 1010, 240, 240, 240);
    context.font = '500 17px "Segoe UI", sans-serif';
    context.fillStyle = "#777b74";
    context.fillText("DEMO QR", 1085, 515);

    canvasFromSource(canvas, "veil-demo.png", {
      width: canvas.width,
      height: canvas.height,
    });
    showToast("示例图片已载入，可测试 OCR 与二维码识别");
  } catch {
    showToast("示例图片加载失败");
  }
}

function setScanProgress(status, fraction) {
  const percent = Math.round(clampNumber(fraction, 0, 1) * 100);
  elements.scanStatus.textContent = status;
  elements.scanProgressFill.style.width = `${percent}%`;
  elements.scanProgressLabel.textContent = `${percent}%`;
  elements.scanOverlay.hidden = false;
}

function createScaledCanvas(sourceCanvas, maxEdge) {
  const ratio = Math.min(1, maxEdge / Math.max(sourceCanvas.width, sourceCanvas.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(sourceCanvas.width * ratio));
  canvas.height = Math.max(1, Math.round(sourceCanvas.height * ratio));
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(sourceCanvas, 0, 0, canvas.width, canvas.height);
  return { canvas, ratio };
}

async function detectQrCode() {
  const decoder = window.jsQR?.default || window.jsQR;
  if (typeof decoder !== "function") return [];
  const { canvas, ratio } = createScaledCanvas(state.imageCanvas, MAX_SCAN_EDGE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const result = decoder(imageData.data, canvas.width, canvas.height, {
    inversionAttempts: "attemptBoth",
  });
  if (!result?.location) return [];
  const rect = qrLocationToRectangle(result.location);
  if (!rect) return [];
  return [
    createRegion(
      "qr",
      "二维码",
      {
        x: rect.x / ratio,
        y: rect.y / ratio,
        width: rect.width / ratio,
        height: rect.height / ratio,
      },
      "qr",
    ),
  ];
}

async function getFaceModel() {
  if (!window.tf || !window.blazeface?.load) {
    throw new Error("Face model runtime unavailable.");
  }
  if (!state.faceModelPromise) {
    state.faceModelPromise = (async () => {
      await window.tf.ready();
      state.faceModel = await window.blazeface.load({
        maxFaces: 20,
        inputWidth: 128,
        inputHeight: 128,
        iouThreshold: 0.3,
        scoreThreshold: 0.68,
        modelUrl: new URL("assets/models/blazeface/model.json", location.href).href,
      });
      return state.faceModel;
    })().catch((error) => {
      state.faceModelPromise = null;
      throw error;
    });
  }
  return state.faceModelPromise;
}

async function detectFaces() {
  try {
    const model = await getFaceModel();
    const predictions = await model.estimateFaces(state.imageCanvas, false, false, false);
    return predictions
      .map((prediction) => {
        const left = Number(prediction.topLeft?.[0]);
        const top = Number(prediction.topLeft?.[1]);
        const right = Number(prediction.bottomRight?.[0]);
        const bottom = Number(prediction.bottomRight?.[1]);
        if (![left, top, right, bottom].every(Number.isFinite)) return null;
        return createRegion(
          "face",
          "人脸",
          clampRectangle(
            { x: left, y: top, width: right - left, height: bottom - top },
            state.imageCanvas.width,
            state.imageCanvas.height,
          ),
          "face",
          { confidence: Number(prediction.probability) || 0.9 },
        );
      })
      .filter(Boolean);
  } catch (error) {
    if (!window.FaceDetector) throw error;
    const nativeDetector = new window.FaceDetector({
      fastMode: false,
      maxDetectedFaces: 20,
    });
    const faces = await nativeDetector.detect(state.imageCanvas);
    return faces.map((face) =>
      createRegion(
        "face",
        "人脸",
        clampRectangle(face.boundingBox, state.imageCanvas.width, state.imageCanvas.height),
        "face",
        { confidence: 0.9 },
      ),
    );
  }
}

function setOcrProgress(message) {
  if (!state.scanning) return;
  const progress = Number(message?.progress) || 0;
  const mapped = 0.48 + clampNumber(progress, 0, 1) * 0.46;
  const statusMap = {
    "loading tesseract core": "加载本地 OCR 核心",
    "initializing tesseract": "初始化本地 OCR",
    "loading language traineddata": "加载中英文 OCR 数据",
    "initializing api": "初始化识别语言",
    "recognizing text": "识别中英文文字与号码",
  };
  setScanProgress(statusMap[message?.status] || "OCR 正在本地处理", mapped);
}

async function getOcrWorker() {
  if (!window.Tesseract?.createWorker) throw new Error("OCR runtime unavailable.");
  if (!state.ocrWorkerPromise) {
    const assetBase = new URL("assets/vendor/tesseract/", location.href);
    let rejectWorker;
    const initializationTimeout = window.setTimeout(() => {
      rejectWorker?.(new Error("OCR initialization timed out."));
    }, 90_000);
    const workerReady = new Promise((resolve, reject) => {
      rejectWorker = reject;
      window.Tesseract.createWorker("eng+chi_sim", 1, {
        workerPath: new URL("worker.min.js", assetBase).href,
        corePath: assetBase.href.replace(/\/$/, ""),
        langPath: assetBase.href.replace(/\/$/, ""),
        cacheMethod: "write",
        gzip: false,
        logger: setOcrProgress,
        errorHandler: (message) => reject(new Error(String(message))),
      }).then(resolve, reject);
    });

    state.ocrWorkerPromise = workerReady
      .then(async (worker) => {
        window.clearTimeout(initializationTimeout);
        await worker.setParameters({
          tessedit_pageseg_mode: "3",
          preserve_interword_spaces: "1",
        });
        state.ocrWorker = worker;
        return worker;
      })
      .catch((error) => {
        window.clearTimeout(initializationTimeout);
        state.ocrWorkerPromise = null;
        state.ocrWorker = null;
        throw error;
      });
  }
  return state.ocrWorkerPromise;
}

async function detectOcrText() {
  const worker = await getOcrWorker();
  const { canvas, ratio } = createScaledCanvas(state.imageCanvas, MAX_SCAN_EDGE);
  const result = await worker.recognize(canvas, {}, { blocks: true, text: true });
  const lines = flattenTesseractLines(result.data).map((line) => ({
    ...line,
    bbox: line.bbox
      ? {
          x: line.bbox.x / ratio,
          y: line.bbox.y / ratio,
          width: line.bbox.width / ratio,
          height: line.bbox.height / ratio,
        }
      : null,
  }));
  return detectSensitiveLines(lines, state.detection);
}

async function runScan() {
  if (!state.imageCanvas || state.scanning) return;
  const token = ++state.scanToken;
  state.scanning = true;
  renderControls();
  setScanProgress("本地二维码扫描", 0.08);

  const manualRegions = state.regions.filter((region) => region.source === "manual");
  const detected = [];
  const warnings = [];

  try {
    if (state.detection.qr) {
      try {
        detected.push(...(await detectQrCode()));
      } catch {
        warnings.push("二维码");
      }
    }

    if (token !== state.scanToken) return;
    if (state.detection.faces) {
      setScanProgress("加载本地人脸模型", 0.2);
      try {
        detected.push(...(await detectFaces()));
      } catch {
        warnings.push("人脸");
      }
    }

    if (token !== state.scanToken) return;
    if (state.detection.phones || state.detection.ids || state.detection.plates) {
      setScanProgress("加载本地 OCR", 0.46);
      try {
        detected.push(...(await detectOcrText()));
      } catch {
        warnings.push("OCR");
      }
    }

    if (token !== state.scanToken) return;
    setScanProgress("整理识别区域", 0.98);
    const nextRegions = dedupeRegions([...manualRegions, ...detected]);
    pushHistory();
    state.regions = nextRegions;
    state.selectedRegionId = null;
    renderAll();
    setScanProgress("识别完成", 1);
    window.setTimeout(() => {
      if (token === state.scanToken) elements.scanOverlay.hidden = true;
    }, 350);

    const warningText = warnings.length ? `；${warnings.join("、")}模块未完成` : "";
    showToast(
      detected.length
        ? `发现 ${detected.length} 个敏感区域${warningText}`
        : `没有自动发现的区域，请手动检查${warningText}`,
    );
  } catch {
    if (token === state.scanToken) {
      elements.scanOverlay.hidden = true;
      showToast("识别流程未完成，请重试或手动补框");
    }
  } finally {
    state.scanning = false;
    renderControls();
  }
}

function getCanvasPoint(event) {
  const rectangle = elements.editorCanvas.getBoundingClientRect();
  const scaleX = elements.editorCanvas.width / rectangle.width;
  const scaleY = elements.editorCanvas.height / rectangle.height;
  return {
    x: clampNumber((event.clientX - rectangle.left) * scaleX, 0, elements.editorCanvas.width),
    y: clampNumber((event.clientY - rectangle.top) * scaleY, 0, elements.editorCanvas.height),
  };
}

function beginManualSelection(event) {
  if (!state.imageCanvas || state.scanning || event.button !== 0) return;
  const point = getCanvasPoint(event);
  state.manualStart = point;
  state.manualPreview = { x: point.x, y: point.y, width: 0, height: 0 };
  elements.editorCanvas.setPointerCapture?.(event.pointerId);
  renderCanvas();
}

function updateManualSelection(event) {
  if (!state.manualStart) return;
  const point = getCanvasPoint(event);
  state.manualPreview = clampRectangle(
    {
      x: Math.min(state.manualStart.x, point.x),
      y: Math.min(state.manualStart.y, point.y),
      width: Math.abs(point.x - state.manualStart.x),
      height: Math.abs(point.y - state.manualStart.y),
    },
    elements.editorCanvas.width,
    elements.editorCanvas.height,
  );
  renderCanvas();
}

function finishManualSelection(event) {
  if (!state.manualStart) return;
  updateManualSelection(event);
  const rect = state.manualPreview;
  state.manualStart = null;
  state.manualPreview = null;
  if (rect && rect.width >= 8 && rect.height >= 8) {
    pushHistory();
    state.regions = [
      ...state.regions,
      createRegion("manual", "手动遮挡", rect, "manual"),
    ];
    renderAll();
    showToast("已添加手动遮挡");
  } else {
    renderCanvas();
  }
}

function cancelManualSelection() {
  state.manualStart = null;
  state.manualPreview = null;
  renderCanvas();
}

function handleRegionListClick(event) {
  const action = event.target.closest("[data-region-action]");
  const row = event.target.closest("[data-region-id]");
  if (!row) return;
  const region = state.regions.find((item) => item.id === row.dataset.regionId);
  if (!region) return;

  if (!action) {
    state.selectedRegionId = state.selectedRegionId === region.id ? null : region.id;
    renderCanvas();
    return;
  }
  pushHistory();
  if (action.dataset.regionAction === "toggle") {
    region.enabled = !region.enabled;
  } else if (action.dataset.regionAction === "remove") {
    state.regions = state.regions.filter((item) => item.id !== region.id);
  }
  state.selectedRegionId = null;
  renderAll();
}

function renderRedactedCanvas() {
  const output = document.createElement("canvas");
  output.width = state.imageCanvas.width;
  output.height = state.imageCanvas.height;
  const context = output.getContext("2d");
  context.drawImage(state.imageCanvas, 0, 0);
  for (const region of state.regions) {
    if (!region.enabled) continue;
    applyRedaction(context, state.imageCanvas, region.rect);
  }
  return output;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas export failed."))),
      type,
      quality,
    );
  });
}

async function exportImage() {
  if (!state.imageCanvas || !state.regions.some((region) => region.enabled)) {
    showToast("请先添加至少一个有效遮挡区域");
    return;
  }
  try {
    const canvas = renderRedactedCanvas();
    const blob = await canvasToBlob(
      canvas,
      state.format,
      state.quality / 100,
    );
    const extension = state.format === "image/jpeg" ? "jpg" : "png";
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.sourceName}-redacted.${extension}`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    showToast("安全图片已导出，原始元数据不会写入");
  } catch {
    showToast("导出失败，请尝试改用 PNG");
  }
}

async function copyImage() {
  if (!state.imageCanvas || !state.regions.some((region) => region.enabled)) {
    showToast("请先添加至少一个有效遮挡区域");
    return;
  }
  if (!navigator.clipboard?.write || !window.ClipboardItem) {
    showToast("当前浏览器不支持图片剪贴板");
    return;
  }
  try {
    const blob = await canvasToBlob(renderRedactedCanvas(), "image/png");
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": blob }),
    ]);
    showToast("安全图片已复制");
  } catch {
    showToast("无法写入剪贴板，请使用导出按钮");
  }
}

function setupFileHandling() {
  elements.uploadButton.addEventListener("click", () => elements.imageInput.click());
  elements.emptyUploadButton.addEventListener("click", () => elements.imageInput.click());
  elements.imageInput.addEventListener("change", () => {
    const [file] = elements.imageInput.files || [];
    if (file) loadImageFile(file);
    elements.imageInput.value = "";
  });
  elements.demoButton.addEventListener("click", loadDemo);

  let dragDepth = 0;
  elements.canvasStage.addEventListener("dragenter", (event) => {
    event.preventDefault();
    dragDepth += 1;
    elements.dragOverlay.hidden = false;
  });
  elements.canvasStage.addEventListener("dragover", (event) => {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  elements.canvasStage.addEventListener("dragleave", () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) elements.dragOverlay.hidden = true;
  });
  elements.canvasStage.addEventListener("drop", (event) => {
    event.preventDefault();
    dragDepth = 0;
    elements.dragOverlay.hidden = true;
    const file = [...(event.dataTransfer?.files || [])].find((item) =>
      item.type.startsWith("image/"),
    );
    if (file) loadImageFile(file);
  });

  document.addEventListener("paste", (event) => {
    const item = [...(event.clipboardData?.items || [])].find((entry) =>
      entry.type.startsWith("image/"),
    );
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      loadImageFile(file);
    }
  });
}

function setupControls() {
  for (const [element, key] of [
    [elements.detectFaces, "faces"],
    [elements.detectPhones, "phones"],
    [elements.detectIds, "ids"],
    [elements.detectPlates, "plates"],
    [elements.detectQr, "qr"],
  ]) {
    element.addEventListener("change", () => {
      state.detection[key] = element.checked;
      storeSettings();
    });
  }

  elements.styleControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-style]");
    if (button) setRedactionStyle(button.dataset.style);
  });
  elements.strengthRange.addEventListener("input", () => {
    state.strength = clampNumber(elements.strengthRange.value, 1, 10);
    renderControls();
    renderCanvas();
    storeSettings();
  });
  elements.paddingRange.addEventListener("input", () => {
    state.padding = clampNumber(elements.paddingRange.value, 0, 32);
    renderControls();
    renderCanvas();
    storeSettings();
  });
  elements.formatControl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-format]");
    if (button) setFormat(button.dataset.format);
  });
  elements.qualityRange.addEventListener("input", () => {
    state.quality = clampNumber(elements.qualityRange.value, 60, 100);
    renderControls();
    storeSettings();
  });

  elements.scanButton.addEventListener("click", runScan);
  elements.undoButton.addEventListener("click", undo);
  elements.redoButton.addEventListener("click", redo);
  elements.resetRegionsButton.addEventListener("click", clearRegions);
  elements.exportButton.addEventListener("click", exportImage);
  elements.copyImageButton.addEventListener("click", copyImage);
  elements.regionList.addEventListener("click", handleRegionListClick);

  const reveal = (enabled) => {
    if (!state.imageCanvas) return;
    state.revealOriginal = enabled;
    renderCanvas();
  };
  elements.revealButton.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    reveal(true);
  });
  window.addEventListener("pointerup", () => reveal(false));
  elements.revealButton.addEventListener("pointerleave", () => reveal(false));

  elements.editorCanvas.addEventListener("pointerdown", beginManualSelection);
  elements.editorCanvas.addEventListener("pointermove", updateManualSelection);
  elements.editorCanvas.addEventListener("pointerup", finishManualSelection);
  elements.editorCanvas.addEventListener("pointercancel", cancelManualSelection);
}

function setupInstallPrompt() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPrompt = event;
    elements.installButton.hidden = false;
  });
  elements.installButton.addEventListener("click", async () => {
    if (!state.installPrompt) return;
    state.installPrompt.prompt();
    const choice = await state.installPrompt.userChoice;
    if (choice.outcome === "accepted") showToast("VEIL 已添加到设备");
    state.installPrompt = null;
    elements.installButton.hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    elements.installButton.hidden = true;
    state.installPrompt = null;
    showToast("VEIL 已安装，可离线使用");
  });
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

function cleanupWorkers() {
  state.ocrWorker?.terminate?.().catch?.(() => {});
  state.faceModel?.dispose?.();
}

function init() {
  renderControls();
  setupFileHandling();
  setupControls();
  setupInstallPrompt();
  elements.year.textContent = new Date().getFullYear();
  window.addEventListener("pagehide", cleanupWorkers);
  createIcons();
  registerServiceWorker();
}

init();
