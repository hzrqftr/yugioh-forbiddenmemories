// Shared across every page: card/fusion data loading, the fusion-matching
// engine, and the combobox widget. Page-specific files (app.js, sequencer.js)
// call loadCoreData() then build their own DOM on top of this.

const DATA_BASE = 'data/';

const state = {
  cardsById: new Map(),
  monsterOptions: [], // [{ id, name, label }]
  fusionResults: [],  // flattened across all parts
  cardImagesById: new Map(), // keyed by zero-padded card number
};

async function loadCoreData() {
  await Promise.all([loadCards(), loadFusions(), loadCardImages()]);
  await loadCardMeta(); // needs cardsById populated to merge onto
  populateCardOptions();
}

async function loadCards() {
  const res = await fetch(DATA_BASE + 'forbidden_memories_cards.csv');
  if (!res.ok) throw new Error(`could not load card list (${res.status})`);
  const rows = parseCSV(await res.text());
  const header = rows[0];
  const idIdx = header.indexOf('Card Number');
  const nameIdx = header.indexOf('Card');
  const typeIdx = header.indexOf('Card Type');

  for (const row of rows.slice(1)) {
    if (row.length < header.length) continue;
    const card = {
      id: row[idIdx],
      name: row[nameIdx],
      cardType: row[typeIdx],
      monsterType: row[header.indexOf('Type')],
      level: row[header.indexOf('Level')],
      atk: row[header.indexOf('ATK')],
      def: row[header.indexOf('DFD')],
      password: row[header.indexOf('Password')],
      scCost: row[header.indexOf('SC Cost')],
    };
    state.cardsById.set(card.id, card);
  }
}

async function loadCardImages() {
  try {
    const images = await fetchJson(DATA_BASE + 'card_images.json');
    for (const img of images) {
      state.cardImagesById.set(img.number, img);
    }
  } catch {
    // images are optional; proceed without them
  }
}

// Extra per-card metadata (Guardian Stars + in-game description), keyed by the
// same zero-padded id. Optional — merged onto the card objects if present.
async function loadCardMeta() {
  try {
    const meta = await fetchJson(DATA_BASE + 'card_meta.json');
    for (const [id, m] of Object.entries(meta)) {
      const card = state.cardsById.get(id);
      if (card) { card.gsA = m.gsA; card.gsB = m.gsB; card.desc = m.desc; }
    }
  } catch {
    // metadata is optional; proceed without guardian stars / descriptions
  }
}

