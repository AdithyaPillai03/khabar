// Khabar: a chronological news feed, one card per screen. No ranking, no personalisation.
const GOAL = 5;            // stories a day that keep the streak
const DWELL_MS = 1500;     // time a card must stay on screen to count as read
const STORE_KEY = "khabar:v1";

const $ = (s, el = document) => el.querySelector(s);
const feedEl = $("#feed");
const skeleton = $("#feed > .slide").cloneNode(true);
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- storage (per browser, never sent anywhere) ----------
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* private mode: streak lives for this tab only */ }
}
const store = Object.assign({ days: {}, lastVisit: 0, gentle: true }, load());
const prevVisit = store.lastVisit || 0;
store.lastVisit = Date.now();
save();

const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = () => (store.days[dayKey()] ||= { count: 0, ids: [] });

function streakLength() {
  const d = new Date();
  if ((store.days[dayKey(d)]?.count || 0) < GOAL) d.setDate(d.getDate() - 1); // today still open
  let n = 0;
  while ((store.days[dayKey(d)]?.count || 0) >= GOAL) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

// ---------- torn paper edges (seeded value noise) ----------
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function noise(seed, n) {
  const r = rng(seed), knots = Array.from({ length: 9 }, r);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * 8, k = Math.floor(t), f = t - k, s = f * f * (3 - 2 * f);
    return knots[k] * (1 - s) + knots[Math.min(k + 1, 8)] * s + (r() - 0.5) * 0.45;
  });
}
function tear(seed, { amp = 6, inset = 0, top = false } = {}) {
  const pts = noise(seed, 48).map((v, i) => {
    const x = ((i / 48) * 100).toFixed(2) + "%", y = (inset + Math.max(0, v) * amp).toFixed(1);
    return top ? `${x} ${y}px` : `${x} calc(100% - ${y}px)`;
  });
  return top ? `polygon(${pts.join(",")}, 100% 100%, 0 100%)` : `polygon(0 0, 100% 0, ${pts.reverse().join(",")})`;
}
function applyTear(el, seed, amp, inset = 3) {
  el.style.setProperty("--tear", tear(seed, { amp, inset }));
  el.style.setProperty("--tear-fringe", tear(seed, { amp, inset: inset - 2.5 }));
}
const hash = (s) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7);

applyTear($("#bar"), 11, 7, 2);
$(".bar__fringe").style.setProperty("--tear-fringe", tear(11, { amp: 7, inset: 0 }));

