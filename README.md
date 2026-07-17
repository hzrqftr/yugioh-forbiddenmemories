# fm-tools — Yu-Gi-Oh! Forbidden Memories companion

A free, static, client-only fan tool for the PSX game *Yu-Gi-Oh! Forbidden
Memories*. It helps you plan fusions, browse the card pool, and build decks —
with optional cross-device sync via your own Google Drive. No backend, no
database, no tracking, no cost.

- **Live:** https://hzrqftr.github.io/yugioh-forbiddenmemories/ (also served via the
  custom domain `ourlittlemiracle.online/yugioh-forbiddenmemories/`)
- **Repo:** `hzrqftr/yugioh-forbiddenmemories`
- **Hosting:** GitHub Pages, branch `main`, path `/` (plain static files)
- **License / attribution:** see [`NOTICE.md`](NOTICE.md). Card & fusion data from
  Yugipedia (CC BY-SA 4.0); card art © Konami, used under fair use. Unofficial,
  non-commercial.

> **New here (human or agent)?** Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
> for how the whole thing fits together, and [`CLAUDE.md`](CLAUDE.md) for the
> working conventions (including the rule that **these docs are updated with every
> commit batch**).

## The four pages

| Page | File | Controller | What it does |
|------|------|-----------|--------------|
| **Fusion Finder** | `index.html` | `js/app.js` | Chain two-card fusion equations (A + B → C); each result can be fused further into a numbered play sequence. |
| **Sequence Planner** | `sequencer.html` | `js/sequencer.js` | Given a pool of cards in hand, search for the best fusion sequence; drag-and-drop slots. |
| **Card Library** | `card-library.html` | `js/card-library.js` | Browse all 722 cards; detail panel with art, stats, "used as material" and "how to summon" fusion tabs, plus acquisition info. |
| **Deck Builder** | `deck-builder.html` | `js/deck-builder.js` | Track owned cards (0–3 each) and build a deck (FM's 40-card cap enforced); owned-aware (flags shortfalls). Hover popover + a heuristic **strategy advisor** (add/replace suggestions using ATK/DEF, fusion synergy & Guardian Stars). Saves locally; export/import; optional Google Drive sync. |

All pages share the same chrome (sidebar nav, theme toggle, footer) and the same
data/engine core (`js/fusion-core.js`).

## Tech stack

- **Vanilla JS**, no framework, no bundler, no build step. Each `.js` file is a
  global-scoped IIFE or top-level script loaded via `<script>` tags in dependency
  order. Ship what you edit.
- **Data** is static files under `data/` (a CSV card catalogue + JSON fusion
  rules), fetched at runtime. Card art is pre-converted WebP under `images/`.
- **Persistence** is `localStorage` (+ export/import JSON + optional Google Drive
  sync for the Deck Builder). See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Design system**: JetBrains Mono / Inter type split, amber `#d4962a` accent,
  `//`-prefixed comment-style labels, dark/light themes. All in `css/style.css`.

## Run locally

It's pure static files, so any static server works. This repo uses Playwright
(a dev dependency) for verification, and a small helper server during dev:

```bash
# from the repo root
npm install                      # installs Playwright (dev only)
# serve on http://localhost:8123 with any static server, e.g. the scratchpad one,
# or: npx http-server -p 8123 .   /   python -m http.server 8123
```

Then open `http://localhost:8123/index.html`. Opening the files directly via
`file://` mostly works but `fetch()` of the data files can be blocked by the
browser — use a server.

> **MIME note (local only):** some minimal static servers send `.webp`/`.svg` as
> `application/octet-stream`, so images won't render locally. GitHub Pages serves
> the correct types. If images are blank locally, it's the server, not the app.

## Repository map

```
index.html, sequencer.html, card-library.html, deck-builder.html, notice.html
css/style.css                 # entire design system + all page styles
js/
  fusion-core.js              # SHARED: data loading, fusion engine, combobox/picker widgets
  ui.js                       # SHARED: sidebar drawer/collapse + theme toggle (every page)
  app.js                      # Fusion Finder controller
  sequencer.js                # Sequence Planner controller
  card-library.js             # Card Library controller
  deck-builder.js             # Deck Builder UI controller
  deck-store.js               # Deck Builder data layer (localStorage, export/import)
  deck-advisor.js             # Deck Builder strategy advisor (scoring + add/replace suggestions)
  drive-sync.js               # PORTABLE Google Drive sync module (reusable across apps)
  config.js                   # per-app config: Google Client ID + appKey
data/
  forbidden_memories_cards.csv        # 722-card catalogue
  card_images.json                    # card # -> local WebP path + source
  card_meta.json                      # card # -> Guardian Stars + in-game description
  fusion_rules_manifest.json          # lists the fusion parts to load
  fusion_rules_part_01..11.json       # normalized fusion rules
images/NNN.webp               # one per card (zero-padded id), 722 total
DATASET.md                    # data shapes & provenance
NOTICE.md                     # licensing & attribution
docs/
  ARCHITECTURE.md             # how the framework works (read this first)
  GOOGLE-DRIVE-SYNC.md        # Google Cloud setup (repeatable) + reuse recipe
CLAUDE.md                     # conventions for anyone (esp. agents) working here
```

## Documentation index

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — framework internals: shared core,
  data layer, per-page controllers, persistence, design system, page-add recipe.
- [`docs/GOOGLE-DRIVE-SYNC.md`](docs/GOOGLE-DRIVE-SYNC.md) — the Google Cloud Console
  setup, step by step and repeatable; the "umbrella" one-client-many-apps design;
  the drop-in reuse recipe for future projects; troubleshooting.
- [`DATASET.md`](DATASET.md) — data file shapes & provenance.
- [`NOTICE.md`](NOTICE.md) — licensing & attribution.
- [`CLAUDE.md`](CLAUDE.md) — working conventions and the docs-stay-in-sync rule.
