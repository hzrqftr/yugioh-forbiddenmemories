// DeckAdvisor — a heuristic strategy helper for the Deck Builder. It scores
// monsters from data we actually have (ATK/DEF, the fusion table, and Guardian
// Stars) and decides whether an owned-but-unused ("trunk") card is a good ADD or
// a better REPLACEMENT for a weak deck card — so the 40-card deck improves without
// bloating. Not an optimal solver: we have no card-effect text or fusion-AI model,
// so non-monsters are left for manual judgement.
const DeckAdvisor = (() => {
  const DECK_SIZE = 40;

  // Scoring weights (ATK-equivalent units) — tunable.
  const DEF_WEIGHT = 0.25;      // DEF matters, but less than ATK (no tribute summon in FM)
  const FUSION_WEIGHT = 0.5;    // fusion upside is potential, not guaranteed
  const PARTNER_BONUS = 20;     // per deck fusion partner (flexibility)
  const PARTNER_CAP = 5;
  const COVERAGE_BONUS = 60;    // per NEW Guardian-Star matchup this card gives the deck
  const REPLACE_MARGIN = 40;    // min score edge to bother suggesting a swap

  // Guardian-Star wheel: beats[X] = the star X defeats (+500 in battle).
  // Group 1 (4-cycle): Sun→Moon→Venus→Mercury→Sun.
  // Group 2 (6-cycle): Mars→Jupiter→Saturn→Uranus→Pluto→Neptune→Mars.
  const BEATS = {
    Sun: 'Moon', Moon: 'Venus', Venus: 'Mercury', Mercury: 'Sun',
    Mars: 'Jupiter', Jupiter: 'Saturn', Saturn: 'Uranus',
    Uranus: 'Pluto', Pluto: 'Neptune', Neptune: 'Mars',
  };
  const starBeats = (s) => BEATS[s] || null;

  // cardId -> [{ resultId, partners:Set<id> }] for every non-glitch fusion X is in.
  let index = new Map();

  const card = (id) => state.cardsById.get(id);
  const num = (v) => { const n = parseInt(v, 10); return Number.isNaN(n) ? 0 : n; };
  const isMonster = (c) => !!c && c.cardType === 'Monster';

  function buildIndex() {
    index = new Map();
    const add = (a, resultId, partners) => {
      if (!index.has(a)) index.set(a, []);
      index.get(a).push({ resultId, partners });
    };
    for (const r of state.fusionResults) {
      if (r.isGlitch) continue;
      // Drop the result from its own material/partner lists: the FM table has
      // entries like "X + Y -> X" (and type-based recipes whose partner group
      // includes the result), which would otherwise read as "fuse X to get X".
      const without = (set) => { const s = new Set(set); s.delete(r.resultId); return s; };
      for (const rule of r.rules) {
        const m1 = without(new Set(rule.material1));
        const m2 = without(new Set(rule.material2));
        rule.material1.forEach((a) => { if (a !== r.resultId) add(a, r.resultId, m2); });
        rule.material2.forEach((b) => { if (b !== r.resultId) add(b, r.resultId, m1); });
      }
    }
  }

  // Best fusion this card can make using a card already in `deckSet` (excluding
  // itself unless the deck genuinely holds another copy). Returns the strongest
  // ATK "upside" (result ATK over the better material), partner count, and the
  // headline result/partner for display.
  function deckFusion(id, deckSet) {
    const entries = index.get(id) || [];
    const atkX = num(card(id) && card(id).atk);
    const partners = new Set();
    let best = { upside: 0, resultId: null, resultATK: 0, partnerId: null };
    for (const e of entries) {
      let localPartner = null, localAtk = Infinity;
      for (const p of e.partners) {
        if (!deckSet.has(p)) continue;
        partners.add(p);
        const pa = num(card(p) && card(p).atk);
        if (pa < localAtk) { localAtk = pa; localPartner = p; }
      }
      if (localPartner === null) continue;
      const resATK = num(card(e.resultId) && card(e.resultId).atk);
      const upside = resATK - Math.max(atkX, localAtk);
      if (resATK > best.resultATK) best = { ...best, resultId: e.resultId, resultATK: resATK, partnerId: localPartner };
      if (upside > best.upside) best.upside = upside;
    }
    return { partnerCount: partners.size, ...best };
  }

  // Stars a set of monster ids can already beat (their guardian stars' targets).
  function coveredStars(ids) {
    const covered = new Set();
    for (const id of ids) {
      const c = card(id);
      if (!isMonster(c)) continue;
      [starBeats(c.gsA), starBeats(c.gsB)].forEach((s) => { if (s) covered.add(s); });
    }
    return covered;
  }

  // New matchups this card's stars would add to an already-covered set.
  function newCoverage(c, covered) {
    const gained = new Set();
    [starBeats(c && c.gsA), starBeats(c && c.gsB)].forEach((s) => {
      if (s && !covered.has(s)) gained.add(s);
    });
    return gained;
  }

  // Balanced score for a monster vs a deck (set of ids) with a precomputed
  // coverage set for that deck. Returns the score plus the pieces used for reasons.
  function scoreMonster(id, deckSet, covered) {
    const c = card(id);
    const atk = num(c.atk);
    const combat = atk + DEF_WEIGHT * num(c.def);
    const fus = deckFusion(id, deckSet);
    const gained = newCoverage(c, covered);
    const score = combat
      + FUSION_WEIGHT * fus.upside
      + PARTNER_BONUS * Math.min(fus.partnerCount, PARTNER_CAP)
      + COVERAGE_BONUS * gained.size;
    return { score, atk, fusion: fus, gained };
  }

  const percentile = (sortedAsc, p) => {
    if (!sortedAsc.length) return -Infinity;
    const i = Math.floor((p / 100) * (sortedAsc.length - 1));
    return sortedAsc[i];
  };

  function reasonFor(detail, targetCard) {
    const bits = [];
    if (targetCard) {
      const d = detail.atk - num(targetCard.atk);
      bits.push(`beats your weakest (#${targetCard.id} ${targetCard.name})${d > 0 ? ` · +${d} ATK` : ''}`);
    }
    if (detail.gained.size) {
      bits.push(`fills a Guardian-Star gap (beats ${[...detail.gained].join(', ')})`);
    }
    if (detail.fusion.upside > 0 && detail.fusion.resultId) {
      const res = card(detail.fusion.resultId);
      const partner = card(detail.fusion.partnerId);
      if (res && partner) bits.push(`unlocks ${res.name} (${num(res.atk)} ATK) with ${partner.name}`);
    }
    if (!bits.length) bits.push(`${detail.atk} ATK body`);
    return bits.slice(0, 2).join(' · ');
  }

  // Main entry. deck = active deck object { cards:{id:count} } (or null).
  function analyze(deck, collection) {
    const adviceById = new Map();
    const suggestions = [];
    const counts = { adds: 0, swaps: 0 };
    if (!deck) return { adviceById, suggestions, counts };

    const deckCards = deck.cards || {};
    const deckIds = Object.keys(deckCards);
    const deckSet = new Set(deckIds);
    const deckTotal = Object.values(deckCards).reduce((a, b) => a + b, 0);
    const slotsFree = DECK_SIZE - deckTotal;

    // Rank deck monsters (weakest first). Each scored against the OTHER deck cards.
    const deckMonsterIds = deckIds.filter((id) => isMonster(card(id)));
    const deckCovered = coveredStars(deckIds);
    const ranked = deckMonsterIds
      .map((id) => {
        const others = new Set(deckIds.filter((x) => x !== id));
        const covOthers = coveredStars([...others]);
        return { id, score: scoreMonster(id, others, covOthers).score };
      })
      .sort((a, b) => a.score - b.score);
    const scoresAsc = ranked.map((r) => r.score);
    const p25 = percentile(scoresAsc, 25);
    const p60 = percentile(scoresAsc, 60);
    const weakest = ranked[0] || null;

    // Evaluate trunk cards (owned, not in deck).
    for (const [id, qty] of Object.entries(collection || {})) {
      if (qty <= 0 || deckSet.has(id)) continue;
      const c = card(id);
      if (!c) continue;
      if (!isMonster(c)) {
        adviceById.set(id, { category: 'utility', label: 'utility', reason: 'utility card — judge manually' });
        continue;
      }
      const detail = scoreMonster(id, deckSet, deckCovered);
      let category, label, targetId = null;

      if (slotsFree > 0) {
        if (detail.score >= p60) { category = 'strong'; label = '⭐ Strong add'; }
        else if (detail.score >= p25 || detail.fusion.upside > 0 || detail.gained.size) { category = 'situational'; label = '➕ Situational'; }
        else { category = 'low'; label = '➖ Low priority'; }
      } else if (weakest && detail.score > weakest.score + REPLACE_MARGIN) {
        category = 'replace'; label = '🔁 Replace'; targetId = weakest.id;
      } else {
        category = 'skip'; label = '➖ Skip';
      }

      const reason = reasonFor(detail, targetId ? card(targetId) : null);
      const entry = { category, label, reason, targetId, score: detail.score, name: c.name, id };
      adviceById.set(id, entry);

      if (category === 'strong' || category === 'situational') counts.adds++;
      if (category === 'replace') counts.swaps++;
      if (['strong', 'situational', 'replace'].includes(category)) suggestions.push(entry);
    }

    suggestions.sort((a, b) => b.score - a.score);
    return { adviceById, suggestions, counts, weakestDeckId: weakest ? weakest.id : null };
  }

  // Deck fusion synergy for a single card (used by the hover popover); works for
  // any monster, in-deck or not, excluding the card itself.
  function fusionSummary(id, deck) {
    const deckSet = new Set(Object.keys((deck && deck.cards) || {}));
    deckSet.delete(id);
    return deckFusion(id, deckSet);
  }

  return { buildIndex, analyze, fusionSummary, starBeats };
})();