// ---------- streak ring ----------
function renderStreak() {
  const n = streakLength(), c = today().count;
  $("#streak-num").textContent = n;
  $("#streak-unit").textContent = n === 1 ? "day streak" : "day streak";
  $("#ring-fill").style.setProperty("--off", 100 - Math.min(c / GOAL, 1) * 100);
  const done = c >= GOAL;
  $("#streak-btn").classList.toggle("is-done", done);
  const tip = done ? `Today's ${GOAL} stories read. Streak: ${n} ${n === 1 ? "day" : "days"}.` : `${c} of ${GOAL} stories read today. Read ${GOAL - c} more to keep your streak.`;
  $("#streak-btn").title = tip;
  $("#streak-btn").setAttribute("aria-label", tip);
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = "none"; void t.offsetWidth; t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

function markRead(id) {
  const d = today();
  if (d.ids.includes(id)) return;
  d.ids.push(id);
  d.count++;
  save();
  renderStreak();
  if (d.count === GOAL) {
    const n = streakLength();
    toast(n > 1 ? `Streak kept. ${n} days in a row.` : "Streak started. See you tomorrow.");
  }
}

// ---------- gentle mode ----------
const revealed = new Set();
function renderGentle() {
  $("#gentle").setAttribute("aria-pressed", String(store.gentle));
  $("#gentle-state").textContent = store.gentle ? "on" : "off";
  document.querySelectorAll(".slide[data-sensitive]").forEach((s) => {
    $(".cover", s).hidden = !store.gentle || revealed.has(s.dataset.id);
  });
}
$("#gentle").addEventListener("click", () => { store.gentle = !store.gentle; save(); renderGentle(); });

// ---------- data ----------
let all = null, region = new URLSearchParams(location.search).get("region");
if (!["india", "world"].includes(region)) region = "all";

async function fetchNews() {
  const res = await fetch("news.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data.items)) throw new Error("bad payload");
  return data;
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(ts) {
  if (!ts) return "";
  const m = Math.round((ts - Date.now()) / 60000);
  if (m > -1) return "just now";
  if (m > -60) return rtf.format(m, "minute");
  const h = Math.round(m / 60);
  if (h > -24) return rtf.format(h, "hour");
  return rtf.format(Math.round(h / 24), "day");
}

// ---------- rendering ----------
const tpl = $("#tpl-story");

// A cut-paper cover in the story's topic colour, for stories with no photo. Costs nothing to serve.
function coverArt(item) {
  const art = document.createElement("div");
  art.className = "art";
  art.dataset.topic = (item.topic || "World").toLowerCase();
  const r = rng(hash(item.id));
  art.style.setProperty("--rot-a", (r() * 10 - 5).toFixed(1) + "deg");
  art.style.setProperty("--rot-b", (r() * 12 - 6).toFixed(1) + "deg");
  art.style.setProperty("--x-b", (r() * 30 + 50).toFixed(0) + "%");
  const a = document.createElement("span"), b = document.createElement("span"), w = document.createElement("span");
  a.className = "art__sheet art__sheet--a";
  b.className = "art__sheet art__sheet--b";
  a.style.clipPath = tear(hash(item.id) + 1, { amp: 10, inset: 0 });
  b.style.clipPath = tear(hash(item.id) + 2, { amp: 8, inset: 0, top: true });
  w.className = "art__word";
  w.textContent = item.topic || "World";
  art.append(a, b, w);
  return art;
}
function storySlide(item, i, total) {
  const s = tpl.content.firstElementChild.cloneNode(true);
  s.dataset.id = item.id;
  s.setAttribute("aria-label", `Story ${i + 1} of ${total}`);
  const frame = $(".frame", s);
  frame.href = item.link;
  applyTear(frame, hash(item.id), 9, 4);
  if (item.image) {
    const img = Object.assign(document.createElement("img"), { alt: "", loading: "lazy", decoding: "async", referrerPolicy: "no-referrer", src: item.image });
    img.addEventListener("error", () => img.replaceWith(coverArt(item)), { once: true });
    frame.append(img);
  } else frame.append(coverArt(item));
  $(".card__source", s).textContent = item.source;
  const time = $(".card__time", s);
  if (item.date) { time.dateTime = new Date(item.date).toISOString(); time.textContent = ago(item.date); }
  if (prevVisit && item.date && item.date > prevVisit) $(".tag-new", s).hidden = false;
  $(".card__title", s).textContent = item.title;
  $(".card__summary", s).textContent = item.summary;
  const link = $(".card__link", s);
  link.href = item.link;
  link.textContent = `Read the full story on ${item.source}`;
  $(".card__count", s).textContent = `${i + 1} of ${total}`;
  if (item.sensitive) {
    s.dataset.sensitive = "";
    $(".cover__btn", s).addEventListener("click", () => {
      revealed.add(item.id);
      $(".cover", s).hidden = true;
      $(".card__link", s).focus({ preventScroll: true });
    });
  }
  return s;
}

function noteSlide({ title, body, actions = [], label, extra }) {
  const s = document.createElement("section");
  s.className = "slide slide--note";
  s.setAttribute("aria-label", label || title);
  const card = document.createElement("article");
  card.className = "card card--note";
  const b = document.createElement("div");
  b.className = "card__body";
  const h = document.createElement("h2");
  h.className = "card__title";
  h.textContent = title;
  b.append(h);
  if (body) { const p = document.createElement("p"); p.className = "caught__line"; p.innerHTML = body; b.append(p); }
  if (extra) b.append(extra);
  if (actions.length) {
    const row = document.createElement("div");
    row.className = "note__actions";
    actions.forEach(([text, fn, primary]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `btn ${primary ? "btn--primary" : "btn--secondary"}`;
      btn.textContent = text;
      btn.addEventListener("click", fn);
      row.append(btn);
    });
    b.append(row);
  }
  card.append(b);
  s.append(card);
  return s;
}

const HEAD_COLOURS = ["var(--color-accent-2)", "var(--color-accent-3)", "var(--color-mint-deep)", "var(--color-accent-deep)"];
function garden() {
  const wrap = document.createElement("div");
  wrap.className = "garden";
  wrap.setAttribute("role", "img");
  const beds = document.createElement("div");
  beds.className = "garden__beds";
  const days = document.createElement("div");
  days.className = "garden__days num";
  const labels = [];
  for (let k = 6; k >= 0; k--) {
    const d = new Date(); d.setDate(d.getDate() - k);
    const c = store.days[dayKey(d)]?.count || 0;
    const name = d.toLocaleDateString("en", { weekday: "short" });
    const p = document.createElement("div");
    p.className = "plant" + (c >= GOAL ? " is-grown" : "") + (k === 0 ? " is-today" : "");
    p.style.setProperty("--i", 6 - k);
    p.style.setProperty("--h", (c >= GOAL ? 44 + Math.min(c - GOAL, 15) * 4 : 4 + c * 6) + "px");
    p.style.setProperty("--plant-c", HEAD_COLOURS[(6 - k) % 4]);
    p.innerHTML = `<span class="plant__head" aria-hidden="true">${name[0]}</span><span class="plant__stem"></span>`;
    beds.append(p);
    const lab = document.createElement("span");
    lab.textContent = String(c);
    days.append(lab);
    labels.push(`${name}: ${c} read`);
  }
  wrap.setAttribute("aria-label", `Your last seven days. ${labels.join(", ")}.`);
  const soil = document.createElement("div");
  soil.className = "garden__soil";
  soil.style.setProperty("--tear-top", tear(5, { amp: 8, top: true }));
  const note = document.createElement("p");
  note.className = "garden__note";
  note.textContent = `Stories read, last seven days. ${GOAL} grows a plant.`;
  wrap.append(beds, soil, days, note);
  return wrap;
}

function caughtUpSlide(count) {
  const c = today().count, n = streakLength();
  const body = c >= GOAL
    ? `You read <mark>${c} stories today</mark>. ${n > 1 ? `That's ${n} days in a row.` : "Your streak has started."} New stories land through the day.`
    : `You've read ${c} today. Read <mark>${GOAL - c} more</mark> to grow today's plant.`;
  return noteSlide({
    title: "You're caught up.",
    label: "End of the feed",
    body,
    extra: garden(),
    actions: [["Check for new stories", () => refresh(), true], ["Back to the top", () => go(0), false]],
  });
}

let observer;
function render() {
  const items = region === "all" ? all.items : all.items.filter((i) => i.region === region);
  observer?.disconnect();
  feedEl.replaceChildren();
  feedEl.scrollTop = 0;
  if (!items.length) {
    feedEl.append(noteSlide({
      title: "Nothing here yet.",
      body: `No ${region === "india" ? "Indian" : region === "world" ? "world" : ""} stories came in from the last two days. Try another filter or check again in a few minutes.`,
      actions: [["Show all news", () => setRegion("all"), true], ["Check again", () => start(true), false]],
    }));
    return;
  }
  const frag = document.createDocumentFragment();
  items.forEach((it, i) => frag.append(storySlide(it, i, items.length)));
  frag.append(caughtUpSlide(items.length));
  feedEl.append(frag);
  renderGentle();

  const timers = new Map();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const id = e.target.dataset.id;
      if (!id) continue;
      if (e.isIntersecting) {
        const covered = !$(".cover", e.target).hidden;
        if (!covered) timers.set(id, setTimeout(() => markRead(id), DWELL_MS));
      } else { clearTimeout(timers.get(id)); timers.delete(id); }
    }
  }, { root: feedEl, threshold: 0.6 });
  feedEl.querySelectorAll(".slide[data-id]").forEach((s) => observer.observe(s));
}

