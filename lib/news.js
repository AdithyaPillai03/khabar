// Khabar feed logic: fetch public RSS feeds, clean, de-duplicate, sort newest first, fill missing photos.
// Shared by the dev server (server.js) and the static build (scripts/build.mjs). Needs Node 18+.
const CACHE_MS = 10 * 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const PER_FEED = 15;

// Public RSS feeds from the publishers themselves. Swap or add freely.
export const FEEDS = [
  { region: "india", source: "The Hindu", url: "https://www.thehindu.com/news/national/feeder/default.rss" },
  { region: "india", source: "Indian Express", url: "https://indianexpress.com/section/india/feed/" },
  { region: "india", source: "NDTV", url: "https://feeds.feedburner.com/ndtvnews-india-news" },
  { region: "india", source: "Hindustan Times", url: "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml" },
  { region: "india", source: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms" },
  { region: "india", source: "Mint", url: "https://www.livemint.com/rss/news" },
  { region: "world", source: "BBC News", url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { region: "world", source: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { region: "world", source: "The Guardian", url: "https://www.theguardian.com/world/rss" },
  { region: "world", source: "NPR", url: "https://feeds.npr.org/1004/rss.xml" },
  { region: "world", source: "DW", url: "https://rss.dw.com/rdf/rss-en-world" },
  { region: "world", source: "The Hindu", url: "https://www.thehindu.com/news/international/feeder/default.rss" },
];

// Words that make a story worth a heads-up before it is shown (gentle mode).
const SENSITIVE = /\b(kill(ed|ing|s)?|murder(ed|s)?|rape[ds]?|rapist|sexual(ly)? (assault\w*|abuse\w*|predator\w*|misconduct|offen\w+)|sex offen\w+|massacre|suicide|beheaded|torture[ds]?|shot dead|stabb(ed|ing)|lynch(ed|ing)?|bodies|corpse|child abuse|molest(ed|ation)?|gang-?raped?|death toll|dead|die|dies|died|bomb(ing|ed)?|blast|terror(ist|ism)? attack|airstrikes?)\b/i;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", hellip: "…", mdash: "—", ndash: "–", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
const unCdata = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
const stripTags = (s) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const clean = (s) => stripTags(decode(stripTags(unCdata(s || "")))); // twice: some feeds double-escape HTML

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}
function attr(xml, name, attribute) {
  const m = xml.match(new RegExp(`<${name}\\s[^>]*?${attribute}=["']([^"']+)["']`, "i"));
  return m ? decode(m[1]) : "";
}
function trimTo(s, n) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.\-–—]+$/, "") + "…";
}

