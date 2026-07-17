# Architecture — the fm-tools portal framework

This document explains how the whole site is put together so a new contributor
(human or agent) can work on it confidently. It is the counterpart to the
top-level [`README.md`](../README.md), which is the orientation/overview.

## 1. Mental model

fm-tools is a **multi-page static site**. There is no SPA router, no framework,
no build step. Each page is a plain `.html` file that loads a shared core plus
one page-specific controller, all as global-scoped `<script>`s in dependency
order. "Deploying" is just pushing files to the `main` branch; GitHub Pages
serves them.

Everything is client-side. The only external network calls at runtime are:

1. Fetching the static data files under `data/` (same origin).
2. Google Fonts (`fonts.googleapis.com`) — cosmetic.
3. Google Identity Services + Google Drive REST — **only** on the Deck Builder,
   **only** after the user clicks "Sign in with Google" (see §6).

## 2. Page anatomy

Every page has the same skeleton:

```
<head>
  ... inline theme bootstrap (reads localStorage 'fm-theme' before paint) ...
</head>
<body class="<page>-page">
  <button class="theme-toggle">…
  <div class="app-shell">
    <aside class="sidebar" id="sidebar"> … 4-link nav … </aside>
    <div class="main-area">
      <header> … page-path + h1 + subtitle … </header>
      <main class="<page-specific>"> … </main>
      <footer> … attribution + CC BY-SA badge … </footer>
    </div>
  </div>
  <!-- scripts, in dependency order -->
</body>
```

Shared chrome that must stay identical across all pages:

- **Sidebar nav** — the same four links (`fusion-finder.js`, `sequence-planner.js`,
  `card-library.js`, `deck-builder.js`), with the current page marked
  `class="nav-link active" aria-current="page"`. The labels are styled to look
  like JS filenames; the `href`s point at the actual `.html` files.
- **Millennium Eye** favicon (`images/millennium-eye.svg`) and the sidebar sigil.
- **Theme toggle** and the **footer** (attribution + inline CC BY-SA SVG badge).

If you add or rename a page, update the nav in **all** HTML files.

## 3. Script load order (critical)

Scripts are globals; order matters. The canonical order is:

```
[Google Identity Services]      (deck-builder only, async)
js/fusion-core.js               shared engine + widgets  (defines: state, loadCoreData, escapeHtml, combobox/picker)
js/ui.js                        shared chrome (sidebar + theme); self-invoking, DOMContentLoaded
js/config.js                    APP_CONFIG (deck-builder only)
js/deck-store.js                DeckStore (deck-builder only)
js/drive-sync.js                DriveSync (deck-builder only)
js/deck-advisor.js              DeckAdvisor (deck-builder only; needs state + deck-store)
<page controller>.js            app.js | sequencer.js | card-library.js | deck-builder.js
```

The page controller is loaded **last** and calls `init()` immediately, which
`await`s `loadCoreData()` before touching the DOM data.

## 4. The shared core — `js/fusion-core.js`

This is the heart of the framework. It owns:

### 4a. Global `state`
```js
state = {
  cardsById:      Map<id, card>,        // id is zero-padded string "001"
  monsterOptions: [{id, name, label}],  // monsters only, sorted by name (for pickers)
  fusionResults:  [ result, … ],        // all fusion parts flattened
  cardImagesById: Map<number, image>,   // keyed by zero-padded card number
}
```

### 4b. Data loading — `loadCoreData()`
Fetches, in parallel: the card CSV, all fusion parts (via the manifest), and the
card-images JSON; then merges optional `card_meta.json` (Guardian Stars + in-game
description → `card.gsA`/`card.gsB`/`card.desc`) and builds `monsterOptions`. Card
images and metadata are optional (loaders swallow their failure). Includes a small
RFC4180-ish `parseCSV()` that handles quoted fields (needed for values like
`"999,999"` in the SC Cost column). See [`../DATASET.md`](../DATASET.md) for
`card_meta.json`'s shape and provenance.

### 4c. The fusion engine
- `computeValidPartners(id, includeGlitch)` → set of monster ids that fuse with `id`.
- `getPartnerCandidates(id, includeGlitch)` → those as `monsterOptions` entries.
- `findFusionMatches(id1, id2, includeGlitch)` → the result(s) two cards produce.

**Fusion rule semantics (important):** a rule has two arrays `material1` and
`material2`. A rule matches when one selected card is in `material1` **and** the
other is in `material2` (order-independent — checked both ways). Do **not** pair
items by array index. Glitch fusions are flagged `isGlitch: true` and excluded
unless the caller passes `includeGlitch`. See [`../DATASET.md`](../DATASET.md) for
the exact data shape.

### 4d. Shared UI widgets
- `setupCombobox({...})` — a custom accessible combobox (used by Fusion Finder /
  others) that avoids the browser's inconsistent native `<datalist>` popup.