function showError() {
  feedEl.replaceChildren(noteSlide({
    title: "The news didn't load.",
    body: "We couldn't reach the news feeds. Check your connection, then try again.",
    actions: [["Try again", () => start(true), true]],
  }));
}

async function start(force = false) {
  if (force || !all) {
    feedEl.setAttribute("aria-busy", "true");
    if (force) { feedEl.replaceChildren(skeleton.cloneNode(true)); feedEl.scrollTop = 0; }
    try { all = await fetchNews(); }
    catch { feedEl.setAttribute("aria-busy", "false"); showError(); return; }
  }
  feedEl.setAttribute("aria-busy", "false");
  render();
}

// ---------- refresh: by hand, and a quiet check every 5 minutes ----------
const inRegion = (items) => (region === "all" ? items : items.filter((i) => i.region === region));
const countNew = (data) => {
  const have = new Set((all?.items || []).map((i) => i.id));
  return inRegion(data.items).filter((i) => !have.has(i.id)).length;
};
let pending = null, refreshing = false;
const freshBtn = $("#fresh"), refreshBtn = $("#refresh");

function apply(data, n) {
  all = data;
  pending = null;
  freshBtn.hidden = true;
  render();
  go(0);
  toast(n ? `${n} new ${n === 1 ? "story" : "stories"} at the top.` : "You're up to date.");
}

