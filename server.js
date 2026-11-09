// Khabar dev server: serves /public and builds /news.json live from the feeds.
// The live site is static (see scripts/build.mjs); this is for working locally. No dependencies.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { getNews } from "./lib/news.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 5173;

const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/news.json" || url.pathname === "/api/news") {
    try {
      const data = await getNews();
      const region = url.searchParams.get("region");
      const items = region === "india" || region === "world" ? data.items.filter((i) => i.region === region) : data.items;
      const body = JSON.stringify({ ...data, items });
      const headers = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" };
      if (/\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
        res.writeHead(200, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
        res.end(gzipSync(body));
      } else {
        res.writeHead(200, headers);
        res.end(body);
      }
    } catch (err) {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Could not reach the news feeds." }));
    }
    return;
  }
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "") || "index.html";
  const file = join(ROOT, rel);
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
  }
});

server.listen(PORT, () => console.log(`Khabar running at http://localhost:${PORT}`));
