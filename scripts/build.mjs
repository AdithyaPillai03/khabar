// Static build for GitHub Pages: copies public/ to dist/ and writes dist/news.json from the feeds.
// Usage: node scripts/build.mjs            (SITE_URL=https://you.github.io/repo to reuse last run's photos)
import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getNews, seedImages } from "../lib/news.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const site = (process.env.SITE_URL || "").replace(/\/$/, "");
if (site) {
  try {
    const res = await fetch(`${site}/news.json`, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const prev = await res.json();
      seedImages(prev.items);
      console.log(`Reused photos for ${prev.items?.length ?? 0} stories from the last build.`);
    }
  } catch { console.log("No previous news.json to reuse; looking up every photo."); }
}

const data = await getNews();
for (const s of data.sources) console.log(`${s.error ? "FAIL" : " ok "} ${s.region.padEnd(5)} ${s.source.padEnd(16)} ${s.count}${s.error ? "  " + s.error : ""}`);
if (data.items.length < 20) {
  // Don't replace a good site with an empty one when the feeds are down.
  console.error(`Only ${data.items.length} stories came back; refusing to publish.`);
  process.exit(1);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(join(ROOT, "public"), DIST, { recursive: true });
await writeFile(join(DIST, "news.json"), JSON.stringify(data));
await writeFile(join(DIST, ".nojekyll"), "");
console.log(`Built dist/ with ${data.items.length} stories (${data.items.filter((i) => !i.image).length} without a photo).`);