async function refresh() {
  if (refreshing) return;
  if (!all) return start(true);
  refreshing = true;
  refreshBtn.classList.add("is-spinning");
  refreshBtn.disabled = true;
  try {
    const data = pending || (await fetchNews());
    apply(data, countNew(data));
  } catch {
    toast("Couldn't reach the news. Try again in a moment.");
  } finally {
    refreshing = false;
    refreshBtn.classList.remove("is-spinning");
    refreshBtn.disabled = false;
  }
}
refreshBtn.addEventListener("click", refresh);
freshBtn.addEventListener("click", refresh);

function showPending() {
  const n = pending ? countNew(pending) : 0;
  freshBtn.hidden = n === 0;
  freshBtn.textContent = `${n} new ${n === 1 ? "story" : "stories"}, tap to see`;
}
setInterval(async () => {
  if (document.hidden || refreshing || !all) return;
  try {
    const data = await fetchNews();
    if (data.fetchedAt !== all.fetchedAt) { pending = data; showPending(); }
  } catch { /* try again next round */ }
}, 5 * 60 * 1000);

// ---------- region filter (kept in the URL) ----------
function setRegion(r) {
  region = r;
  document.querySelectorAll(".pill").forEach((p) => p.setAttribute("aria-checked", String(p.dataset.region === r)));
  const url = new URL(location.href);
  r === "all" ? url.searchParams.delete("region") : url.searchParams.set("region", r);
  history.replaceState(null, "", url);
  if (all) render();
  if (pending) showPending();
}
document.querySelectorAll(".pill").forEach((p) => p.addEventListener("click", () => setRegion(p.dataset.region)));
$(".regions").addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
  const pills = [...document.querySelectorAll(".pill")];
  const i = pills.findIndex((p) => p.getAttribute("aria-checked") === "true");
  const next = pills[(i + (e.key === "ArrowRight" ? 1 : pills.length - 1)) % pills.length];
  setRegion(next.dataset.region);
  next.focus();
  e.preventDefault();
});

// ---------- navigation ----------
const current = () => Math.round(feedEl.scrollTop / feedEl.clientHeight);
function go(i) {
  const slides = feedEl.children;
  const t = slides[Math.max(0, Math.min(i, slides.length - 1))];
  t?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}
document.addEventListener("keydown", (e) => {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.target.closest?.(".regions, button, a, input")) { if (!["ArrowDown", "ArrowUp", "j", "k"].includes(e.key) || e.target.closest(".regions")) return; }
  const down = ["ArrowDown", "PageDown", "j", " "].includes(e.key) && !e.shiftKey;
  const up = ["ArrowUp", "PageUp", "k"].includes(e.key) || (e.key === " " && e.shiftKey);
  if (!down && !up) return;
  e.preventDefault();
  go(current() + (down ? 1 : -1));
});
$("#streak-btn").addEventListener("click", () => go(feedEl.children.length - 1));
feedEl.addEventListener("scroll", () => $("#hint").classList.add("is-gone"), { once: true, passive: true });

setRegion(region);
renderStreak();
renderGentle();
start();
