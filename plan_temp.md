## Sequence Planner implementation plan (temp)

### Goal
Add a hand-only spell placeholder to the Sequence Planner while preserving the existing hand-slot compaction behavior.

### Changes
1. Define a spell placeholder identifier and label in `js/sequencer.js`.
2. Render the placeholder as a selectable option only in hand slots.
3. Display the placeholder like a filled hand card, but treat it as non-material in fusion search logic.
4. Keep the hand compaction behavior intact after fusions and hand-slot clears.

### Details
- `SPELL_PLACEHOLDER_ID = 'SPELL_PLACEHOLDER'`
- `SPELL_PLACEHOLDER_NAME = 'Spell card placeholder'`
- `getCardLabel(cardId)` should return the placeholder label when the placeholder ID is present.
- `isSpellPlaceholder(cardId)` should identify the placeholder separately from real cards.
- `isSearchCard(cardId)` should exclude the placeholder from `getPool()` so it is not considered a fusion material.
- `renderPickerList()` should add the placeholder option only for slots in the hand zone.
- `compactHandSlots()` should continue to shift remaining hand cards left after any hand-slot clear or fusion placement.

### Verification
- Confirm the spell placeholder can be selected into a hand slot.
- Confirm the placeholder counts as a visible hand slot but is excluded from the fusion pool.
- Confirm the placeholder shifts left when earlier hand slots are emptied by a fusion or clear.
- Confirm normal card search still works in the slot picker.
- Confirm there are no console errors in the Sequence Planner.