async function loadFusions() {
  const manifest = await fetchJson(DATA_BASE + 'fusion_rules_manifest.json');
  const parts = await Promise.all(
    manifest.parts.map((p) => fetchJson(DATA_BASE + p))
  );
  state.fusionResults = parts.flat();
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (${res.status})`);
  return res.json();
}

// Minimal RFC4180-ish CSV parser: handles quoted fields with embedded commas
// (needed for values like "999,999" in the SC Cost column).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function populateCardOptions() {
  state.monsterOptions = [...state.cardsById.values()]
    .filter((c) => c.cardType === 'Monster')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name, label: c.name }));
}

function filterOptions(options, query) {
  const q = query.trim().toLowerCase();
  if (!q) return options.slice();
  return options.filter((o) => o.name.toLowerCase().includes(q));
}

function resolveMaterialId(inputValue) {
  const byName = state.monsterOptions.find(
    (o) => o.name.toLowerCase() === inputValue.trim().toLowerCase()
  );
  return byName ? byName.id : null;
}

function computeValidPartners(id, includeGlitch) {
  const partnerIds = new Set();
  for (const result of state.fusionResults) {
    if (result.isGlitch && !includeGlitch) continue;
    if (result.resultId === id) continue; // skip degenerate "fuse X to get X back"
    for (const rule of result.rules) {
      if (rule.material1.includes(id)) rule.material2.forEach((m) => { if (m !== result.resultId) partnerIds.add(m); });
      if (rule.material2.includes(id)) rule.material1.forEach((m) => { if (m !== result.resultId) partnerIds.add(m); });
    }
  }
  return partnerIds;
}

function getPartnerCandidates(id, includeGlitch) {
  const partnerIds = computeValidPartners(id, includeGlitch);
  return state.monsterOptions.filter((o) => partnerIds.has(o.id));
}

function findFusionMatches(id1, id2, includeGlitch) {
  const matches = [];
  for (const result of state.fusionResults) {
    if (result.isGlitch && !includeGlitch) continue;
    if (result.resultId === id1 || result.resultId === id2) continue; // no self→self fusions
    const hit = result.rules.some((rule) => {
      const forward = rule.material1.includes(id1) && rule.material2.includes(id2);
      const backward = rule.material1.includes(id2) && rule.material2.includes(id1);
      return forward || backward;
    });
    if (hit) matches.push(result);
  }
  return matches;
}

// A minimal combobox: opens on typing or the arrow toggle, never on
// focus alone, and its dropdown is sized to the input via CSS (not
// the browser's native, inconsistently-positioned <datalist> popup).
function setupCombobox({ input, listEl, toggleBtn, clearBtn, getOptions, onChange, onClear }) {
  let currentOptions = [];
  let activeIndex = -1;

  function render() {
    if (currentOptions.length === 0) {
      listEl.innerHTML = '<li class="combo-empty">No matches</li>';
      return;
    }
    listEl.innerHTML = currentOptions
      .map((o, i) => `<li role="option" data-index="${i}" class="${i === activeIndex ? 'active' : ''}">${escapeHtml(o.label)}</li>`)
      .join('');
  }

  function open(options) {
    currentOptions = options;
    activeIndex = options.length ? 0 : -1;
    render();
    listEl.hidden = false;
    input.setAttribute('aria-expanded', 'true');
  }

  function close() {
    listEl.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    currentOptions = [];
    activeIndex = -1;
  }

  function isOpen() {
    return !listEl.hidden;
  }

  function selectIndex(i) {
    const option = currentOptions[i];
    if (!option) return;
    input.value = option.label;
    close();
    onChange();
  }

  input.addEventListener('input', () => {
    const query = input.value;
    if (!query.trim()) {
      close();
      return;
    }
    open(getOptions(query));
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen()) open(getOptions(input.value));
      else { activeIndex = Math.min(activeIndex + 1, currentOptions.length - 1); render(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (isOpen()) { activeIndex = Math.max(activeIndex - 1, 0); render(); }
    } else if (e.key === 'Enter') {
      if (isOpen() && activeIndex >= 0) {
        e.preventDefault();
        selectIndex(activeIndex);
      }
    } else if (e.key === 'Escape') {
      close();
    }
  });

  toggleBtn.addEventListener('click', () => {
    if (isOpen()) close();
    else {
      open(getOptions(input.value));
      input.focus();
    }
  });

  clearBtn.addEventListener('click', () => {
    input.value = '';
    close();
    onClear();
    input.focus();
  });

  // mousedown (not click) + preventDefault stops the input from
  // blurring before the selection registers.
  listEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const li = e.target.closest('li[data-index]');
    if (!li) return;
    selectIndex(Number(li.dataset.index));
  });

  document.addEventListener('click', (e) => {
    if (!input.closest('.combo').contains(e.target)) {
      close();
      input.blur();
    }
  });
}

// A single shared floating card picker: click an anchor (e.g. a card slot),
// search, and choose a card. Generalized from the Sequence Planner's inline
// picker so any page can reuse one instance. (The sequencer keeps its own
// slot-bound picker for now; this is used by the Fusion Finder's equation.)
let _cardPicker = null;

function ensureCardPicker() {
  if (_cardPicker) return _cardPicker;

  const el = document.createElement('div');
  el.className = 'slot-picker';
  el.hidden = true;
  el.innerHTML = `
    <input type="text" class="slot-search" placeholder="Search card…" autocomplete="off">
    <ul class="slot-list" role="listbox"></ul>
  `;
  document.body.appendChild(el);

  const searchEl = el.querySelector('.slot-search');
  const listEl = el.querySelector('.slot-list');
  const picker = { el, searchEl, listEl, anchorEl: null, options: [], onSelect: null, activeIndex: -1 };
  _cardPicker = picker;

  function render() {
    const opts = filterOptions(picker.options, searchEl.value);
    picker.activeIndex = opts.length ? 0 : -1;
    if (opts.length === 0) {
      listEl.innerHTML = '<li class="combo-empty">No matches</li>';
      return;
    }
    listEl.innerHTML = opts
      .map((o, i) => `<li role="option" data-id="${escapeHtml(o.id)}" data-index="${i}" class="${i === 0 ? 'active' : ''}">${escapeHtml(o.label)}</li>`)
      .join('');
  }
  picker._render = render;

  function syncActive(items) {
    items.forEach((it, i) => it.classList.toggle('active', i === picker.activeIndex));
    const it = items[picker.activeIndex];
    if (it) it.scrollIntoView({ block: 'nearest' });
  }

  function choose(id) {
    const cb = picker.onSelect;
    closeCardPicker();
    if (cb) cb(id);
  }

  searchEl.addEventListener('input', render);
  searchEl.addEventListener('keydown', (e) => {
    const items = [...listEl.querySelectorAll('li[data-index]')];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      picker.activeIndex = Math.min(picker.activeIndex + 1, items.length - 1);
      syncActive(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      picker.activeIndex = Math.max(picker.activeIndex - 1, 0);
      syncActive(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = items[picker.activeIndex];
      if (item) choose(item.dataset.id);
    } else if (e.key === 'Escape') {
      closeCardPicker();
    }
  });

  // mousedown + preventDefault so the search input doesn't blur before select.
  listEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const li = e.target.closest('li[data-id]');
    if (li) choose(li.dataset.id);
  });

  document.addEventListener('click', (e) => {
    if (el.hidden) return;
    if (!el.contains(e.target) && (!picker.anchorEl || !picker.anchorEl.contains(e.target))) {
      closeCardPicker();
    }
  });

  return picker;
}

// Open the shared picker anchored under `anchorEl`. `options` is a list of
// {id,label,name}; `onSelect(id)` fires when the user commits a choice.
function openCardPicker(anchorEl, { options, onSelect }) {
  const picker = ensureCardPicker();

  // Clicking the same anchor again toggles the picker closed.
  if (!picker.el.hidden && picker.anchorEl === anchorEl) {
    closeCardPicker();
    return;
  }

  picker.anchorEl = anchorEl;
  picker.options = options;
  picker.onSelect = onSelect;
  picker.searchEl.value = '';
  picker._render();

  const rect = anchorEl.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;
  picker.el.style.top = (rect.bottom + scrollTop + 4) + 'px';
  picker.el.style.left = (rect.left + scrollLeft) + 'px';
  picker.el.style.width = Math.max(rect.width, 220) + 'px';

  picker.el.hidden = false;
  anchorEl.classList.add('active');
  picker.searchEl.focus();
}

function closeCardPicker() {
  if (!_cardPicker) return;
  if (_cardPicker.anchorEl) _cardPicker.anchorEl.classList.remove('active');
  _cardPicker.el.hidden = true;
  _cardPicker.anchorEl = null;
  _cardPicker.activeIndex = -1;
}

// Clicking a <label for="..."> natively focuses its control; suppress that
// so clicking a label counts as "clicking away" like anywhere else. Delegated
// on document so it also covers labels added to the page later.
document.addEventListener('click', (e) => {
  if (e.target.tagName === 'LABEL') e.preventDefault();
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}
