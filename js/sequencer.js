const MAX_EXPLORED_PAIRS = 20000;

const slotStates = [];
let activeSlotIndex = -1;
let pickerEl = null;
let pickerSearchEl = null;
let pickerListEl = null;
let pickerActiveItemIndex = -1;

// Pointer-based drag to move/swap cards between slots (desktop + touch).
const DRAG_THRESHOLD = 5;       // px of movement before a mouse drag begins
const TOUCH_MOVE_CANCEL = 10;   // px of movement that cancels a pending long-press (= scroll)
const LONG_PRESS_MS = 350;      // touch hold before a drag lifts
const drag = {
  pointerId: null,
  sourceIndex: -1,
  startX: 0, startY: 0,
  lastX: 0, lastY: 0,
  isTouch: false,
  armed: false,   // pressed on a filled slot, drag not yet started
  active: false,  // drag in progress
  didDrag: false, // set on drop so the trailing click doesn't reopen the picker
  ghost: null,
  longPressTimer: null,
};

// Interactive "apply fusion": pick a listed fusion, then click a slot to drop its
// result into (consuming the materials). placement is the pending choice awaiting
// a destination click; undoStack snapshots the board before each destructive op.
const placement = { active: false, slots: [], resultId: null, resultName: '' };
const undoStack = [];
let bannerEl = null;

init();

async function init() {
  const results = document.getElementById('sequence-results');
  try {
    await loadCoreData();
  } catch (err) {
    results.innerHTML = `<p class="error-state">Failed to load card data: ${escapeHtml(err.message)}</p>`;
    return;
  }

  createPickerElement();
  createPlacementBanner();
  initSlots();

  document.getElementById('pool-form').addEventListener('submit', onPoolSubmit);
  document.getElementById('seq-include-glitch').addEventListener('change', clearSequenceResults);
  document.getElementById('sequence-results').addEventListener('click', onResultsClick);
  document.getElementById('seq-undo').addEventListener('click', undo);
  document.getElementById('seq-reset').addEventListener('click', resetBoard);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && placement.active) cancelPlacement(); });
  updateUndoButton();
}

function createPickerElement() {
  pickerEl = document.createElement('div');
  pickerEl.className = 'slot-picker';
  pickerEl.hidden = true;
  pickerEl.innerHTML = `
    <input type="text" class="slot-search" placeholder="Search card…" autocomplete="off">
    <ul class="slot-list" role="listbox"></ul>
  `;
  document.body.appendChild(pickerEl);

  pickerSearchEl = pickerEl.querySelector('.slot-search');
  pickerListEl = pickerEl.querySelector('.slot-list');

  pickerSearchEl.addEventListener('input', renderPickerList);
  pickerSearchEl.addEventListener('keydown', onPickerKeydown);

  pickerListEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    selectCard(activeSlotIndex, li.dataset.id);
  });

  document.addEventListener('click', (e) => {
    if (activeSlotIndex < 0) return;
    const activeSlotEl = slotStates[activeSlotIndex].el;
    if (!pickerEl.contains(e.target) && !activeSlotEl.contains(e.target)) {
      closePicker();
    }
  });
}

function initSlots() {
  const handContainer = document.getElementById('hand-slots');
  const fieldContainer = document.getElementById('field-slots');

  for (let i = 0; i < 10; i++) {
    const zone = i < 5 ? 'hand' : 'field';
    const container = i < 5 ? handContainer : fieldContainer;
    const slotIndex = i;

    const slotEl = document.createElement('div');
    slotEl.className = 'card-slot';
    slotEl.dataset.index = slotIndex;
    slotEl.dataset.zone = zone;
    slotEl.innerHTML = `
      <div class="slot-placeholder">+</div>
      <img class="slot-img" alt="" draggable="false" hidden>
      <button type="button" class="slot-clear-btn" aria-label="Clear card" hidden>&times;</button>
    `;

    container.appendChild(slotEl);
    slotStates.push({ index: slotIndex, zone, cardId: null, el: slotEl });

    slotEl.addEventListener('click', (e) => {
      if (e.target.closest('.slot-clear-btn')) return;
      if (drag.didDrag) { drag.didDrag = false; return; } // swallow the click after a drag
      if (placement.active) { commitPlacement(slotIndex); return; } // placing a fused result
      openPicker(slotIndex);
    });

    slotEl.querySelector('.slot-clear-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      clearSlot(slotIndex);
    });

    slotEl.addEventListener('pointerdown', (e) => onSlotPointerDown(e, slotIndex));
  }
}