- `ensureCardPicker()` / `openCardPicker(anchorEl, {options, onSelect})` /
  `closeCardPicker()` — a single shared floating card picker anchored to any
  element. The Sequence Planner keeps its own slot-bound picker for now.
- `escapeHtml(str)` — used everywhere HTML is built via template strings.
  **All user/data-derived text interpolated into `innerHTML` must go through it.**

## 5. Per-page controllers

Each controller is independent and builds its own DOM by string-templating into
`innerHTML`, wiring events by **delegation** (listen on a container, match
`e.target.closest('[data-action]')` / `[data-id]`). This is the repo's dominant
pattern — follow it.

- **`app.js` (Fusion Finder / "The Fusion Bench").** Models play as a linear chain
  of two-card equations. `steps[i] = { matA, matB, results }`. Step 0's `matA` is
  user-picked; later steps pin `matA` to the previous step's chosen result
  ("fuse this result further"). Only the last step is interactive. Changing the
  glitch toggle re-resolves the chain top-down and prunes now-broken continuations
  (`revalidateChain`).

- **`sequencer.js` (Sequence Planner).** User enters a pool of cards across Field/Hand
  slots; the engine enumerates every executable fusion (bounded by `MAX_EXPLORED_PAIRS = 20000`).
  The search is a **linear left-fold** matching FM's real mechanics: a chain starts from a base
  card, then folds in one card at a time (result + next). A **Field** monster is position 0 —
  it can only be the base — so `findAllSequences` lets any card be the base but only ever
  **adds Hand cards** after it (this forces a field monster to the front and forbids two field
  monsters in one fusion). Non-executable orders (field mid-chain, or tree fusions of two
  sub-results) are never produced.
  Includes a full pointer-based drag/drop system (mouse + touch long-press) to move/swap
  cards between slots. Also **interactive apply-fusion**: each listed outcome has a "Fuse"
  button that enters placement mode — the user clicks a highlighted slot (empty, or one of
  the fusion's own material slots) to drop the result into, consuming the materials, then
  the board re-scans so fusions can be chained. **Undo** (snapshots the board before each
  apply/reset) and **Reset** back it. Largest controller; self-contained picker + drag logic.
  Note: `outcome.usedSlotIndices` are pool-relative, so `getPool()` carries each card's real
  `slotIndex` for the apply to clear the correct slots.

- **`card-library.js` (Card Library).** Master list + detail panel. Detail shows
  art, stats, and a tabbed fusion section: "used as material" (top `TOP_N = 5`
  fusions this card enables) and "how to summon" (this card's own recipe), plus
  acquisition info. Uses `CAN_HOVER` to decide hover-tooltips vs tap.

- **`deck-builder.js` (Deck Builder UI).** Two panes: collection (searchable,
  type-filterable, and sortable by ID / name / ATK / DEF with an asc/desc toggle;
  own 0–3 per card via a stepper) and the active deck. The deck pane lists **one row per copy**
  (game-faithful — duplicates are not compiled into a count), each with a running
  number and a `×` that removes that single copy; more copies are added via the
  collection's `+deck`. Owned-awareness is per copy and not enforced: within a
  card's copies the first N (N = owned) show "✓ owned", extras are flagged. All
  state flows through `DeckStore`; the UI subscribes via `DeckStore.onChange(renderAll)`
  and re-renders. A deck holds **exactly 40 cards** — FM caps the deck at 40 (unlike
  later games): the UI blocks adds past 40 (`DECK_SIZE = 40`) and the meter flags an
  under-/over-limit deck. The collection pane also has a **membership filter** (All /
  In deck / In trunk / Owned). Also owns the sync panel wiring (see §6), a
  desktop **hover popover** (reuses the shared `.card-tip`; shows guardian stars,
  description, owned/in-deck counts, deck-contextual fusion synergy, and the advisor
  verdict), and the **strategy advisor** surface (badges + suggestions panel).

- **`deck-advisor.js` (`DeckAdvisor`).** A heuristic strategy helper. `buildIndex()`
  precomputes a fusion pairing index; `analyze(deck, collection)` scores each **monster**
  as `combat(ATK + 0.25·DEF) + fusion-upside-with-deck + partner-count + guardian-star-
  coverage`, ranks the deck, and returns a verdict per owned-but-unused ("trunk") card:
  ⭐ strong add / ➕ situational (deck has room) or 🔁 replace #X / ➖ skip (deck full) —
  each with a plain-language reason. Non-monsters are not scored (no card-effect data),
  shown as "utility — judge manually". It's an explainable heuristic, **not** an optimal
  solver: no card effects, no fusion-AI model. Weights are tunable constants at the top.

## 6. Persistence & sync (Deck Builder)

Three layers, all free, no backend:

### 6a. `localStorage` — `js/deck-store.js` (`DeckStore`)
The single source of truth on-device. Pure data layer, **no DOM**. Keys:

| Key | Shape | Meaning |
|-----|-------|---------|
| `fm-collection` | `{ cardId: qty }` | owned counts, 0–3 (`MAX_COPIES = 3`) |
| `fm-decks` | `[ {id, name, cards:{cardId:count}, updatedAt} ]` | all decks |
| `fm-active-deck` | `deckId \| null` | which deck is selected |
| `fm-sync-meta` | `{ lastPush?, lastPull? }` | sync timestamps |

Other keys used site-wide by `ui.js`: `fm-theme` (`light`/`dark`),
`fm-sidebar-collapsed` (`'1'`/`'0'`). Additionally, `drive-sync.js` caches the
access token in **`sessionStorage`** under `drivesync-token:<clientId>` — this is
session-scoped (per tab, cleared on close), not persistent app state.

`DeckStore` exposes collection CRUD, deck CRUD, `exportData()`/`importData(obj)`,
and sync helpers. The **sync blob** shape (`getSyncBlob()`) is
`{ collection, decks, updatedAt }` — the same shape `importData()` consumes, so
push and pull are symmetric.

### 6b. Export / Import
`exportData()` → downloadable `fm-tools-decks.json`; `importData()` reads it back.
This is the always-available, zero-setup portability path.

### 6c. Google Drive sync — `js/drive-sync.js` (`DriveSync`) + `js/config.js`
Optional cross-device sync into a **private file in the hidden Drive
appDataFolder** of the user's own Google account. Browser-only OAuth (Google
Identity Services token flow — no client secret, nothing server-side).

- `DriveSync` is **app-agnostic and portable** — see its header comment and
  [`GOOGLE-DRIVE-SYNC.md`](GOOGLE-DRIVE-SYNC.md) for the reuse recipe.
- `config.js` holds `APP_CONFIG = { googleClientId, appKey }`. The Client ID is
  **public and safe to commit** (it's origin-locked, not a secret). `appKey`
  becomes the Drive filename `<appKey>.json` — this app uses
  `fm-forbidden-memories`.
- **Umbrella design:** one OAuth Client ID is reused across all the author's apps.
  Drive's `appDataFolder` is scoped per OAuth client, so all apps share one hidden
  folder and stay separate by filename (`<appKey>.json`). Adding a new app = new
  `appKey` + adding its origin to the OAuth client's authorized origins. No new
  Google project.
- Flow: `init(clientId, appKey)` → `signIn()` (popup) → `push(blob)` / `pull()`.
  Push/Pull are guarded by a `confirm()` (direction stated; extra warning when
  pushing empty data over a populated Drive file). Tokens are short-lived; kept in
  memory and cached in `sessionStorage` per tab (key `drivesync-token:<clientId>`)
  so navigating between the app's pages doesn't re-prompt — the cache clears on tab
  close and on `signOut()`. `deck-builder.js` wires the buttons and reflects state
  in the status line.

## 7. Design system — `css/style.css`

One stylesheet for the whole site. Conventions:

- **Type:** JetBrains Mono for labels/code-like UI, Inter for prose.
- **Accent:** amber `#d4962a`.
- **Theming:** CSS custom properties with a `[data-theme="light"]` override on
  `<html>`; the inline `<head>` script sets it before first paint to avoid a
  flash. `ui.js` toggles it and persists `fm-theme`.
- **Labels:** section labels are lowercase with a `//` prefix (e.g. `// pages`),
  echoing code comments.
- **Layout:** `.app-shell` = sidebar + main; sidebar is a collapsible strip on
  desktop and an off-canvas drawer (with scrim) on mobile (`ui.js`, breakpoint
  `max-width: 768px`).
- Page-specific blocks are grouped and commented within the file (Fusion bench,
  Sequence planner, Card library, Deck builder, etc.).

## 8. Conventions to follow

- **No dependencies at runtime.** Vanilla JS/CSS only. Playwright is dev-only.
- **Globals, loaded in order.** New shared helpers go in `fusion-core.js`; new
  page logic in a new `<page>.js` loaded last.
- **Delegated events + `data-action`/`data-id` attributes**, not per-element
  listeners.
- **Always `escapeHtml()`** anything interpolated into `innerHTML`.
- **Zero-padded string ids** ("001") everywhere — cards, images, fusion rules.
- **Keep the shared chrome identical** across all HTML pages.
- **Verify with Playwright** for anything interactive; mock external APIs
  (Google/Drive) via route interception + `addInitScript` rather than hitting the
  network. Assert `console errors == 0`.

## 9. Adding a new page (recipe)

1. Copy an existing page's HTML skeleton; set `<body class="X-page">`, the header
   path/title, and mark the correct nav link `active`.
2. Add the new nav link to **every** HTML file's sidebar.
3. Create `js/X.js` with an `init()` that `await`s `loadCoreData()`; load it last.
4. Add a `main.X { … }` style block in `css/style.css`.
5. Verify with Playwright (loads clean, no console errors, nav intact on all pages).
6. **Update the docs** (README page table + this file) and commit — see
   [`../CLAUDE.md`](../CLAUDE.md).
