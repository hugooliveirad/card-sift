# Card Sift

Sort a Magic: The Gathering collection into **Keep**, **Bulk**, and **Needs review**, with a reason for every copy.

**Live:** https://hugobessa.com.br/card-sift/

Inspired by [Jumpstart Atlas](https://hugobessa.com.br/jumpstart-atlas/). A separate, static app with no account, backend, or build dependencies. Your collection stays in your browser.

## Use it

1. Import a CSV, TSV, text decklist, Card Sift backup, or Jumpstart Atlas JSON backup. Review column mappings and excluded rows before applying it. Replace a full collection or add new copies. The previous inventory can be restored with Undo last import until you leave the page.
2. Choose formats and whether you want tournament evidence (default) or any legal card. Choose minimum deck share or minimum deck count over the last 365 days, a playset target, separate reserves per land printing, J25 deck membership, protected rarities, and a USD/EUR price floor.
3. Review the table or image grid. Search names or use advanced query syntax; include/exclude card types, search owned sets, and filter by recommendation, color, or rarity. Filter by minimum decks in any selected legal format, or sort by deck counts, tournament play, name, price, quantity, bulk, or review.
4. Open a card for all owned versions, a format matrix with legality and tournament usage, named J25 decks and tournament archetypes, and links to matching decklists. Each owned version has a link menu for Scryfall printing/set pages, LigaMagic prices, and MTGTop8. Select a version to edit its quantity or override that printing and finish. Previous/Next and arrow keys follow the filtered, sorted collection across pages; switching owned versions preserves your position. Back or Escape from editing restores the card and scroll position.
5. Export a CSV sorting plan for your current view or the entire collection. Export a JSON backup to preserve your inventory, rules, and decisions.

Try the example collection without replacing your own inventory. The example uses real Scryfall printings and is clearly labeled.

The table joins finishes of the same known printing, showing separate finish quantities and unit prices with a combined sorting plan. Filters apply before joining: a foil-only search shows only matching copies. Exports and backups retain individual finish rows. The grid keeps finishes separate and marks foil/etched cards with a subtle rainbow overlay and a text label. Name-only rows remain separate because their printing is unverified.

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

[`data/metagame.json`](data/metagame.json) contains linked, dated [MTGTop8](https://www.mtgtop8.com/) statistics for Pauper, Standard, Modern, Premodern, Pioneer, Legacy, Vintage, and Duel Commander. The refresh script discovers each format's **current calendar year** window (currently All 2026 Decks), covering January 1 through the snapshot date. It collects up to 100 mainboard and 100 sideboard cards per format, each appearing in at least 1% of decks in that section. The window advances to the new calendar year in January. Duel Commander uses mainboard evidence only. **Either mainboard or sideboard usage meeting your minimum share qualifies a card for the same playset reserve.** Sideboard cards do not need mainboard usage, and the sections do not create separate reserves. Keep reasons list both sections when both qualify. Percentages are never added together. **Most tournament play** uses the highest section percentage among the selected formats for each currently legal/restricted card, independent of the keep threshold or manual override; unknown play ranks last. Basic lands are excluded by the source and use the separate reserve.

**This is a bounded tournament sample, not every card that sees play.** Absence means no qualifying evidence in this sample. Source dates, sample limits, format availability, and links are visible in the app. Evidence older than 35 days can still protect known positive matches, but absent matches are uncertain and cannot automatically become bulk.

Commander supports legality mode. There is no bundled Commander tournament source. Tournament mode treats legal Commander cards without evidence as uncertain.

Card details show every supported format, independently of the keep-rule selections. Green circles indicate legal/restricted status; gray circles indicate nonlegal/unknown status, with text labels distinguishing each. Usage is the higher section share, with both mainboard and sideboard figures visible and links to the source. A dash marks a section without qualifying sampled evidence; it is never displayed as 0%.

### Exact deck counts

`data/deck-counts.json` adds exact MTGTop8 search totals for a rolling **365 inclusive calendar days**, ending at the snapshot date. Each search selects one card, one format, and both mainboard and sideboard. Its result count counts matching decklists once, even when a card is in both sections. Counts are not extrapolated from rounded percentages or the small archetype example sample. MTGDecks was considered, but its pages rejected automated access.

**Pauper and Duel Commander cover every legal/restricted card name in the preloaded release families**, even when it is absent from the annual top-card sample. Each name gets an actual dated lookup, including confirmed zero-result searches. Other formats retain the annual statistics index. **It is not a complete catalog of every played card.** Unindexed cards have an unknown count, not zero; basic lands use the separate reserve and Commander has no count source. Card details link to the exact dated search and show each format's count, independently of format selection. Count windows and percentage windows are labeled separately.

Choose **Appear in at least X decks** in Keep rules to reserve a playset when the card meets that count in at least one selected, currently legal/restricted format. This is an alternative to the percentage criterion; rarity, price, J25, land reserves, and overrides retain their existing behavior. Missing counts or old negative evidence require review; known positive counts can still protect copies and are marked when old. Existing saved rules and backups default the new `minDecks` field to 10 and retain their previous mode.

The collection's **Minimum decks · last 365 days** filters the table/grid independently of Keep rules. Unindexed cards are excluded while a minimum is active. **Most decks** sorts by the highest indexed count in a selected legal format, with unknown counts last. Counts are never summed across formats. CSV exports include counts by selected format and their window and fetch date.

Run `python3 scripts/update-deck-counts.py` to refresh. It validates echoed source filters, checkpoints progress locally, starts card lookups at least one second apart with at most three in flight, and publishes atomically only after all counts finish. Counts are reused for up to seven days, but newly added set/card coverage is filled immediately using the same date window. Adventure/transform/modal cards search their front face, while split/Room cards use MTGTop8’s combined name; all results are stored under the canonical English name. Actions caches complete snapshots to avoid a full crawl on every UI deploy. A refresh failure prevents publication. The rolling window always refers to the displayed snapshot dates, not live browser time.

**Named tournament archetypes** come from `data/archetypes.json`, refreshed by `scripts/update-archetypes.py`. For each of the eight supported tournament formats it reads the first 25 results of MTGTop8's recent deck search, restricted to the preceding 60 days, then reads those actual decklists and their source-assigned archetypes. It publishes only after every requested page succeeds and passes identity, format, date, and decklist checks. Commander entries in Duel Commander are distinguished from mainboard and sideboard cards using the source's section headings.

The card dialog groups matches by format and archetype, shows how many sampled lists contain the card, and expands to dated event/deck links with copy counts by section. Matching follows English card identity across sets and finishes, including split-card name notation. This small recency sample provides examples of use; it is not a representative metagame breakdown. No archetype popularity percentages are inferred, and it does not change allocation rules or the broader tournament statistics above. Empty samples, unavailable data, and snapshots older than 35 days are labeled. Links to full MTGTop8 searches remain available.

### J25 membership and search

`data/j25.json` is derived by `scripts/update-j25.py` from Jumpstart Atlas's `CATALOG`, currently 768 names across 121 decks. It includes deck names, variants, and per-card membership quantities for links back to the Atlas decklists. The deployment refreshes this derived index from the Atlas repository. It is not a separately maintained deck catalog. Missing membership data sends otherwise unprotected copies to review when the J25 rule is enabled.

Advanced fields mirror Atlas: card name, rules text, type line with exclusions, set, mana cost, artist, flavor, lore, criteria, colors and identity, mana value/power/toughness/loyalty, format status, price, rarity, and game. Applying fields writes a visible query. Local searches support AND, OR, parentheses, negation, and sorting predicates such as `is:keep`, `is:bulk`, `is:review`, and `is:j25`.

Types include any selected type and exclude every selected type. Set search matches the imported/verified set code or set name, never an assumed reference printing. Unknown metadata does not satisfy negative filters. Existing saved card data may need **Refresh card data** to populate newly supported search fields.

Online-only Scryfall syntax (including mana-cost comparisons, regex, and lore) searches all matching printings and intersects printing IDs with the collection. Name-only rows use their reference printing for online queries. Remote results are applied only after every page succeeds; cancellation prevents old queries from replacing new results. Searches over 10,000 printings require a narrower query. Collection-specific `is:` terms cannot combine with online-only syntax; use the recommendation tabs for Keep/Bulk/Review instead.

### Preloaded release families

`data/set-cache.json` contains Scryfall metadata for **FDN, J25, HOB, SOS and their related paper sets**, discovered through Scryfall's parent-set links. This includes Foundations Commander, The Hobbit Eternal, Secrets of Strixhaven Commander, Mystical Archive, promos, tokens, front cards, and art cards. Special Guests printings are included only when their release dates match those root releases. Alchemy is excluded. Tokens and front/art cards are metadata entries; they do not create invented tournament evidence.

The cache is generated by `node scripts/update-set-cache.mjs` before the tournament counts refresh. Deployments pass `--max-age-hours 24` to reuse a complete snapshot collected within the last day; normal script runs refresh it immediately. Source retries honor Retry-After delays, and failed refreshes retain the previous complete file. It contains public card metadata only, never your collection quantities, purchase prices, or containers. Exact printing IDs and set/collector numbers remain distinct. Imports and saved collections use matching bundled metadata immediately; normal import lookup can reuse it for up to seven days. **Refresh card data** still forces live Scryfall lookup, and older bundled data retains its original timestamp and remains subject to review.

For Mythic Tools CSV files, the importer now prefers **English Name** over the localized Card Name field. Non-English printing IDs that are not in the English bundle still resolve through Scryfall. The **Use Pauper + Duel · at least 1 deck** button applies those two formats and a minimum of one recorded deck, without changing copy targets, rarity/price protection, or J25 preferences. Existing saved rules remain intact until you apply the preset or change them yourself.

### Scryfall and prices

[Scryfall collection API](https://scryfall.com/docs/api/cards/collection) lookups batch up to 75 distinct identifiers, with at least 600 ms between requests, bounded retries, cancellation, and timeouts. This respects the documented collection endpoint limit of two requests per second. Metadata and prices are cached for 24 hours in IndexedDB; Refresh card data bypasses the cache. Data older than seven days requires review before bulk recommendations.

An exact printing is identified by Scryfall ID or set code + collector number. Name-only and name + set imports use reference printings. Price protection can optionally use those reference prices; rarity protection requires exact printings. Missing prices are unknown, never zero. Nonfoil, foil, and etched prices are distinct. Prices are market references, not quotes for a card's condition or language.

Files and quantities stay local. Scryfall receives identifiers to resolve cards and any online search queries; its image host receives image requests. Google Fonts supplies the interface fonts. There is no collection server, analytics, or account. Different tabs/devices do not automatically synchronize. Export a backup before clearing browser storage. Restored backups re-fetch metadata rather than trusting embedded prices or remote URLs.

## Develop

```sh
python3 -m http.server 8001
# Open http://localhost:8001
npm test
node scripts/update-set-cache.mjs
python3 scripts/update-metagame.py
python3 scripts/update-archetypes.py
python3 scripts/update-deck-counts.py
python3 scripts/update-j25.py
node scripts/update-example.mjs
```

No package install or bundler needed. Native ES modules require HTTP rather than `file://`. Node 22+ runs tests and the example refresh. Python 3.12+ runs the evidence refresh using only its standard library.

- `index.html`, `styles.css`: interface shell and visual design.
- `src/core.js`: pure allocation rules, price lookup, and grouping.
- `src/import.js`: CSV/decklist parsing, import validation, backup validation, and CSV output.
- `src/data.js`: IndexedDB and Scryfall lookup/cache.
- `src/set-cache.js`: bundled printing indexes and import hydration.
- `src/search.js`: query parsing, local matching, advanced-field composition, and online search.
- `src/archetypes.js`: card-to-deck evidence indexing and grouping by tournament archetype.
- `src/app.js`: interaction and rendering.
- `scripts/`: refresh published evidence and example data.
- `tests/`: allocation invariants and import regression cases.

## Deployment

GitHub Pages uses [`.github/workflows/pages.yml`](.github/workflows/pages.yml). Pushes to `main`, manual dispatches, and a weekly Monday schedule run tests, refresh release-family card metadata, tournament statistics, annual deck counts, archetype decklists, J25 membership, and example prices, and deploy a static artifact. The source repo does not accumulate automated data commits. A failed source refresh fails the deployment and leaves the previous site available. GitHub may suspend scheduled workflows after 60 days without repository activity; re-enable a suspended workflow in Actions or with `gh workflow enable pages.yml`. Old evidence is labeled and handled conservatively in the app.

The committed snapshots support immediate local use. The deployed snapshots are generated afresh by the workflow, so their timestamps may differ from the files in git.

Magic: The Gathering card text and art are owned by Wizards of the Coast. Card Sift is an independent fan project. Data and images are attributed to Scryfall and tournament statistics to MTGTop8.