function openPicker(slotIndex) {
  if (activeSlotIndex === slotIndex) {
    closePicker();
    return;
  }
  closePicker();
  activeSlotIndex = slotIndex;
  slotStates[slotIndex].el.classList.add('active');

  pickerSearchEl.value = '';
  renderPickerList();
  positionPicker(slotStates[slotIndex].el);
  pickerEl.hidden = false;
  pickerSearchEl.focus();
}

function positionPicker(slotEl) {
  const rect = slotEl.getBoundingClientRect();
  const scrollTop = window.scrollY || document.documentElement.scrollTop;
  const scrollLeft = window.scrollX || document.documentElement.scrollLeft;

  pickerEl.style.top = (rect.bottom + scrollTop + 4) + 'px';
  pickerEl.style.left = (rect.left + scrollLeft) + 'px';
  pickerEl.style.width = Math.max(rect.width, 220) + 'px';
}

function closePicker() {
  if (activeSlotIndex >= 0) {
    slotStates[activeSlotIndex].el.classList.remove('active');
    activeSlotIndex = -1;
  }
  if (pickerEl) pickerEl.hidden = true;
  pickerActiveItemIndex = -1;
}

function renderPickerList() {
  const options = filterOptions(state.monsterOptions, pickerSearchEl.value);
  pickerActiveItemIndex = options.length ? 0 : -1;

  if (options.length === 0) {
    pickerListEl.innerHTML = '<li class="combo-empty">No matches</li>';
    return;
  }

  pickerListEl.innerHTML = options
    .map((o, i) => `<li role="option" data-id="${escapeHtml(o.id)}" data-index="${i}" class="${i === 0 ? 'active' : ''}">${escapeHtml(o.label)}</li>`)
    .join('');
}

function onPickerKeydown(e) {
  const items = [...pickerListEl.querySelectorAll('li[data-index]')];
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    pickerActiveItemIndex = Math.min(pickerActiveItemIndex + 1, items.length - 1);
    updatePickerActiveItem(items);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    pickerActiveItemIndex = Math.max(pickerActiveItemIndex - 1, 0);
    updatePickerActiveItem(items);
  } else if (e.key === 'Enter') {
    const activeItem = items[pickerActiveItemIndex];
    if (activeItem) {
      e.preventDefault();
      selectCard(activeSlotIndex, activeItem.dataset.id);
    }
  } else if (e.key === 'Escape') {
    closePicker();
  }
}

function updatePickerActiveItem(items) {
  items.forEach((item, i) => item.classList.toggle('active', i === pickerActiveItemIndex));
  const activeItem = items[pickerActiveItemIndex];
  if (activeItem) activeItem.scrollIntoView({ block: 'nearest' });
}

// Low-level: render a slot purely from a cardId (null = empty). No side effects
// beyond the slot's own DOM — shared by pick, clear, and drag move/swap.
function setSlotCard(slotIndex, cardId) {
  const slot = slotStates[slotIndex];
  slot.cardId = cardId || null;

  const imgEl = slot.el.querySelector('.slot-img');
  const placeholderEl = slot.el.querySelector('.slot-placeholder');
  const clearBtnEl = slot.el.querySelector('.slot-clear-btn');

  if (slot.cardId) {
    const imageData = state.cardImagesById.get(slot.cardId);
    if (imageData?.localPath) {
      imgEl.src = imageData.localPath;
      imgEl.alt = state.cardsById.get(slot.cardId)?.name || '';
      imgEl.hidden = false;
      placeholderEl.hidden = true;
      placeholderEl.classList.remove('filled-label');
    } else {
      imgEl.hidden = true;
      imgEl.removeAttribute('src');
      placeholderEl.textContent = state.cardsById.get(slot.cardId)?.name || slot.cardId;
      placeholderEl.classList.add('filled-label');
      placeholderEl.hidden = false;
    }
    clearBtnEl.hidden = false;
    slot.el.classList.add('filled');
  } else {
    imgEl.hidden = true;
    imgEl.removeAttribute('src');
    placeholderEl.textContent = '+';
    placeholderEl.classList.remove('filled-label');
    placeholderEl.hidden = false;
    clearBtnEl.hidden = true;
    slot.el.classList.remove('filled');
  }
}

