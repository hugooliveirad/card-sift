# Card Sift

Sort a Magic: The Gathering collection into **Keep**, **Bulk**, and **Needs review**, with a reason for every copy.

**Live:** https://hugobessa.com.br/card-sift/

Inspired by [Jumpstart Atlas](https://hugobessa.com.br/jumpstart-atlas/). A separate, static app with no account, backend, or build dependencies. Your collection stays in your browser.

## Use it

1. Import a CSV, TSV, text decklist, Card Sift backup, or Jumpstart Atlas JSON backup. Review column mappings and excluded rows before applying it. Replace a full collection or add new copies. The previous inventory can be restored with Undo last import until you leave the page.
2. Choose formats and whether you want tournament evidence (default) or any legal card. Set a minimum deck share, a playset target, separate reserves per land printing, J25 deck membership, protected rarities, and a USD/EUR price floor.
3. Review the table or image grid. Search names or use advanced query syntax; include/exclude card types, search owned sets, and filter by recommendation, color, or rarity. Sort by tournament play, name, price, quantity, bulk, or review.
4. Open a card for all reasons, current legalities, source links, and a manual keep/bulk override. Previous/Next and arrow keys follow the filtered, sorted collection across pages; Back or Escape from editing restores the card and scroll position. Correct a card identifier or quantity if needed.
5. Export a CSV sorting plan for your current view or the entire collection. Export a JSON backup to preserve your inventory, rules, and decisions.

Try the example collection without replacing your own inventory. The example uses real Scryfall printings and is clearly labeled.

## How decisions work

- Manual Keep/Bulk overrides take priority for that printing.
- Matching **rarity or price protects every copy** of that printing and finish.
- Nonland playsets are shared across printings using Oracle identity (normalized English name before resolution). Copies protected by other rules count toward that reserve. Default: four copies of cards with evidence in Pauper, Modern, or Premodern, plus rare/mythic printings and copies worth at least USD 2.
- Lands count only copies of the same exact printing: Scryfall ID or set code + collector number. Nonfoil and foil copies of that printing share a reserve; different arts/collector numbers and sets do not. Nonbasic land playsets default to four per printing, with a separate basic land reserve of 20 per printing. Name-only lands cannot be assigned to a printing reserve and need review.
- The optional **Foundations Jumpstart (J25) decks** rule qualifies card names for the playset reserve even when your copies were printed in another set. It combines with the format rules using “or”; protected-copy counts and land printing rules still apply. Choosing “No playset reserve” also disables reserves for J25 nonbasic cards.
- Least expensive copies satisfy playsets first; optionally prefer nonfoil copies.
- Remaining copies go to Bulk only when the enabled rules have sufficient data. Unknown cards, conflicting names and printing identifiers, missing prices, uncertain printings, missing format evidence, or stale data go to Needs review. A row can be split among piles; owned always equals keep + bulk + review.
- Format evidence requires current `legal` or `restricted` status. The copy target is a storage preference, not a claim that every stored copy fits into one legal deck.

### Tournament evidence

[`data/metagame.json`](data/metagame.json) contains linked, dated [MTGTop8](https://www.mtgtop8.com/) statistics for Pauper, Standard, Modern, Premodern, Pioneer, Legacy, Vintage, and Duel Commander. The refresh script discovers the current **Last 2 Months** window, collects up to 100 mainboard and 100 sideboard cards per format, and includes cards appearing in at least 1% of decks in either section. Duel Commander uses mainboard evidence only. Percentages from the two sections are never added together. **Most tournament play** uses the highest section percentage among the selected formats for each currently legal/restricted card, independent of the keep threshold or manual override; unknown play ranks last. Basic lands are excluded by the source and use the separate reserve.

**This is a bounded tournament sample, not every card that sees play.** Absence means no qualifying evidence in this sample. Source dates, sample limits, format availability, and links are visible in the app. Evidence older than 35 days can still protect known positive matches, but absent matches are uncertain and cannot automatically become bulk.

Commander supports legality mode. There is no bundled Commander tournament source. Tournament mode treats legal Commander cards without evidence as uncertain.

### J25 membership and search

`data/j25.json` is derived by `scripts/update-j25.py` from Jumpstart Atlas's `CATALOG`, currently 768 names across 121 decks. The deployment refreshes this derived list from the Atlas repository. It is not a separately maintained deck catalog. Missing membership data sends otherwise unprotected copies to review when the J25 rule is enabled.

Advanced fields mirror Atlas: card name, rules text, type line with exclusions, set, mana cost, artist, flavor, lore, criteria, colors and identity, mana value/power/toughness/loyalty, format status, price, rarity, and game. Applying fields writes a visible query. Local searches support AND, OR, parentheses, negation, and sorting predicates such as `is:keep`, `is:bulk`, `is:review`, and `is:j25`.

Types include any selected type and exclude every selected type. Set search matches the imported/verified set code or set name, never an assumed reference printing. Unknown metadata does not satisfy negative filters. Existing saved card data may need **Refresh card data** to populate newly supported search fields.

Online-only Scryfall syntax (including mana-cost comparisons, regex, and lore) searches all matching printings and intersects printing IDs with the collection. Name-only rows use their reference printing for online queries. Remote results are applied only after every page succeeds; cancellation prevents old queries from replacing new results. Searches over 10,000 printings require a narrower query. Collection-specific `is:` terms cannot combine with online-only syntax; use the recommendation tabs for Keep/Bulk/Review instead.

### Scryfall and prices

[Scryfall collection API](https://scryfall.com/docs/api/cards/collection) lookups batch up to 75 distinct identifiers, with at least 600 ms between requests, bounded retries, cancellation, and timeouts. This respects the documented collection endpoint limit of two requests per second. Metadata and prices are cached for 24 hours in IndexedDB; Refresh card data bypasses the cache. Data older than seven days requires review before bulk recommendations.

An exact printing is identified by Scryfall ID or set code + collector number. Name-only and name + set imports use reference printings. Price protection can optionally use those reference prices; rarity protection requires exact printings. Missing prices are unknown, never zero. Nonfoil, foil, and etched prices are distinct. Prices are market references, not quotes for a card's condition or language.

Files and quantities stay local. Scryfall receives identifiers to resolve cards and any online search queries; its image host receives image requests. Google Fonts supplies the interface fonts. There is no collection server, analytics, or account. Different tabs/devices do not automatically synchronize. Export a backup before clearing browser storage. Restored backups re-fetch metadata rather than trusting embedded prices or remote URLs.

## Develop

```sh
python3 -m http.server 8001
# Open http://localhost:8001
npm test
python3 scripts/update-metagame.py
python3 scripts/update-j25.py
node scripts/update-example.mjs
```

No package install or bundler needed. Native ES modules require HTTP rather than `file://`. Node 22+ runs tests and the example refresh. Python 3.12+ runs the evidence refresh using only its standard library.

- `index.html`, `styles.css`: interface shell and visual design.
- `src/core.js`: pure allocation rules, price lookup, and grouping.
- `src/import.js`: CSV/decklist parsing, import validation, backup validation, and CSV output.
- `src/data.js`: IndexedDB and Scryfall lookup/cache.
- `src/search.js`: query parsing, local matching, advanced-field composition, and online search.
- `src/app.js`: interaction and rendering.
- `scripts/`: refresh published evidence and example data.
- `tests/`: allocation invariants and import regression cases.

## Deployment

GitHub Pages uses [`.github/workflows/pages.yml`](.github/workflows/pages.yml). Pushes to `main`, manual dispatches, and a weekly Monday schedule run tests, refresh evidence, J25 membership, and example prices, and deploy a static artifact. The source repo does not accumulate automated data commits. A failed source refresh fails the deployment and leaves the previous site available. GitHub may suspend scheduled workflows after 60 days without repository activity; re-enable a suspended workflow in Actions or with `gh workflow enable pages.yml`. Old evidence is labeled and handled conservatively in the app.

The committed snapshots support immediate local use. The deployed snapshots are generated afresh by the workflow, so their timestamps may differ from the files in git.

Magic: The Gathering card text and art are owned by Wizards of the Coast. Card Sift is an independent fan project. Data and images are attributed to Scryfall and tournament statistics to MTGTop8.
