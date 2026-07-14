// Fusion Finder — "The Fusion Bench".
//
// Forbidden Memories only ever fuses two cards per action, and a fused monster
// can itself become material for the next fusion. So the page is a stack of
// two-card equations (A + B → C) that grows into a linear numbered chain: each
// result can be "fused further", which pins it as the first material of the
// next step. The chain models exactly the play sequence you'd execute in-game.

// steps[i] = { matA: id|null, matB: id|null, results: [matchResult] }
// step 0's matA is user-picked; steps >0 have matA pinned to the previous
// step's chosen result. Only the last step is interactive.
let steps = [];

// Index of the step whose result just resolved — gets the one-shot reveal
// animation on the next render, then cleared so re-renders don't replay it.
let pendingReveal = null;

init();

async function init() {
  const chain = document.getElementById('fusion-chain');
  try {
    await loadCoreData();
  } catch (err) {
    chain.innerHTML = `<p class="error-state">Failed to load card data: ${escapeHtml(err.message)}</p>`;
    return;
  }

  document.getElementById('include-glitch').addEventListener('change', () => {
    // Changing the glitch filter can invalidate a link mid-chain; re-resolve
    // from the top and prune anything downstream that no longer holds.
    revalidateChain();
    render();
  });

  document.getElementById('reset-chain').addEventListener('click', () => {
    closeCardPicker();
    steps = [newStep(null)];
    render();
  });

  chain.addEventListener('click', onChainClick);
  chain.addEventListener('keydown', onChainKeydown);

  steps = [newStep(null)];
  render();
}

function newStep(matA) {
  return { matA: matA || null, matB: null, results: [] };
}

function glitchOn() {
  return document.getElementById('include-glitch').checked;
}

function resolveStep(step) {
  step.results = (step.matA && step.matB)
    ? findFusionMatches(step.matA, step.matB, glitchOn())
    : [];
}

function revalidateChain() {
  for (let i = 0; i < steps.length; i++) {
    resolveStep(steps[i]);
    const next = steps[i + 1];
    if (next && !steps[i].results.some((r) => r.resultId === next.matA)) {
      steps.length = i + 1; // prune the now-broken continuation
      break;
    }
  }
}

/* ── Interaction ─────────────────────────────────────────────────────────── */

function onChainClick(e) {
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    const action = actionEl.dataset.action;
    const stepIndex = Number(actionEl.dataset.step);
    if (action === 'clear') return clearSlot(stepIndex, actionEl.dataset.role);
    if (action === 'remove') return removeStep(stepIndex);
    if (action === 'fuse-further') return fuseFurther(stepIndex, actionEl.dataset.result);
    return;
  }

  const slot = e.target.closest('.mat-slot.editable');
  if (slot) openSlotPicker(slot);
}

function onChainKeydown(e) {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const slot = e.target.closest('.mat-slot.editable');
  if (!slot) return;
  e.preventDefault();
  openSlotPicker(slot);
}

function openSlotPicker(slot) {
  const role = slot.dataset.role;
  const stepIndex = Number(slot.dataset.step);
  const step = steps[stepIndex];

  const options = role === 'matA'
    ? state.monsterOptions
    : getPartnerCandidates(step.matA, glitchOn());

  openCardPicker(slot, {
    options,
    onSelect: (id) => {
      if (role === 'matA') {
        // Editing the root material restarts the chain from this card.
        steps = [newStep(id)];
      } else {
        step.matB = id;
        resolveStep(step);
        pendingReveal = stepIndex;
      }
      render();
    },
  });
}

function clearSlot(stepIndex, role) {
  const step = steps[stepIndex];
  if (role === 'matA') {
    steps = [newStep(null)]; // clearing the root empties the whole bench
  } else {
    step.matB = null;
    step.results = [];
  }
  render();
}

function removeStep(index) {
  steps.length = index; // drop this step and everything chained after it
  render();
}

function fuseFurther(stepIndex, resultId) {
  // Pin the chosen result as the next step's first material and continue.
  steps.length = stepIndex + 1;
  steps.push(newStep(resultId));
  render();
}

/* ── Rendering ───────────────────────────────────────────────────────────── */

function render() {
  const chain = document.getElementById('fusion-chain');
  chain.innerHTML = steps.map((step, i) => renderStep(step, i)).join('');
  pendingReveal = null;
}

