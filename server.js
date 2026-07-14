const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = __dirname;
const shareDir = path.join(root, "shares");
const port = Number(process.env.PORT || 4288);
const photoTtlMs = Number(process.env.PHOTO_TTL_HOURS || 24) * 60 * 60 * 1000;

fs.mkdirSync(shareDir, { recursive: true });

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml; charset=utf-8",
};

function localAddress() {
  const nets = os.networkInterfaces();
  for (const infos of Object.values(nets)) {
    for (const info of infos || []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return "127.0.0.1";
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": type.startsWith("image/") ? "public, max-age=86400" : "no-store",
  });
  res.end(body);
}

function publicBaseUrl(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${port}`;
  const proto = req.headers["x-forwarded-proto"] || (String(host).startsWith("localhost") ? "http" : "https");
  return `${String(proto).split(",")[0]}://${String(host).split(",")[0]}`;
}

function cleanupOldPhotos() {
  fs.readdir(shareDir, (error, files) => {
    if (error) return;
    const now = Date.now();
    files
      .filter((name) => name.endsWith(".png"))
      .forEach((name) => {
        const file = path.join(shareDir, name);
        fs.stat(file, (statError, stats) => {
          if (!statError && now - stats.mtimeMs > photoTtlMs) {
            fs.unlink(file, () => {});
          }
        });
      });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error("too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function serveFile(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(root, requested));

  if (!filePath.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      send(res, 404, "Not found");
      return;
    }
    const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, JSON.stringify({ ok: true, app: "Ada's Photobooth" }), "application/json; charset=utf-8");
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/photos") {
    try {
      const payload = JSON.parse(await readBody(req));
      const match = /^data:image\/png;base64,(.+)$/.exec(payload.image || "");
      if (!match) {
        send(res, 400, JSON.stringify({ error: "Invalid image" }), "application/json; charset=utf-8");
        return;
      }

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const file = path.join(shareDir, `${id}.png`);
      fs.writeFileSync(file, Buffer.from(match[1], "base64"));
      const downloadUrl = `${publicBaseUrl(req)}/download/${id}.png`;
      send(res, 200, JSON.stringify({ downloadUrl }), "application/json; charset=utf-8");
    } catch (error) {
      send(res, 500, JSON.stringify({ error: "Save failed" }), "application/json; charset=utf-8");
    }
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/download/")) {
    const name = path.basename(url.pathname);
    const file = path.join(shareDir, name);
    fs.readFile(file, (error, data) => {
      if (error) {
        send(res, 404, "Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Disposition": `attachment; filename="${name}"`,
      });
      res.end(data);
    });
    return;
  }

  serveFile(req, res);
});

server.listen(port, "0.0.0.0", () => {
  const url = `http://localhost:${port}`;
  const lan = `http://${localAddress()}:${port}`;
  console.log(`Ada's Photobooth is ready: ${url}`);
  console.log(`LAN access: ${lan}`);
  if (process.env.PUBLIC_BASE_URL) console.log(`Public URL: ${process.env.PUBLIC_BASE_URL}`);
});

cleanupOldPhotos();
setInterval(cleanupOldPhotos, 60 * 60 * 1000);
