// Card Library — browse every card. The detail panel shows the selected card's
// art + stats, and a tabbed fusion section: "used as material" (top monsters you
// can fuse using this card) and "how to summon" (this card's own recipe, if any).

const CARD_TYPES = ['All', 'Monster', 'Magic', 'Trap', 'Ritual', 'Equip', 'Field'];
const TOP_N = 5;
const CAN_HOVER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

const libState = { selectedId: null, query: '', typeFilter: 'All', activeTab: null };
let allCards = []; // every card, sorted by id
let cardTip = null;

init();

async function init() {
  const detail = document.getElementById('card-detail');
  try {
    await loadCoreData();
  } catch (err) {
    detail.innerHTML = `<p class="error-state">Failed to load card data: ${escapeHtml(err.message)}</p>`;
    return;
  }

  allCards = [...state.cardsById.values()].sort((a, b) => a.id.localeCompare(b.id));

  buildFilterChips();

  document.getElementById('library-search').addEventListener('input', (e) => {
    libState.query = e.target.value;
    renderList();
  });

  const listEl = document.getElementById('library-list');
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('li[data-id]');
    if (row) selectCard(row.dataset.id);
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('li[data-id]');
    if (row) { e.preventDefault(); selectCard(row.dataset.id); }
  });

  const detailEl = document.getElementById('card-detail');
  detailEl.addEventListener('click', (e) => {
    const tab = e.target.closest('.detail-tab');
    if (tab && !tab.disabled) {
      libState.activeTab = tab.dataset.tab;
      renderDetail(libState.selectedId);
      return;
    }
    // Fusion/material rows link back into the list (browse loop).
    const row = e.target.closest('[data-jump]');
    if (row) selectCard(row.dataset.jump, { scrollList: true });
  });
  setupTooltip(detailEl);

  renderList();
  const first = visibleCards()[0] || allCards[0];
  if (first) selectCard(first.id);
}

/* ── Filtering / list ────────────────────────────────────────────────────── */

function buildFilterChips() {
  const wrap = document.getElementById('library-filters');
  wrap.innerHTML = CARD_TYPES
    .map((t) => `<button type="button" class="filter-chip${t === libState.typeFilter ? ' active' : ''}" data-type="${t}">${t}</button>`)
    .join('');
  wrap.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    libState.typeFilter = chip.dataset.type;
    wrap.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
    renderList();
  });
}

