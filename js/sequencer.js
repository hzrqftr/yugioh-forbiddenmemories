const MAX_EXPLORED_PAIRS = 20000;

const slotStates = [];
let activeSlotIndex = -1;
let pickerEl = null;
let pickerSearchEl = null;
let pickerListEl = null;
let pickerActiveItemIndex = -1;

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
  initSlots();

  document.getElementById('pool-form').addEventListener('submit', onPoolSubmit);
  document.getElementById('seq-include-glitch').addEventListener('change', clearSequenceResults);
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
      <img class="slot-img" alt="" hidden>
      <button type="button" class="slot-clear-btn" aria-label="Clear card" hidden>&times;</button>
    `;

    container.appendChild(slotEl);
    slotStates.push({ index: slotIndex, zone, cardId: null, el: slotEl });

    slotEl.addEventListener('click', (e) => {
      if (e.target.closest('.slot-clear-btn')) return;
      openPicker(slotIndex);
    });

    slotEl.querySelector('.slot-clear-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      clearSlot(slotIndex);
    });
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

function selectCard(slotIndex, cardId) {
  if (slotIndex < 0 || slotIndex >= slotStates.length) return;
  const slot = slotStates[slotIndex];
  slot.cardId = cardId;

  const imgEl = slot.el.querySelector('.slot-img');
  const placeholderEl = slot.el.querySelector('.slot-placeholder');
  const clearBtnEl = slot.el.querySelector('.slot-clear-btn');

  const imageData = state.cardImagesById.get(cardId);
  if (imageData?.localPath) {
    imgEl.src = imageData.localPath;
    imgEl.alt = state.cardsById.get(cardId)?.name || '';
    imgEl.hidden = false;
    placeholderEl.hidden = true;
  } else {
    imgEl.hidden = true;
    placeholderEl.textContent = state.cardsById.get(cardId)?.name || cardId;
    placeholderEl.classList.add('filled-label');
    placeholderEl.hidden = false;
  }

  clearBtnEl.hidden = false;
  slot.el.classList.add('filled');
  closePicker();
  clearSequenceResults();
}

function clearSlot(slotIndex) {
  const slot = slotStates[slotIndex];
  slot.cardId = null;

  const imgEl = slot.el.querySelector('.slot-img');
  const placeholderEl = slot.el.querySelector('.slot-placeholder');
  const clearBtnEl = slot.el.querySelector('.slot-clear-btn');

  imgEl.hidden = true;
  imgEl.src = '';
  placeholderEl.textContent = '+';
  placeholderEl.classList.remove('filled-label');
  placeholderEl.hidden = false;
  clearBtnEl.hidden = true;
  slot.el.classList.remove('filled');
  clearSequenceResults();
}

function getPool() {
  return slotStates
    .filter((s) => s.cardId !== null)
    .map((s) => ({ id: s.cardId, name: state.cardsById.get(s.cardId).name }));
}

function clearSequenceResults() {
  document.getElementById('sequence-results').innerHTML = '';
}

function onPoolSubmit(event) {
  event.preventDefault();
  const results = document.getElementById('sequence-results');
  const includeGlitch = document.getElementById('seq-include-glitch').checked;

  const cards = getPool();
  if (cards.length < 2) {
    results.innerHTML = `<p class="error-state">Add at least two valid monsters to search for fusion sequences.</p>`;
    return;
  }

  const { outcomes, truncated } = findAllSequences(cards, includeGlitch);
  renderSequenceResults(outcomes, cards, truncated);
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
    </div>
  `;

  return article;
}
