init();

async function init() {
  const results = document.getElementById('results');
  try {
    await loadCoreData();
  } catch (err) {
    results.innerHTML = `<p class="error-state">Failed to load card data: ${escapeHtml(err.message)}</p>`;
    return;
  }

  document.getElementById('fusion-form').addEventListener('submit', onSubmit);
  document.getElementById('include-glitch').addEventListener('change', onMaterial1Change);

  setupCombobox({
    input: document.getElementById('material1'),
    listEl: document.getElementById('material1-listbox'),
    toggleBtn: document.getElementById('toggle-material1'),
    clearBtn: document.getElementById('clear-material1'),
    getOptions: (query) => filterOptions(state.monsterOptions, query),
    onChange: onMaterial1Change,
    onClear: onMaterial1Change,
  });

  setupCombobox({
    input: document.getElementById('material2'),
    listEl: document.getElementById('material2-listbox'),
    toggleBtn: document.getElementById('toggle-material2'),
    clearBtn: document.getElementById('clear-material2'),
    getOptions: (query) => filterOptions(getMaterial2Candidates(), query),
    onChange: clearResults,
    onClear: clearResults,
  });

  refreshMaterial2Hint();
}

function clearResults() {
  document.getElementById('results').innerHTML = '';
}

function getMaterial2Candidates() {
  const includeGlitch = document.getElementById('include-glitch').checked;
  const id1 = resolveMaterialId(document.getElementById('material1').value);
  if (!id1) return state.monsterOptions;
  return getPartnerCandidates(id1, includeGlitch);
}

function onMaterial1Change() {
  const id1 = resolveMaterialId(document.getElementById('material1').value);
  document.getElementById('material2').value = '';
  clearResults();
  setMaterial2Locked(!id1);
  refreshMaterial2Hint();
}

function setMaterial2Locked(locked) {
  document.getElementById('material2').disabled = locked;
  document.getElementById('toggle-material2').disabled = locked;
  document.getElementById('clear-material2').disabled = locked;
  document.getElementById('material2').placeholder = locked
    ? 'Select Material 1 first...'
    : 'Start typing a monster name...';
}

function refreshMaterial2Hint() {
  const hint = document.getElementById('material2-hint');
  const id1 = resolveMaterialId(document.getElementById('material1').value);
  if (!id1) {
    hint.textContent = '';
    return;
  }
  const count = getMaterial2Candidates().length;
  hint.textContent = count
    ? `${count} possible partner${count === 1 ? '' : 's'} for this card.`
    : 'No known fusion partners for this card.';
}

function onSubmit(event) {
  event.preventDefault();
  const results = document.getElementById('results');
  const includeGlitch = document.getElementById('include-glitch').checked;

  const raw1 = document.getElementById('material1').value;
  const raw2 = document.getElementById('material2').value;
  const id1 = resolveMaterialId(raw1);
  const id2 = resolveMaterialId(raw2);

  if (!id1 || !id2) {
    results.innerHTML = `<p class="error-state">Pick two valid monsters from the suggestions list.</p>`;
    return;
  }

  const matches = findFusionMatches(id1, id2, includeGlitch);
  renderResults(matches);
}

function renderResults(matches) {
  const results = document.getElementById('results');
  results.innerHTML = '';
  if (matches.length === 0) {
    results.innerHTML = `<p class="empty-state">No fusion result found for that combination.</p>`;
    return;
  }
  for (const match of matches) {
    results.appendChild(createResultCard(match));
  }
}

let extendComboUid = 0;

// Builds a result card that also offers to fuse this result with a further
// card. Forbidden Memories only ever fuses two cards per action, so reaching
// a "3-card" (or deeper) result is really just repeating this same 2-card
// step again on whatever came out of the last one.
function createResultCard(matchResult) {
  const article = document.createElement('article');
  article.className = 'result-card';

  const card = state.cardsById.get(matchResult.resultId);
  const statLine = card
    ? `${card.monsterType} · Lv ${card.level} · ATK ${card.atk} / DEF ${card.def}`
    : '';
  const uid = `extend-combo-${extendComboUid++}`;

  article.innerHTML = `
    <h3>${escapeHtml(matchResult.resultName)}${matchResult.isGlitch ? '<span class="badge">Glitch</span>' : ''}</h3>
    <p class="meta">${escapeHtml(statLine)}</p>
    <p>${escapeHtml(matchResult.description)}</p>
    <div class="extend-fusion">
      <label for="${uid}">Fuse ${escapeHtml(matchResult.resultName)} with another card</label>
      <div class="combo">
        <div class="input-with-clear">
          <input type="text" id="${uid}" placeholder="Start typing a monster name..." autocomplete="off"
                 role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="${uid}-listbox">
          <button type="button" class="icon-btn arrow-btn" aria-label="Show all fusion partner options">&#9662;</button>
          <button type="button" class="icon-btn clear-btn" aria-label="Clear selection">&times;</button>
        </div>
        <ul class="combo-list" id="${uid}-listbox" role="listbox" hidden></ul>
      </div>
      <p class="hint"></p>
    </div>
    <div class="extend-result"></div>
  `;

  const extendWrap = article.querySelector('.extend-fusion');
  const input = extendWrap.querySelector('input');
  const listEl = extendWrap.querySelector('.combo-list');
  const [toggleBtn, clearBtn] = extendWrap.querySelectorAll('.icon-btn');
  const hint = extendWrap.querySelector('.hint');
  const extendResultEl = article.querySelector('.extend-result');

  function refreshHint() {
    const includeGlitch = document.getElementById('include-glitch').checked;
    const count = getPartnerCandidates(matchResult.resultId, includeGlitch).length;
    hint.textContent = count
      ? `${count} possible partner${count === 1 ? '' : 's'} for this card.`
      : 'No known fusion partners for this card.';
  }
  refreshHint();

  function handleChange() {
    extendResultEl.innerHTML = '';
    const includeGlitch = document.getElementById('include-glitch').checked;
    const thirdId = resolveMaterialId(input.value);
    if (!thirdId) return;

    const furtherMatches = findFusionMatches(matchResult.resultId, thirdId, includeGlitch);
    if (furtherMatches.length === 0) {
      extendResultEl.innerHTML = `<p class="empty-state">No further fusion found for that combination.</p>`;
      return;
    }
    for (const further of furtherMatches) {
      extendResultEl.appendChild(createResultCard(further));
    }
  }

  setupCombobox({
    input,
    listEl,
    toggleBtn,
    clearBtn,
    getOptions: (query) => {
      const includeGlitch = document.getElementById('include-glitch').checked;
      return filterOptions(getPartnerCandidates(matchResult.resultId, includeGlitch), query);
    },
    onChange: handleChange,
    onClear: () => { extendResultEl.innerHTML = ''; },
  });

  return article;
}