function parseFeed(xml, feed) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.slice(0, PER_FEED).map((b) => {
    const rawDesc = tag(b, "description") || tag(b, "summary") || tag(b, "content:encoded") || tag(b, "content");
    const title = clean(tag(b, "title"));
    const summary = trimTo(clean(rawDesc), 320);
    const link = clean(tag(b, "link")) || attr(b, "link", "href") || clean(tag(b, "guid"));
    const dateRaw = clean(tag(b, "pubDate") || tag(b, "dc:date") || tag(b, "published") || tag(b, "updated"));
    const date = Date.parse(dateRaw);
    const descHtml = decode(unCdata(rawDesc + tag(b, "content:encoded")));
    let image =
      attr(b, "media:content", "url") ||
      attr(b, "media:thumbnail", "url") ||
      (/<enclosure[^>]+type=["']image/i.test(b) ? attr(b, "enclosure", "url") : "") ||
      (descHtml.match(/<img[^>]+src=["']([^"']+)["']/i) || [])[1] ||
      "";
    if (image && !/^https:\/\//i.test(image)) image = image.startsWith("//") ? "https:" + image : "";
    image = image.replace(/(ichef\.bbci\.co\.uk\/ace\/standard\/)\d+\//, "$1800/"); // BBC ships 240px thumbs; ask for 800
    return {
      id: link || title,
      title,
      summary: summary && summary !== title ? summary : "",
      link: /^https?:\/\//i.test(link) ? link : "",
      date: Number.isFinite(date) ? date : null,
      image,
      source: feed.source,
      region: feed.region,
      sensitive: SENSITIVE.test(title + " " + summary),
      topic: topicOf(title + " " + summary, feed.region),
    };
  });
}

// Rough topic from the words in a story; drives the cover when no photo exists.
const TOPICS = [
  ["Sport", /\b(cricket|ipl|t20|odi|wicket|football|fifa|tennis|olympic\w*|hockey|kabaddi|chess|grand prix|formula one|f1|badminton|athlet\w+|world cup|match(es)?|tournament|medal)\b/i],
  ["Business", /\b(sensex|nifty|stocks?|shares|markets?|economy|economic|gdp|rbi|inflation|rupee|budget|tax(es)?|tariffs?|trade|ipo|startups?|earnings|profit|revenue|investors?|banks?|prices?)\b/i],
  ["Science", /\b(isro|nasa|space|rocket|satellite|science|scientists?|research|study finds|ai|artificial intelligence|tech|technology|smartphones?|cyber\w*|chips?|google|apple|microsoft|openai)\b/i],
  ["Health", /\b(health|hospitals?|disease|virus|vaccines?|medical|doctors?|covid|cancer|dengue|malaria|patients?|mental health)\b/i],
  ["Weather", /\b(rain\w*|monsoon|floods?|cyclone|heatwave|weather|climate|earthquake|storms?|aqi|air quality|pollution|snow\w*|drought|wildfires?)\b/i],
  ["Culture", /\b(film|movies?|bollywood|cinema|actor|actress|music|singer|album|festival|diwali|deepavali|eid|christmas|book|author|art|celebrity|oscars?)\b/i],
  ["Politics", /\b(elections?|minister|bjp|congress|parliament|lok sabha|rajya sabha|government|president|prime minister|pm|vote|voters|polls?|court|supreme court|high court|policy|party|senate|chief minister|cm)\b/i],
];
const topicOf = (text, region) => (TOPICS.find(([, re]) => re.test(text)) || [region === "india" ? "India" : "World"])[0];

// Many feeds omit the photo but the article page carries one in og:image. Look it up once per link.
const ogCache = new Map();
// The static build seeds this from the last published news.json, so each run only looks up new links.
export function seedImages(items) {
  for (const i of items || []) if (i.link && i.image) ogCache.set(i.link, i.image);
}
async function ogImage(link) {
  if (ogCache.has(link)) return ogCache.get(link);
  let img = "";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(link, { signal: ctrl.signal, headers: { "user-agent": "KhabarPrototype/0.1 (+rss reader)", accept: "text/html" } });
    if (res.ok) {
      const head = (await res.text()).slice(0, 200_000);
      const m =
        head.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)(?::src)?["'][^>]*content=["']([^"']+)["']/i) ||
        head.match(/<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["'](?:og:image|twitter:image)["']/i);
      if (m && /^https:\/\//i.test(decode(m[1]))) img = decode(m[1]);
    }
  } catch { /* leave empty; the card falls back to a topic cover */ }
  finally { clearTimeout(t); }
  if (ogCache.size > 2000) ogCache.clear();
  ogCache.set(link, img);
  return img;
}
async function fillImages(items, concurrency = 6) {
  const todo = items.filter((i) => !i.image);
  let next = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (next < todo.length) { const it = todo[next++]; it.image = await ogImage(it.link); }
  }));
}

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(feed.url, { signal: ctrl.signal, headers: { "user-agent": "KhabarPrototype/0.1 (+rss reader)", accept: "application/rss+xml, application/xml, text/xml, */*" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { feed, items: parseFeed(await res.text(), feed) };
  } catch (err) {
    return { feed, items: [], error: String(err.message || err) };
  } finally {
    clearTimeout(t);
  }
}

let cache = { at: 0, payload: null, pending: null };
export async function getNews() {
  if (cache.payload && Date.now() - cache.at < CACHE_MS) return cache.payload;
  if (cache.pending) return cache.pending;
  cache.pending = (async () => {
    const results = await Promise.all(FEEDS.map(fetchFeed));
    const seen = new Set();
    const now = Date.now();
    const items = results
      .flatMap((r) => r.items)
      .filter((i) => i.title && i.link && (i.date === null || now - i.date < MAX_AGE_MS))
      .filter((i) => {
        const key = i.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => (b.date ?? 0) - (a.date ?? 0)); // newest first: no ranking, no personalisation
    await fillImages(items);
    const payload = {
      fetchedAt: now,
      items,
      sources: results.map((r) => ({ source: r.feed.source, region: r.feed.region, count: r.items.length, error: r.error || null })),
    };
    if (items.length) cache = { at: now, payload, pending: null };
    else cache.pending = null;
    return payload;
  })();
  try {
    return await cache.pending;
  } finally {
    cache.pending = null;
  }
}
