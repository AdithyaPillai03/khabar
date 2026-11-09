# Khabar

The day's news from India and the world, one card at a time. Stories are shown newest first, straight from the publishers' RSS feeds. Nothing is ranked or personalised.

## Run it

```bash
npm start
```

Then open http://localhost:5173. It needs Node 18 or newer and has no dependencies.

## How it works

- `server.js` fetches 12 public RSS feeds (6 Indian, 6 global), merges and de-duplicates them, sorts them by time and serves them at `/api/news`. It also serves `public/`. Results are cached for 10 minutes.
- `public/app.js` shows one story per screen with vertical scroll-snap. Swipe, scroll, or use the arrow keys, `j`/`k` or Space.
- **Filters:** All, India and World. The choice is kept in the URL (`?region=india`).
- **Daily streak:** a story counts as read after it has been on screen for 1.5 seconds. Reading 5 a day keeps the streak. The ring in the top bar fills as you read. The garden on the last card grows one plant for each day you met the goal. All of this is stored in `localStorage` and never leaves the browser.
- **Gentle mode** (on by default): stories whose headline or summary matches words about violence or loss are covered with a heads-up and a "Show the story" button.
- **New since your last visit:** a tag on stories published since you last opened the site.
- **You're caught up:** the feed ends instead of scrolling forever.
- **Refresh:** a refresh button in the top bar. Every 5 minutes the page also checks quietly for new stories and shows an "N new stories" button, but it never reorders the feed while you're reading.
- **A photo on every card:** if a feed leaves out the image, the server reads the article's own share image (`og:image`) once and caches it. If that also fails, the card shows a cut-paper cover in the story's topic colour (Sport, Business, Politics and so on). Cards are the same size either way.

## Changing the feeds

Edit `FEEDS` in `server.js`. Any RSS 2.0, RDF or Atom feed works.

## Notes

- Headlines, summaries and images belong to their publishers. Each card links to the source article. Before launching publicly, check each publisher's terms for RSS use.
- Design: Hallmark, Hum theme (tokens in `public/tokens.css`).