function selectCard(slotIndex, cardId) {
  if (slotIndex < 0 || slotIndex >= slotStates.length) return;
  setSlotCard(slotIndex, cardId);
  closePicker();
  clearSequenceResults();
}

function clearSlot(slotIndex) {
  setSlotCard(slotIndex, null);
  clearSequenceResults();
}

// Move (to empty) or swap (with filled) the card from one slot into another.
function moveCard(from, to) {
  if (from === to) return;
  const a = slotStates[from].cardId;
  const b = slotStates[to].cardId;
  if (a == null) return;
  setSlotCard(to, a);
  setSlotCard(from, b); // b is null → move; otherwise → swap
  clearSequenceResults();
}

/* ── Pointer drag engine (desktop click-drag + touch long-press) ──────────── */

function onSlotPointerDown(e, slotIndex) {
  if (placement.active) return;                            // no dragging while placing a result
  if (e.button != null && e.button > 0) return;            // ignore non-primary buttons
  if (e.target.closest('.slot-clear-btn')) return;         // clear button isn't a drag handle
  if (slotStates[slotIndex].cardId == null) return;        // only filled slots are draggable
  if (drag.armed || drag.active) return;

  drag.pointerId = e.pointerId;
  drag.sourceIndex = slotIndex;
  drag.startX = drag.lastX = e.clientX;
  drag.startY = drag.lastY = e.clientY;
  drag.isTouch = e.pointerType === 'touch';
  drag.armed = true;
  drag.active = false;

  window.addEventListener('pointermove', onDragMove, { passive: false });
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('pointercancel', onDragCancel);
  window.addEventListener('keydown', onDragKey);

  if (drag.isTouch) {
    drag.longPressTimer = setTimeout(() => {
      drag.longPressTimer = null;
      if (drag.armed && !drag.active) beginDrag();
    }, LONG_PRESS_MS);
  }
}

function onDragMove(e) {
  if (e.pointerId !== drag.pointerId) return;
  drag.lastX = e.clientX;
  drag.lastY = e.clientY;

  if (!drag.active) {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (drag.isTouch) {
      // Moved before the hold completed → user is scrolling, not dragging.
      if (drag.longPressTimer && dist > TOUCH_MOVE_CANCEL) cancelArming();
      return;
    }
    if (dist > DRAG_THRESHOLD) beginDrag();
    else return;
  }

  e.preventDefault(); // stop touch scroll / text selection during an active drag
  positionGhost(e.clientX, e.clientY);
  highlightDropTarget(e.clientX, e.clientY);
}

function beginDrag() {
  drag.active = true;
  drag.didDrag = false;
  closePicker();

  const srcEl = slotStates[drag.sourceIndex].el;
  try { srcEl.setPointerCapture(drag.pointerId); } catch { /* ignore */ }
  srcEl.classList.add('dragging');
  document.body.classList.add('slot-dragging');

  const cardId = slotStates[drag.sourceIndex].cardId;
  const img = state.cardImagesById.get(cardId);
  drag.ghost = document.createElement('div');
  drag.ghost.className = 'slot-drag-ghost';
  drag.ghost.innerHTML = img?.localPath
    ? `<img src="${img.localPath}" alt="">`
    : `<span>${escapeHtml(state.cardsById.get(cardId)?.name || cardId)}</span>`;
  document.body.appendChild(drag.ghost);

  positionGhost(drag.lastX, drag.lastY);
  highlightDropTarget(drag.lastX, drag.lastY);
}

function positionGhost(x, y) {
  if (!drag.ghost) return;
  drag.ghost.style.left = x + 'px';
  drag.ghost.style.top = y + 'px';
}

function targetSlotAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const slotEl = el && el.closest ? el.closest('.card-slot') : null;
  if (!slotEl || slotEl.dataset.index === undefined) return -1;
  return Number(slotEl.dataset.index);
}

function highlightDropTarget(x, y) {
  const idx = targetSlotAt(x, y);
  slotStates.forEach((s, i) => {
    s.el.classList.toggle('drop-target', i === idx && i !== drag.sourceIndex);
  });
}

function onDragEnd(e) {
  if (e.pointerId !== drag.pointerId) return;
  const wasActive = drag.active;
  const src = drag.sourceIndex;
  const target = wasActive ? targetSlotAt(e.clientX, e.clientY) : -1;
  teardownDrag();
  if (wasActive) {
    drag.didDrag = true; // suppress the click that follows this pointerup
    if (target >= 0 && target !== src) moveCard(src, target);
  }
}

function onDragCancel(e) {
  if (e.pointerId !== drag.pointerId) return;
  teardownDrag();
}

function onDragKey(e) {
  if (e.key === 'Escape' && (drag.armed || drag.active)) teardownDrag();
}

function cancelArming() {
  teardownDrag();
}

function teardownDrag() {
  window.removeEventListener('pointermove', onDragMove);
  window.removeEventListener('pointerup', onDragEnd);
  window.removeEventListener('pointercancel', onDragCancel);
  window.removeEventListener('keydown', onDragKey);
  if (drag.longPressTimer) { clearTimeout(drag.longPressTimer); drag.longPressTimer = null; }
  if (drag.pointerId != null && drag.sourceIndex >= 0) {
    try { slotStates[drag.sourceIndex].el.releasePointerCapture(drag.pointerId); } catch { /* ignore */ }
  }
  if (drag.ghost) { drag.ghost.remove(); drag.ghost = null; }
  slotStates.forEach((s) => s.el.classList.remove('dragging', 'drop-target'));
  document.body.classList.remove('slot-dragging');
  drag.active = false;
  drag.armed = false;
  drag.sourceIndex = -1;
  drag.pointerId = null;
  drag.isTouch = false;
}

function getPool() {
  return slotStates
    .filter((s) => s.cardId !== null)
    .map((s) => ({ id: s.cardId, name: state.cardsById.get(s.cardId).name, slotIndex: s.index }));
}

function clearSequenceResults() {
  document.getElementById('sequence-results').innerHTML = '';
}

function onPoolSubmit(event) {
  event.preventDefault();
  runSearch(false);
}

// quiet: when re-scanning after a fusion/undo/reset, don't nag with the
// "add at least two" error if the board is now too small — just clear results.
function runSearch(quiet) {
  const results = document.getElementById('sequence-results');
  const includeGlitch = document.getElementById('seq-include-glitch').checked;

  const cards = getPool();
  if (cards.length < 2) {
    results.innerHTML = quiet
      ? ''
      : `<p class="error-state">Add at least two valid monsters to search for fusion sequences.</p>`;
    return;
  }

  const { outcomes, truncated } = findAllSequences(cards, includeGlitch);
  renderSequenceResults(outcomes, cards, truncated);
}

/* ── Interactive apply-fusion ─────────────────────────────────────────────── */

function onResultsClick(e) {
  const btn = e.target.closest('[data-action="apply-fusion"]');
  if (!btn) return;
  const slots = btn.dataset.slots ? btn.dataset.slots.split(',').map(Number) : [];
  startPlacement(slots, btn.dataset.result, btn.dataset.name);
}

function startPlacement(slots, resultId, resultName) {
  closePicker();
  placement.active = true;
  placement.slots = slots;
  placement.resultId = resultId;
  placement.resultName = resultName;
  // Valid targets: empty slots, plus this fusion's material slots (freed on commit).
  const matSet = new Set(slots);
  slotStates.forEach((s) => {
    s.el.classList.toggle('place-target', s.cardId === null || matSet.has(s.index));
  });
  bannerEl.querySelector('.pb-text').textContent = `Placing ${resultName} — click a highlighted slot`;
  bannerEl.hidden = false;
}

