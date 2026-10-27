import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
const PORT = Number(process.env.PORT) || 4200;
const HOST = process.env.HOST || "127.0.0.1";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".bmp", "image/bmp"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".gz", "application/gzip"],
  [".bin", "application/octet-stream"],
  [".wasm", "application/wasm"],
  [".txt", "text/plain; charset=utf-8"],
]);

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

function setSecurityHeaders(response) {
  response.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
}

function resolveRequestPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const requestPath = decoded === "/" ? "/index.html" : decoded;
  const absolutePath = normalize(join(ROOT, requestPath));
  const pathFromRoot = relative(ROOT, absolutePath);
  if (pathFromRoot.startsWith("..") || pathFromRoot.includes(":")) return null;
  return absolutePath;
}

function sendText(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

const server = createServer(async (request, response) => {
  setSecurityHeaders(response);

  if (!["GET", "HEAD"].includes(request.method || "")) {
    response.setHeader("Allow", "GET, HEAD");
    sendText(response, 405, "Method Not Allowed");
    return;
  }

  let pathname;
  try {
    pathname = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`).pathname;
  } catch {
    sendText(response, 400, "Bad Request");
    return;
  }

  let filePath = resolveRequestPath(pathname);
  if (!filePath) {
    sendText(response, 400, "Bad Request");
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (fileStat.isDirectory()) {
      filePath = join(filePath, "index.html");
      fileStat = await stat(filePath);
    }
  } catch {
    sendText(response, 404, "Not Found");
    return;
  }

  const extension = extname(filePath).toLowerCase();
  const cacheControl =
    pathname === "/sw.js" || extension === ".html"
      ? "no-cache"
      : pathname.startsWith("/assets/vendor/") || pathname.startsWith("/assets/models/")
        ? "public, max-age=31536000, immutable"
        : "public, max-age=3600";

  response.writeHead(200, {
    "Content-Type": MIME_TYPES.get(extension) || "application/octet-stream",
    "Content-Length": fileStat.size,
    "Cache-Control": cacheControl,
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
});

server.listen(PORT, HOST, () => {
  console.log(`VEIL is running at http://${HOST}:${PORT}`);
});