function visibleCards() {
  const q = libState.query.trim().toLowerCase();
  return allCards.filter((c) => {
    if (libState.typeFilter !== 'All' && c.cardType !== libState.typeFilter) return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

function rowStat(card) {
  return card.cardType === 'Monster'
    ? `${escapeHtml(card.atk)}/${escapeHtml(card.def)}`
    : escapeHtml(card.cardType);
}

function renderList() {
  const cards = visibleCards();
  const listEl = document.getElementById('library-list');
  const countEl = document.getElementById('library-count');

  countEl.textContent = cards.length === allCards.length
    ? `all cards (${allCards.length})`
    : `${cards.length} of ${allCards.length}`;

  if (cards.length === 0) {
    listEl.innerHTML = '<li class="library-empty">No cards match.</li>';
    return;
  }

  listEl.innerHTML = cards
    .map((c) => `
      <li role="option" data-id="${escapeHtml(c.id)}" tabindex="0"
          class="library-row${c.id === libState.selectedId ? ' active' : ''}"
          aria-selected="${c.id === libState.selectedId}">
        <span class="row-id">#${escapeHtml(c.id)}</span>
        <span class="row-name">${escapeHtml(c.name)}</span>
        <span class="row-stat">${rowStat(c)}</span>
      </li>`)
    .join('');
}

function selectCard(id, { scrollList = false } = {}) {
  if (!state.cardsById.has(id)) return;
  libState.selectedId = id;
  libState.activeTab = null; // each card starts on its default (available) tab

  const listEl = document.getElementById('library-list');
  listEl.querySelectorAll('.library-row').forEach((row) => {
    const on = row.dataset.id === id;
    row.classList.toggle('active', on);
    row.setAttribute('aria-selected', on ? 'true' : 'false');
  });

  const activeRow = listEl.querySelector(`.library-row[data-id="${id}"]`);
  if (activeRow && scrollList) activeRow.scrollIntoView({ block: 'nearest' });

  renderDetail(id);
}

/* ── Fusion relationships ────────────────────────────────────────────────── */

// Non-glitch results that use `id` as one of the two materials, deduped.
function fusionResultsUsing(id) {
  const seen = new Set();
  const out = [];
  for (const r of state.fusionResults) {
    if (r.isGlitch) continue;
    if (seen.has(r.resultId)) continue;
    if (r.rules.some((rule) => rule.material1.includes(id) || rule.material2.includes(id))) {
      seen.add(r.resultId);
      out.push(r);
    }
  }
  return out;
}

// Non-glitch recipes whose result IS this card (how to summon it).
function fusionRecipesFor(id) {
  return state.fusionResults.filter((r) => !r.isGlitch && r.resultId === id);
}

function topResults(id, stat) {
  return fusionResultsUsing(id)
    .map((r) => state.cardsById.get(r.resultId))
    .filter(Boolean)
    .sort((a, b) => Number(b[stat]) - Number(a[stat]))
    .slice(0, TOP_N);
}

/* ── Detail panel ────────────────────────────────────────────────────────── */

function renderDetail(id) {
  const card = state.cardsById.get(id);
  const detail = document.getElementById('card-detail');
  if (!card) { detail.innerHTML = ''; return; }

  const img = state.cardImagesById.get(id);
  const imgHtml = img && img.localPath
    ? `<img class="detail-img" src="${escapeHtml(img.localPath)}" alt="${escapeHtml(card.name)}">`
    : `<div class="detail-img detail-img-missing"><span>${escapeHtml(card.name)}</span></div>`;
  const tcgNote = img && img.source === 'tcg-print'
    ? `<p class="detail-note">Art shown is a TCG print; in-game art differs.</p>`
    : '';

  const statHtml = card.cardType === 'Monster'
    ? `
      <div class="stat-cell"><span class="stat-key">TYPE</span><span class="stat-val">${escapeHtml(card.monsterType)}</span></div>
      <div class="stat-cell"><span class="stat-key">LEVEL</span><span class="stat-val">${escapeHtml(card.level)}</span></div>
      <div class="stat-cell"><span class="stat-key">ATK</span><span class="stat-val">${escapeHtml(card.atk)}</span></div>
      <div class="stat-cell"><span class="stat-key">DEF</span><span class="stat-val">${escapeHtml(card.def)}</span></div>`
    : `<div class="stat-cell"><span class="stat-key">CARD TYPE</span><span class="stat-val">${escapeHtml(card.cardType)}</span></div>`;

  const hasA = fusionResultsUsing(id).length > 0;
  const recipes = fusionRecipesFor(id);
  const hasB = recipes.length > 0;

  let tab;
  if (libState.activeTab === 'B' && hasB) tab = 'B';
  else if (libState.activeTab === 'A' && hasA) tab = 'A';
  else tab = hasA ? 'A' : (hasB ? 'B' : null);

  let panel;
  if (tab === 'A') {
    panel = `
      <div class="detail-fusions">
        ${leaderboardHtml('top by atk', topResults(id, 'atk'), 'atk')}
        ${leaderboardHtml('top by def', topResults(id, 'def'), 'def')}
      </div>`;
  } else if (tab === 'B') {
    panel = recipes.map(recipeBlockHtml).join('');
  } else {
    panel = `<p class="empty-state">This card has no fusion relationships.</p>`;
  }

  detail.innerHTML = `
    <div class="detail-hero">
      ${imgHtml}
      <div class="detail-head result-caption">
        <p class="detail-eyebrow">#${escapeHtml(card.id)} · ${escapeHtml(card.cardType)}</p>
        <h3>${escapeHtml(card.name)}</h3>
        <div class="stat-grid">${statHtml}</div>
        ${tcgNote}
      </div>
    </div>
    ${acquisitionHtml(card, hasB)}
    <div class="detail-tabs" role="tablist">
      <button type="button" class="detail-tab${tab === 'A' ? ' active' : ''}" data-tab="A" ${hasA ? '' : 'disabled'}>used as material</button>
      <button type="button" class="detail-tab${tab === 'B' ? ' active' : ''}" data-tab="B" ${hasB ? '' : 'disabled'}>how to summon</button>
    </div>
    <div class="detail-tab-panel">${panel}</div>
  `;
}

// Acquisition summary from owned data (password + StarChip cost) plus whether
// the card is fusion-obtainable. Cards that are neither buyable nor fusible
// must be won as a duel drop / from the starter deck or story.
function acquisitionHtml(card, fusionable) {
  const sc = (card.scCost || '').trim();
  const buyable = sc && sc !== '999,999';
  const hasPw = card.password && card.password.trim();

  const rows = [];
  if (hasPw) {
    rows.push(`<div class="acq-row"><span class="acq-key">password</span><span class="acq-val">${escapeHtml(card.password.trim())}</span></div>`);
  }
  rows.push(`<div class="acq-row"><span class="acq-key">starchips</span><span class="acq-val">${buyable ? escapeHtml(sc) : 'not buyable · password locked'}</span></div>`);

  const methods = [];
  if (buyable) methods.push('buy via password');
  if (fusionable) methods.push('fusion');
  const note = methods.length
    ? `<p class="acq-note">Obtainable by ${methods.join(' or ')}.</p>`
    : `<p class="acq-note warn">Not buyable and not fusible — win it as a duel drop, or from the starter deck / story campaign.</p>`;

  return `
    <div class="acq-section">
      <p class="grid-label">acquisition</p>
      <div class="acq-grid">${rows.join('')}</div>
      ${note}
    </div>`;
}

function thumbHtml(id) {
  const img = state.cardImagesById.get(id);
  return img && img.localPath
    ? `<img class="lb-thumb" src="${escapeHtml(img.localPath)}" alt="">`
    : `<span class="lb-thumb lb-thumb-missing"></span>`;
}

function leaderboardHtml(label, cards, stat) {
  const rows = cards
    .map((c, i) => `
        <li class="lb-row" data-jump="${escapeHtml(c.id)}">
          <span class="lb-rank">${i + 1}</span>
          ${thumbHtml(c.id)}
          <span class="lb-name">${escapeHtml(c.name)}</span>
          <span class="lb-stat">${escapeHtml(c[stat])}</span>
        </li>`)
    .join('');
  return `
    <div class="leaderboard">
      <p class="grid-label">${label}</p>
      <ul class="lb-list">${rows}</ul>
    </div>`;
}

function materialColumnHtml(label, ids) {
  const rows = ids
    .map((mid) => {
      const c = state.cardsById.get(mid);
      const name = c ? c.name : mid;
      return `
        <li class="lb-row mat-row" data-jump="${escapeHtml(mid)}">
          ${thumbHtml(mid)}
          <span class="lb-name">${escapeHtml(name)}</span>
        </li>`;
    })
    .join('');
  return `
    <div class="leaderboard">
      <p class="grid-label">${escapeHtml(label)}</p>
      <ul class="lb-list">${rows}</ul>
    </div>`;
}

function recipeBlockHtml(recipe) {
  const heading = recipe.description
    ? `<p class="recipe-desc">${escapeHtml(recipe.description)}</p>`
    : '';
  const rules = recipe.rules
    .map((rule) => `
      <div class="detail-fusions">
        ${materialColumnHtml('material a', rule.material1)}
        ${materialColumnHtml('material b', rule.material2)}
      </div>`)
    .join('');
  return `<div class="recipe-block">${heading}${rules}</div>`;
}

/* ── Hover tooltip (desktop only) ────────────────────────────────────────── */

function setupTooltip(detailEl) {
  if (!CAN_HOVER) return;

  cardTip = document.createElement('div');
  cardTip.className = 'card-tip';
  cardTip.hidden = true;
  document.body.appendChild(cardTip);

  detailEl.addEventListener('mouseover', (e) => {
    const row = e.target.closest('[data-jump]');
    if (row) showTip(row);
  });
  detailEl.addEventListener('mouseout', (e) => {
    const row = e.target.closest('[data-jump]');
    if (row && (!e.relatedTarget || !row.contains(e.relatedTarget))) hideTip();
  });
  window.addEventListener('scroll', hideTip, true);
}

function showTip(row) {
  const card = state.cardsById.get(row.dataset.jump);
  if (!card) return;
  const line = card.cardType === 'Monster'
    ? `${card.monsterType} · Lv ${card.level} · ATK ${card.atk} / DEF ${card.def}`
    : card.cardType;
  cardTip.innerHTML = `<span class="tip-name">${escapeHtml(card.name)}</span><span class="tip-stat">${escapeHtml(line)}</span>`;
  cardTip.hidden = false;

  const r = row.getBoundingClientRect();
  const tipW = cardTip.offsetWidth;
  let left = Math.min(r.left, window.innerWidth - tipW - 8);
  left = Math.max(8, left);
  cardTip.style.left = left + 'px';
  if (r.top > 70) {
    cardTip.style.top = (r.top - 8) + 'px';
    cardTip.style.transform = 'translateY(-100%)';
  } else {
    cardTip.style.top = (r.bottom + 8) + 'px';
    cardTip.style.transform = 'none';
  }
}

function hideTip() {
  if (cardTip) cardTip.hidden = true;
}
