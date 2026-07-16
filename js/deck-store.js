// Deck Builder persistence — collection + decks over localStorage, with
// export/import and optional GitHub Gist cross-device sync. No DOM here;
// the UI (deck-builder.js) subscribes via onChange() and re-renders.
const DeckStore = (() => {
  const KEYS = {
    collection: 'fm-collection',
    decks: 'fm-decks',
    activeDeck: 'fm-active-deck',
    syncMeta: 'fm-sync-meta',
  };
  const MAX_COPIES = 3; // FM: up to 3 of any card, in the deck or owned

  const listeners = [];
  const onChange = (fn) => listeners.push(fn);
  const emit = () => listeners.forEach((fn) => fn());

  const read = (key, fallback) => {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); }
    catch { return fallback; }
  };
  const write = (key, val) => localStorage.setItem(key, JSON.stringify(val));
  const clamp = (n) => Math.max(0, Math.min(MAX_COPIES, n | 0));
  const uid = () => 'deck-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /* ── Collection: { cardId: qty } ─────────────────────────────────────── */
  const getCollection = () => read(KEYS.collection, {});
  const getOwned = (cardId) => getCollection()[cardId] || 0;
  function setOwned(cardId, qty) {
    const c = getCollection();
    qty = clamp(qty);
    if (qty === 0) delete c[cardId]; else c[cardId] = qty;
    write(KEYS.collection, c);
    emit();
  }
  const ownedCount = () => Object.keys(getCollection()).length;

  /* ── Decks: [ { id, name, cards:{cardId:count}, updatedAt } ] ─────────── */
  const getDecks = () => read(KEYS.decks, []);
  const saveDecks = (d) => { write(KEYS.decks, d); emit(); };
  const getActiveDeckId = () => read(KEYS.activeDeck, null);
  const setActiveDeckId = (id) => { write(KEYS.activeDeck, id); emit(); };
  const getActiveDeck = () => getDecks().find((d) => d.id === getActiveDeckId()) || null;

  function createDeck(name) {
    const decks = getDecks();
    const deck = { id: uid(), name: name || ('Deck ' + (decks.length + 1)), cards: {}, updatedAt: Date.now() };
    decks.push(deck);
    write(KEYS.decks, decks);
    write(KEYS.activeDeck, deck.id);
    emit();
    return deck;
  }
  function renameDeck(id, name) {
    const decks = getDecks();
    const t = decks.find((d) => d.id === id);
    if (!t) return;
    t.name = name; t.updatedAt = Date.now();
    saveDecks(decks);
  }
  function deleteDeck(id) {
    const decks = getDecks().filter((d) => d.id !== id);
    write(KEYS.decks, decks);
    if (getActiveDeckId() === id) write(KEYS.activeDeck, decks[0] ? decks[0].id : null);
    emit();
  }
  function setDeckCard(deckId, cardId, count) {
    const decks = getDecks();
    const t = decks.find((d) => d.id === deckId);
    if (!t) return;
    count = clamp(count);
    if (count === 0) delete t.cards[cardId]; else t.cards[cardId] = count;
    t.updatedAt = Date.now();
    saveDecks(decks);
  }
  const deckTotal = (deck) => Object.values(deck.cards).reduce((a, b) => a + b, 0);

  function ensureDeck() {
    if (getDecks().length === 0) createDeck('Deck 1');
    else if (!getActiveDeck()) setActiveDeckId(getDecks()[0].id);
  }

  /* ── Export / Import ─────────────────────────────────────────────────── */
  const exportData = () => JSON.stringify(
    { collection: getCollection(), decks: getDecks(), exportedAt: new Date().toISOString() }, null, 2);

  function importData(obj) {
    if (!obj || typeof obj !== 'object') throw new Error('Invalid file');
    if (obj.collection && typeof obj.collection === 'object') write(KEYS.collection, obj.collection);
    if (Array.isArray(obj.decks)) write(KEYS.decks, obj.decks);
    ensureDeck();
    emit();
  }

  /* ── Sync helpers (transport lives in drive-sync.js) ─────────────────── */
  // The blob synced to Drive; importData() consumes the same shape on pull.
  const getSyncBlob = () => ({ collection: getCollection(), decks: getDecks(), updatedAt: Date.now() });
  const getSyncMeta = () => read(KEYS.syncMeta, {});
  function setSyncMeta(patch) { write(KEYS.syncMeta, { ...getSyncMeta(), ...patch }); emit(); }

  return {
    MAX_COPIES, onChange,
    getCollection, getOwned, setOwned, ownedCount,
    getDecks, getActiveDeckId, setActiveDeckId, getActiveDeck,
    createDeck, renameDeck, deleteDeck, setDeckCard, deckTotal, ensureDeck,
    exportData, importData,
    getSyncBlob, getSyncMeta, setSyncMeta,
  };
})();
