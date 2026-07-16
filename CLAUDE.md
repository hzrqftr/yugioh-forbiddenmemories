# Working conventions for fm-tools

Guidance for anyone — especially agents — making changes here. Read
[`README.md`](README.md) for orientation and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
for how the framework fits together before you start.

## What this project is

A free, static, client-only Yu-Gi-Oh! Forbidden Memories fan tool on GitHub Pages.
No backend, no database, no build step, no runtime dependencies. Non-commercial.
Vanilla HTML/CSS/JS loaded as ordered `<script>` globals.

## Golden rule: docs stay in sync with the code

**Every time you commit a batch of new developments, update the documentation in
the same batch.** Docs are part of "done," not a follow-up. Concretely, before you
commit, check whether your change touches any of these and update accordingly:

- **New/renamed/removed page** → update the page table in [`README.md`](README.md),
  the repo map, the nav in **all** HTML files, and
  [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) (§2, §5, §9).
- **New shared helper / engine change** in `js/fusion-core.js` → ARCHITECTURE §4.
- **New localStorage key or data shape** → ARCHITECTURE §6 (the keys table) and,
  if a data file shape changed, [`DATASET.md`](DATASET.md).
- **Google/Drive sync change** → [`docs/GOOGLE-DRIVE-SYNC.md`](docs/GOOGLE-DRIVE-SYNC.md)
  (and `js/config.js` / `js/drive-sync.js` header comments if the recipe changed).
- **New data source or asset provenance** → [`DATASET.md`](DATASET.md) /
  [`NOTICE.md`](NOTICE.md).
- **New dependency or dev tool / run step** → README "Run locally".

If a change is purely internal and touches none of the above, note that in the
commit body ("docs: n/a — internal refactor") so it's clear the check was made.

## Coding conventions (summary — details in ARCHITECTURE §8)

- Vanilla JS, global-scoped, loaded in dependency order. No frameworks/bundlers.
- Page controllers build DOM via template strings + **delegated** events keyed on
  `data-action` / `data-id`.
- **Always** `escapeHtml()` anything interpolated into `innerHTML`.
- Card ids are zero-padded strings (`"001"`) everywhere.
- Keep the shared chrome (sidebar nav, favicon, theme toggle, footer) identical
  across all HTML pages.
- Match the existing design system in `css/style.css` (JetBrains Mono / Inter,
  amber `#d4962a`, `//`-prefixed labels, dark/light tokens).

## Verifying

- Use Playwright (dev dependency) for anything interactive. **Mock external APIs**
  (Google Identity Services, Drive REST) with route interception + `addInitScript`;
  never depend on the live network in a check. Assert `console errors == 0`.
- Serve over a local static server (not `file://`) so `fetch()` of `data/` works.
  Note some minimal servers mis-serve `.webp`/`.svg` MIME types locally; Pages is
  fine.

## Deploying

Push to `main`. GitHub Pages (branch `main`, path `/`) serves it. Live at
`https://hzrqftr.github.io/yugioh-forbiddenmemories/` (also the custom domain
`ourlittlemiracle.online/yugioh-forbiddenmemories/`).

## Committing

- Commit only when the user asks. Group logically (e.g. assets vs. feature vs.
  docs). Keep `node_modules/` out (it's gitignored).
- Do not commit secrets. Note: the Google **Client ID is public and intentionally
  committed** (`js/config.js`) — it is origin-locked, not a secret.
- Include doc updates in the same batch (see the Golden rule above).
