# Tend

A Chrome extension that groups your open tabs by topic, shows how stale each
one is, and helps you decide what to close — without sending your browsing to
anyone, unless you choose to.

## What it does

- Tracks every open tab (title, URL, when it was opened, when it was last
  focused) in `chrome.storage.local`.
- Groups tabs by what they're actually for, not just which tabs happen to be
  open:
  1. **Keyword/hostname rules** catch well-known cases deterministically
     (github.com → "Programming", translate.google.com → "Languages", etc.).
  2. **An on-device embedding model** ([`@xenova/transformers`](https://github.com/xenova/transformers.js),
     MiniLM) groups and labels whatever the keywords miss, using the page's
     title, URL, and meta description — but only when its answer clears both
     a confidence floor and a margin over the runner-up, so it stays quiet
     rather than guess wrong.
  3. **Optional: a real LLM** (Claude, via your own Anthropic API key) can
     replace both of the above and read each tab's actual content to group by
     genuine purpose. This is the only part of Tend that sends anything
     off-device, and it costs a small amount per use — it's off by default.
- Shows a relevance score per tab that decays the longer it's been since you
  looked at it (halves every 6 hours; the active tab is always 1).
- One click closes a tab you don't want; closes are logged locally as
  (currently unused) data for a possible future feature — see
  [`NOTES.md`](NOTES.md).
- Light / dark / system theme, independent of your OS setting.

## Why it's built this way

Everything defaults to running **entirely on your machine, for free** — the
keyword rules and the embedding model have zero marginal cost no matter how
many people use the extension, which matters if this is ever more than a
personal tool. The LLM path is opt-in specifically because it's the one
piece that isn't free or private: it's a genuine trade of cost/privacy for
better understanding of tabs the local pipeline can't place well.

## Project layout

```
src/
  manifest.json        Chrome MV3 manifest
  background/          Service worker: tab tracking, embeddings, grouping, the
                        optional LLM call, and the message handlers the popup calls
  content/              Content script — reads each page's meta description
  popup/                The popup UI (HTML/CSS/JS)
  shared/               Code used by both the background worker and popup
build.mjs               esbuild build script
```

## Building

```
npm install
npm run build        # outputs to dist/
npm run watch         # rebuild on change
```

## Loading it in Chrome

1. `npm run build`
2. Go to `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked**, select the `dist/` folder.
4. Click the extension icon to open the popup.

The first popup open downloads the embedding model (~23 MB); after that it's
cached and runs offline.

## Enabling AI-powered grouping (optional)

Open the popup, click the gear icon, and paste an Anthropic API key. This
sends each tab's title/URL/description to Claude to group tabs by their
actual purpose instead of keyword/embedding matching. It costs a small,
real amount per popup open and is the only thing in Tend that isn't fully
local — leave the key blank to keep everything on-device.

## Permissions

- `tabs` — read tab titles/URLs to track and group them.
- `storage`, `unlimitedStorage` — store tab records, embeddings, and
  close-decisions locally.
- `favicon` — show each tab's icon via Chrome's built-in favicon service
  (no remote image loading, no extra host permissions needed).
- Host access to Hugging Face (to download the embedding model) and, only if
  you set an API key, to Anthropic's API.
