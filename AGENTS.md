# Card Sift

Standalone static collection sorter. Native browser ES modules, no bundler or backend. Serve with `python3 -m http.server 8001`; run `npm test` for allocation and import regressions.

Read README.md before changing evidence, matching, prices, or storage.

- Tournament evidence and format legality are different. Never label legality as observed play.
- Nonland playsets share Oracle identity across printings. Land reserves use exact printing identity, shared across finishes. Value/rarity/manual keeps count only toward their corresponding reserve.
- J25 eligibility is name-based across sets, derived from Atlas with `scripts/update-j25.py`; never manually maintain a second deck catalog.
- Type exclusions win over inclusions. Unknown metadata never satisfies a negative filter. Tournament sorting uses maximum observed share in selected formats, independently of keep decisions.
- Card dialog navigation captures the full filtered/sorted list; editing returns to its parent with scroll/focus restored.
- Every row must conserve quantity: owned = keep + bulk + review.
- Missing or stale data is uncertain. Never silently turn unknown prices into zero or unmatched rows into bulk.
- Preserve printing and finish identity. Do not change IndexedDB or backup schemas without a migration.
- Collection files and quantities stay local. Only card identifiers go to Scryfall.
- Keep sample data separate from the user's collection and never persist it over their inventory.
- Source snapshots are bounded, dated, attributed evidence. Refresh them with the scripts; never fabricate statistics.
- Changes deploy through GitHub Actions. Always sign human/agent commits with GPG.
