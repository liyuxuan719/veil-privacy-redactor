import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_DETECTION_OPTIONS,
  clampRectangle,
  dedupeRegions,
  detectSensitiveLines,
  findMatches,
  padRectangle,
  qrLocationToRectangle,
  rectangleIoU,
  rectUnion,
  scanQrRectangles,
} from "../src/redaction.js";

const bbox = { x: 10, y: 20, width: 200, height: 30 };

test("Chinese mobile numbers are detected with common separators", () => {
  for (const phone of ["13800138000", "138 0013 8000", "+86 138-0013-8000"]) {
    const matches = findMatches({ text: `电话 ${phone}`, bbox });
    assert.ok(matches.some((match) => match.type === "phone"), phone);
  }
});

test("18-digit and legacy 15-digit IDs are detected", () => {
  const modern = findMatches({ text: "11010519491231002X", bbox });
  const legacy = findMatches({ text: "110105491231002", bbox });
  assert.ok(modern.some((match) => match.type === "id"));
  assert.ok(legacy.some((match) => match.type === "id"));
});

test("license plate-like alphanumeric values are detected", () => {
  const cn = findMatches({ text: "京A12345", bbox });
  const international = findMatches({ text: "AB-1234", bbox });
  assert.ok(cn.some((match) => match.type === "plate"));
  assert.ok(international.some((match) => match.type === "plate"));
});

test("categories can be disabled independently", () => {
  const options = { ...DEFAULT_DETECTION_OPTIONS, phones: false };
  const matches = findMatches({ text: "13800138000", bbox }, options);
  assert.equal(matches.some((match) => match.type === "phone"), false);
});

test("ISO dates are not misclassified as telephone numbers", () => {
  const matches = findMatches({ text: "VISIT 2026-10-28", bbox });
  assert.equal(matches.some((match) => match.type === "phone"), false);
});

test("sensitive OCR lines become enabled auto regions", () => {
  const regions = detectSensitiveLines([
    { text: "联系电话 138 0013 8000", bbox, confidence: 91 },
    { text: "普通说明文字", bbox: { x: 0, y: 60, width: 100, height: 20 } },
  ]);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].type, "phone");
  assert.equal(regions[0].enabled, true);
  assert.equal(regions[0].source, "ocr");
});

test("rectangle helpers clamp, pad, union, and calculate overlap", () => {
  assert.deepEqual(rectUnion([
    { x: 10, y: 10, width: 20, height: 20 },
    { x: 40, y: 5, width: 20, height: 10 },
  ]), { x: 10, y: 5, width: 50, height: 25 });
  assert.deepEqual(clampRectangle({ x: -10, y: 10, width: 30, height: 50 }, 100, 40), {
    x: 0,
    y: 10,
    width: 20,
    height: 30,
  });
  assert.deepEqual(padRectangle({ x: 10, y: 10, width: 20, height: 20 }, 5, 100, 100), {
    x: 5,
    y: 5,
    width: 30,
    height: 30,
  });
  assert.equal(rectangleIoU(
    { x: 0, y: 0, width: 10, height: 10 },
    { x: 5, y: 0, width: 10, height: 10 },
  ), 1 / 3);
});

test("duplicate regions with the same type and overlap are collapsed", () => {
  const region = {
    type: "face",
    label: "人脸",
    rect: { x: 10, y: 10, width: 80, height: 80 },
  };
  const result = dedupeRegions([
    { ...region, id: "a" },
    { ...region, id: "b", rect: { ...region.rect, x: 11 } },
  ]);
  assert.equal(result.length, 1);
});

test("QR corner points convert into a bounding rectangle", () => {
  const rect = qrLocationToRectangle({
    topLeftCorner: { x: 10, y: 20 },
    topRightCorner: { x: 70, y: 20 },
    bottomRightCorner: { x: 70, y: 80 },
    bottomLeftCorner: { x: 10, y: 80 },
  });
  assert.deepEqual(rect, { x: 10, y: 20, width: 60, height: 60 });
});

test("email detection covers common addresses and can be disabled", () => {
  for (const address of ["alice@example.com", "first.last+tag@sub.example.co.uk"]) {
    const matches = findMatches({ text: `邮箱 ${address}。`, bbox });
    assert.ok(matches.some((match) => match.type === "email" && match.value === address));
  }
  assert.equal(findMatches({ text: "alice@example.com" }, {
    ...DEFAULT_DETECTION_OPTIONS, emails: false,
  }).some((match) => match.type === "email"), false);
  const regions = detectSensitiveLines([{ text: "alice@example.com", bbox }]);
  assert.equal(regions[0].type, "email");
  assert.deepEqual(regions[0].rect, bbox);
});

const qrLocation = (x, y, size = 3) => ({
  topLeftCorner: { x, y }, topRightCorner: { x: x + size, y },
  bottomRightCorner: { x: x + size, y: y + size },
  bottomLeftCorner: { x, y: y + size },
});

test("multiple QR codes are found without mutating the original image", () => {
  const image = { width: 20, height: 10, data: new Uint8ClampedArray(800) };
  let calls = 0;
  const rectangles = scanQrRectangles(image, (pixels) => {
    calls += 1;
    if (pixels[0] === 0) return { location: qrLocation(0, 0) };
    if (pixels[(2 * 20 + 12) * 4] === 0) return { location: qrLocation(12, 2) };
    return null;
  });
  assert.equal(rectangles.length, 2);
  assert.equal(calls, 3);
  assert.ok(image.data.every((pixel) => pixel === 0));
});

test("QR scanning stops on repeat or malformed detections and respects limits", () => {
  const image = { width: 20, height: 20, data: new Uint8ClampedArray(1600) };
  let calls = 0;
  assert.equal(scanQrRectangles(image, () => {
    calls += 1;
    return { location: qrLocation(2, 2) };
  }).length, 1);
  assert.equal(calls, 2);
  assert.deepEqual(scanQrRectangles(image, () => ({ location: qrLocation(NaN, 0) })), []);
  assert.equal(scanQrRectangles(image, () => ({ location: qrLocation(0, 0) }), 1).length, 1);
  assert.throws(() => scanQrRectangles({ width: 1, height: 2, data: [] }, () => null), TypeError);
});
