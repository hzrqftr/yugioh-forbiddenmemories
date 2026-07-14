# Forbidden Memories fusion dataset

All data files live under `data/`. `data/forbidden_memories_cards.csv` is the local card catalogue. Card numbers are zero-padded strings such as "002".

`data/fusion_rules_manifest.json` lists the local JSON parts (also under `data/`) that contain the normalized fusion data. Load every listed part and concatenate the arrays.

Each result has this shape:

~~~
{
  "resultId": "002",
  "resultName": "Mystical Elf",
  "description": "\"Elf\" + Fairy",
  "isGlitch": false,
  "rules": [
    {
      "material1": ["264", "395"],
      "material2": ["130", "134"]
    }
  ]
}
~~~

A rule matches when one selected material ID belongs to material1 and the other belongs to material2. Preserve the two lists as separate groups; do not pair items merely by their array positions.

The source labels some entries as glitch fusions. They are retained with isGlitch: true so the portal can exclude them by default and offer an optional toggle.

Source: Yugipedia's [Forbidden Memories fusion index](https://yugipedia.com/wiki/List_of_Yu-Gi-Oh!_Forbidden_Memories_Fusions). Retain source attribution and comply with the source site's license when publishing.

## Card images

`data/card_images.json` maps each card to a local image under `images/`. Files are named by zero-padded card number (e.g. `images/001.webp`). Each entry:

~~~
{
  "number": "001",
  "name": "Blue-eyes White Dragon",
  "source": "fm-game-art",
  "sourceUrl": "https://static.wikia.nocookie.net/yugioh/images/.../BlueeyesWhiteDragon-FMR-EN-VG.png/...",
  "localPath": "images/001.webp"
}
~~~

`source` values:
- `fm-game-art` (616 cards) — authentic Forbidden Memories in-game artwork (`*-FMR-EN-VG`).
- `tcg-print` (104 cards) — no FM art on the wiki; a TCG/other print is used as a fallback, so the art differs from the game.
- `null` (2 cards: #206 Twin Long Rods #1, #557 Steel Ogre Grotto #1) — no image available on the wiki; `localPath` is `null`. Show a placeholder.

Images were scraped from the [Yugipedia/Fandom Yu-Gi-Oh! wiki](https://yugioh.fandom.com/wiki/List_of_Yu-Gi-Oh!_Forbidden_Memories_cards) via its MediaWiki API and are served as WebP. Card artwork is © Konami; retain attribution and comply with the source site's license when publishing.
