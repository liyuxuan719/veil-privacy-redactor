export const DEFAULT_DETECTION_OPTIONS = {
  faces: true,
  phones: true,
  ids: true,
  plates: true,
  qr: true,
};

const PATTERNS = {
  ids: [
    {
      type: "id",
      label: "证件号码",
      regex: /\b\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g,
    },
    {
      type: "id",
      label: "证件号码",
      regex: /\b\d{15}\b/g,
    },
  ],
  phones: [
    {
      type: "phone",
      label: "电话号码",
      regex: /(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d{4}){2}/g,
    },
    {
      type: "phone",
      label: "电话号码",
      regex: /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?(?:\d{3,4}[\s.-]?){2,4}\d{2,4}/g,
      validate: (value) => {
        const digits = value.replace(/\D/g, "");
        return (
          digits.length >= 7 &&
          digits.length <= 15 &&
          !/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$/.test(value)
        );
      },
    },
  ],
  plates: [
    {
      type: "plate",
      label: "车牌号码",
      regex: /[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-Z0-9]{5,6}/gi,
    },
    {
      type: "plate",
      label: "车牌号码",
      regex: /\b[A-Z0-9]{2,4}[-·\s]?[A-Z0-9]{2,5}\b/gi,
      validate: (value) => {
        const compact = value.replace(/[^A-Z0-9]/gi, "");
        return (
          compact.length >= 5 &&
          compact.length <= 9 &&
          /[A-Z]/i.test(compact) &&
          /\d/.test(compact)
        );
      },
    },
  ],
};

export function rectUnion(rectangles) {
  const valid = rectangles.filter(
    (rectangle) =>
      Number.isFinite(rectangle?.x) &&
      Number.isFinite(rectangle?.y) &&
      Number.isFinite(rectangle?.width) &&
      Number.isFinite(rectangle?.height),
  );
  if (!valid.length) return null;

  const left = Math.min(...valid.map((rectangle) => rectangle.x));
  const top = Math.min(...valid.map((rectangle) => rectangle.y));
  const right = Math.max(...valid.map((rectangle) => rectangle.x + rectangle.width));
  const bottom = Math.max(...valid.map((rectangle) => rectangle.y + rectangle.height));
  return {
    x: left,
    y: top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export function clampRectangle(rectangle, width, height) {
  const x = Math.max(0, Math.min(width, rectangle.x));
  const y = Math.max(0, Math.min(height, rectangle.y));
  const right = Math.max(0, Math.min(width, rectangle.x + rectangle.width));
  const bottom = Math.max(0, Math.min(height, rectangle.y + rectangle.height));
  return {
    x,
    y,
    width: Math.max(0, right - x),
    height: Math.max(0, bottom - y),
  };
}

export function padRectangle(rectangle, padding, width, height) {
  return clampRectangle(
    {
      x: rectangle.x - padding,
      y: rectangle.y - padding,
      width: rectangle.width + padding * 2,
      height: rectangle.height + padding * 2,
    },
    width,
    height,
  );
}

export function intersectionArea(first, second) {
  const left = Math.max(first.x, second.x);
  const top = Math.max(first.y, second.y);
  const right = Math.min(first.x + first.width, second.x + second.width);
  const bottom = Math.min(first.y + first.height, second.y + second.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

export function rectangleIoU(first, second) {
  const intersection = intersectionArea(first, second);
  if (!intersection) return 0;
  const union =
    first.width * first.height + second.width * second.height - intersection;
  return union > 0 ? intersection / union : 0;
}

export function createRegion(type, label, rectangle, source = "auto", metadata = {}) {
  return {
    id: `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    label,
    rect: { ...rectangle },
    enabled: true,
    source,
    ...metadata,
  };
}

export function findMatches(line, options = DEFAULT_DETECTION_OPTIONS) {
  const sourceText = String(line.text || "");
  const matches = [];

  for (const category of ["ids", "phones", "plates"]) {
    if (!options[category]) continue;
    for (const pattern of PATTERNS[category]) {
      pattern.regex.lastIndex = 0;
      for (const match of sourceText.matchAll(pattern.regex)) {
        const value = match[0].trim();
        if (!value) continue;
        if (pattern.validate && !pattern.validate(value)) continue;
        matches.push({
          type: pattern.type,
          label: pattern.label,
          value,
          index: match.index ?? 0,
        });
      }
    }
  }

  return matches.sort((first, second) => first.index - second.index);
}

export function detectSensitiveLines(lines, options = DEFAULT_DETECTION_OPTIONS) {
  const regions = [];
  for (const line of lines || []) {
    if (!line?.bbox) continue;
    const matches = findMatches(line, options);
    const primary = ["id", "phone", "plate"]
      .map((type) => matches.find((match) => match.type === type))
      .find(Boolean);
    if (!primary) continue;
    regions.push(
      createRegion(primary.type, primary.label, line.bbox, "ocr", {
        value: primary.value,
        confidence: Number(line.confidence) || 0,
      }),
    );
  }
  return dedupeRegions(regions);
}

export function dedupeRegions(regions) {
  const output = [];
  for (const region of regions) {
    const duplicate = output.some(
      (candidate) =>
        candidate.type === region.type &&
        rectangleIoU(candidate.rect, region.rect) > 0.78,
    );
    if (!duplicate) output.push(region);
  }
  return output;
}

export function flattenTesseractLines(page) {
  const lines = [];
  for (const block of page?.blocks || []) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const bbox = line.bbox
          ? {
              x: line.bbox.x0,
              y: line.bbox.y0,
              width: line.bbox.x1 - line.bbox.x0,
              height: line.bbox.y1 - line.bbox.y0,
            }
          : null;
        lines.push({
          text: line.text?.trim() || "",
          confidence: line.confidence || 0,
          bbox,
        });
      }
    }
  }
  return lines;
}

export function qrLocationToRectangle(location) {
  const points = [
    location?.topLeftCorner,
    location?.topRightCorner,
    location?.bottomRightCorner,
    location?.bottomLeftCorner,
  ].filter(Boolean);
  if (!points.length) return null;
  const left = Math.min(...points.map((point) => point.x));
  const top = Math.min(...points.map((point) => point.y));
  const right = Math.max(...points.map((point) => point.x));
  const bottom = Math.max(...points.map((point) => point.y));
  return { x: left, y: top, width: right - left, height: bottom - top };
}