function renderStep(step, i) {
  const isLast = i === steps.length - 1;
  const marker = String(i + 1).padStart(2, '0');
  const removeBtn = i >= 1
    ? `<button type="button" class="step-remove" data-action="remove" data-step="${i}" aria-label="Remove step ${marker} and everything after it">&times;</button>`
    : '';

  const matAEditable = isLast && i === 0;
  const matBEditable = isLast && !!step.matA;

  const equation = `
    <div class="fusion-equation">
      ${matSlotHtml(step.matA, 'matA', i, matAEditable, false)}
      <span class="fusion-op">+</span>
      ${matSlotHtml(step.matB, 'matB', i, matBEditable, !step.matA)}
      <span class="fusion-op arrow">&rarr;</span>
      <div class="result-cell">${resultCellHtml(step, i, isLast)}</div>
    </div>`;

  return `
    <section class="fusion-step">
      <div class="step-head">
        <span class="step-marker">step ${marker}</span>
        ${removeBtn}
      </div>
      ${equation}
      ${stepHintHtml(step, i, isLast)}
    </section>`;
}

function matSlotHtml(cardId, role, stepIndex, editable, awaiting) {
  const card = cardId ? state.cardsById.get(cardId) : null;
  const img = cardId ? state.cardImagesById.get(cardId) : null;

  let inner;
  if (!cardId) {
    inner = `<div class="slot-placeholder">+</div>`;
  } else if (img && img.localPath) {
    inner = `<img class="slot-img" src="${escapeHtml(img.localPath)}" alt="${escapeHtml(card ? card.name : '')}">`;
  } else {
    inner = `<div class="slot-placeholder filled-label">${escapeHtml(card ? card.name : cardId)}</div>`;
  }

  const classes = ['card-slot', 'mat-slot'];
  if (cardId) classes.push('filled');
  classes.push(editable ? 'editable' : 'locked');
  if (awaiting) classes.push('awaiting');

  const attrs = editable
    ? `role="button" tabindex="0" aria-label="${cardId ? 'Change' : 'Choose'} card"`
    : '';
  const clearBtn = editable && cardId
    ? `<button type="button" class="slot-clear-btn" data-action="clear" data-role="${role}" data-step="${stepIndex}" aria-label="Clear card">&times;</button>`
    : '';

  return `<div class="${classes.join(' ')}" data-role="${role}" data-step="${stepIndex}" ${attrs}>${inner}${clearBtn}</div>`;
}

function resultCellHtml(step, stepIndex, isLast) {
  if (!step.matA || !step.matB) {
    return `<div class="card-slot result-tile result-empty"><div class="slot-placeholder">?</div></div>`;
  }
  if (step.results.length === 0) {
    return `
      <div class="result-block">
        <div class="card-slot result-tile result-nofusion"><div class="slot-placeholder filled-label">&mdash;</div></div>
        <div class="result-caption"><p class="no-fusion-msg">No fusion — these two don't combine.</p></div>
      </div>`;
  }
  return step.results.map((r) => resultBlockHtml(r, stepIndex, isLast)).join('');
}

function resultBlockHtml(result, stepIndex, isLast) {
  const card = state.cardsById.get(result.resultId);
  const img = state.cardImagesById.get(result.resultId);
  const statLine = card
    ? `${escapeHtml(card.monsterType)} · Lv ${escapeHtml(card.level)} · ATK ${escapeHtml(card.atk)} / DEF ${escapeHtml(card.def)}`
    : '';

  const imgInner = img && img.localPath
    ? `<img class="slot-img" src="${escapeHtml(img.localPath)}" alt="${escapeHtml(result.resultName)}">`
    : `<div class="slot-placeholder filled-label">${escapeHtml(result.resultName)}</div>`;
  const revealClass = pendingReveal === stepIndex ? ' reveal' : '';

  const continued = steps[stepIndex + 1] && steps[stepIndex + 1].matA === result.resultId;
  let action = '';
  if (isLast) {
    action = `<button type="button" class="secondary fuse-further" data-action="fuse-further" data-step="${stepIndex}" data-result="${escapeHtml(result.resultId)}">+ Fuse this result further</button>`;
  } else if (continued) {
    action = `<p class="continued-label">↓ fused forward in step ${String(stepIndex + 2).padStart(2, '0')}</p>`;
  }

  return `
    <div class="result-block">
      <div class="card-slot result-tile filled${revealClass}">${imgInner}</div>
      <div class="result-caption">
        <h3>${escapeHtml(result.resultName)}${result.isGlitch ? '<span class="badge">Glitch</span>' : ''}</h3>
        <p class="meta">${statLine}</p>
        <p class="desc">${escapeHtml(result.description)}</p>
        ${action}
      </div>
    </div>`;
}

function stepHintHtml(step, i, isLast) {
  let hint = '';
  if (i === 0 && !step.matA) {
    hint = 'Pick a monster to begin.';
  } else if (isLast && step.matA && !step.matB) {
    const n = getPartnerCandidates(step.matA, glitchOn()).length;
    hint = n
      ? `${n} possible partner${n === 1 ? '' : 's'} — pick the second card.`
      : 'No known fusion partners for this card.';
  }
  return hint ? `<p class="step-hint">${escapeHtml(hint)}</p>` : '';
}