function commitPlacement(dest) {
  const matSet = new Set(placement.slots);
  if (!(slotStates[dest].cardId === null || matSet.has(dest))) return; // not a valid target
  pushUndo();
  placement.slots.forEach((i) => { if (i !== dest) setSlotCard(i, null); }); // consume materials
  setSlotCard(dest, placement.resultId);                                     // drop the result
  endPlacement();
  runSearch(true); // re-scan so the new board's fusions show
}

function cancelPlacement() {
  endPlacement();
}

function endPlacement() {
  placement.active = false;
  placement.slots = [];
  placement.resultId = null;
  placement.resultName = '';
  slotStates.forEach((s) => s.el.classList.remove('place-target'));
  if (bannerEl) bannerEl.hidden = true;
}

function createPlacementBanner() {
  bannerEl = document.createElement('div');
  bannerEl.className = 'placement-banner';
  bannerEl.hidden = true;
  bannerEl.innerHTML = `<span class="pb-text"></span><button type="button" class="secondary pb-cancel">Cancel</button>`;
  const results = document.getElementById('sequence-results');
  results.parentNode.insertBefore(bannerEl, results);
  bannerEl.querySelector('.pb-cancel').addEventListener('click', cancelPlacement);
}

/* ── Undo / reset ─────────────────────────────────────────────────────────── */

function pushUndo() {
  undoStack.push(slotStates.map((s) => s.cardId));
  updateUndoButton();
}

function undo() {
  if (!undoStack.length) return;
  cancelPlacement();
  const snap = undoStack.pop();
  snap.forEach((cardId, i) => setSlotCard(i, cardId));
  updateUndoButton();
  runSearch(true);
}

function resetBoard() {
  cancelPlacement();
  if (getPool().length === 0) return; // nothing to reset
  pushUndo();
  slotStates.forEach((s) => setSlotCard(s.index, null));
  runSearch(true);
}

function updateUndoButton() {
  const btn = document.getElementById('seq-undo');
  if (btn) btn.disabled = undoStack.length === 0;
}

// Forbidden Memories only fuses two cards per action, so finding every
// "possible fusion monster" from a pool means trying every order in which
// pairs of cards (or already-fused results) could be combined. Each token
// tracks which of the original pool slots it was built from, so results can
// show exactly which cards get used and which are left over.
function findAllSequences(initialCards, includeGlitch) {
  const outcomesByKey = new Map();
  let exploredPairs = 0;
  let truncated = false;

  const initialTokens = initialCards.map((c, idx) => ({
    id: c.id,
    name: c.name,
    originIndices: [idx],
    steps: [],
  }));

  function explore(tokens) {
    for (let i = 0; i < tokens.length && !truncated; i++) {
      for (let j = i + 1; j < tokens.length && !truncated; j++) {
        exploredPairs++;
        if (exploredPairs > MAX_EXPLORED_PAIRS) {
          truncated = true;
          return;
        }

        const matches = findFusionMatches(tokens[i].id, tokens[j].id, includeGlitch);
        for (const m of matches) {
          const step = {
            aName: tokens[i].name,
            bName: tokens[j].name,
            resultName: m.resultName,
            isGlitch: m.isGlitch,
          };
          const usedSlotIndices = [...tokens[i].originIndices, ...tokens[j].originIndices].sort((a, b) => a - b);
          const steps = [...tokens[i].steps, ...tokens[j].steps, step];

          const key = `${m.resultId}|${usedSlotIndices.join(',')}`;
          const existing = outcomesByKey.get(key);
          if (!existing || steps.length < existing.steps.length) {
            outcomesByKey.set(key, {
              resultId: m.resultId,
              resultName: m.resultName,
              isGlitch: m.isGlitch,
              description: m.description,
              usedSlotIndices,
              steps,
            });
          }

          const newToken = { id: m.resultId, name: m.resultName, originIndices: usedSlotIndices, steps };
          const remaining = tokens.filter((_, idx) => idx !== i && idx !== j);
          explore([...remaining, newToken]);
        }
      }
    }
  }

  explore(initialTokens);
  return { outcomes: [...outcomesByKey.values()], truncated };
}

function renderSequenceResults(outcomes, cards, truncated) {
  const results = document.getElementById('sequence-results');
  results.innerHTML = '';

  if (outcomes.length === 0) {
    results.innerHTML = `<p class="empty-state">No fusions are possible with these cards.</p>`;
    return;
  }

  // Sequences that use more of your listed cards come first -- that's the
  // whole point: see which first move lets you use everything instead of
  // stranding a card you needed.
  const sorted = [...outcomes].sort((a, b) => {
    if (b.usedSlotIndices.length !== a.usedSlotIndices.length) {
      return b.usedSlotIndices.length - a.usedSlotIndices.length;
    }
    const atkA = Number(state.cardsById.get(a.resultId)?.atk) || 0;
    const atkB = Number(state.cardsById.get(b.resultId)?.atk) || 0;
    if (atkB !== atkA) return atkB - atkA;
    return a.resultName.localeCompare(b.resultName);
  });

  for (const outcome of sorted) {
    results.appendChild(createOutcomeCard(outcome, cards));
  }

  if (truncated) {
    const note = document.createElement('p');
    note.className = 'truncated-note';
    note.textContent = 'This pool produced a lot of combinations, so the search was capped -- results above may not be exhaustive.';
    results.appendChild(note);
  }
}

function createOutcomeCard(outcome, cards) {
  const article = document.createElement('article');
  article.className = 'result-card outcome-card';

  const card = state.cardsById.get(outcome.resultId);
  const statLine = card
    ? `${card.monsterType} · Lv ${card.level} · ATK ${card.atk} / DEF ${card.def}`
    : '';

  const usedSet = new Set(outcome.usedSlotIndices);
  const usedChips = outcome.usedSlotIndices
    .map((idx) => `<span class="chip">${escapeHtml(cards[idx].name)}</span>`)
    .join('');
  const leftoverChips = cards
    .filter((_, idx) => !usedSet.has(idx))
    .map((c) => `<span class="chip leftover">${escapeHtml(c.name)}</span>`)
    .join('');

  const stepsList = outcome.steps
    .map((s, i) => `
      <li>Step ${i + 1}: <strong>${escapeHtml(s.aName)}</strong> + <strong>${escapeHtml(s.bName)}</strong>
        &rarr; ${escapeHtml(s.resultName)}${s.isGlitch ? ' <span class="badge">Glitch</span>' : ''}</li>
    `)
    .join('');

  const imageData = state.cardImagesById.get(outcome.resultId);
  const imgHtml = imageData?.localPath
    ? `<img class="outcome-card-img" src="${escapeHtml(imageData.localPath)}" alt="${escapeHtml(outcome.resultName)}">`
    : '';

  // Real 0–9 slot indices for the consumed materials (usedSlotIndices are pool-
  // relative), so an "Apply" can clear the correct slots.
  const realSlots = outcome.usedSlotIndices.map((i) => cards[i].slotIndex).join(',');

  article.innerHTML = `
    ${imgHtml}
    <div class="outcome-card-body">
      <h3>${escapeHtml(outcome.resultName)}${outcome.isGlitch ? '<span class="badge">Glitch</span>' : ''}</h3>
      <p class="meta">${escapeHtml(statLine)}</p>
      <p>${escapeHtml(outcome.description)}</p>
      <p class="meta">Uses ${outcome.usedSlotIndices.length} of your ${cards.length} card${cards.length === 1 ? '' : 's'}:</p>
      <div class="chips">${usedChips}</div>
      ${leftoverChips ? `<p class="meta">Left over:</p><div class="chips">${leftoverChips}</div>` : ''}
      <ol class="steps">${stepsList}</ol>
      <button type="button" class="secondary apply-fusion-btn" data-action="apply-fusion"
        data-slots="${realSlots}" data-result="${escapeHtml(outcome.resultId)}" data-name="${escapeHtml(outcome.resultName)}">
        Fuse this &rarr; place ${escapeHtml(outcome.resultName)}
      </button>
    </div>
  `;

  return article;
}
