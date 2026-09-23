# Card Sift

Standalone static collection sorter. Native browser ES modules, no bundler or backend. Serve with `python3 -m http.server 8001`; run `npm test` for allocation and import regressions.

Read README.md before changing evidence, matching, prices, or storage.

- Tournament evidence and format legality are different. Never label legality as observed play.
- Playsets are shared across printings; value/rarity/manual keeps count toward the reserve.
- Every row must conserve quantity: owned = keep + bulk + review.
- Missing or stale data is uncertain. Never silently turn unknown prices into zero or unmatched rows into bulk.
- Preserve printing and finish identity. Do not change IndexedDB or backup schemas without a migration.
- Collection files and quantities stay local. Only card identifiers go to Scryfall.
- Keep sample data separate from the user's collection and never persist it over their inventory.
- Source snapshots are bounded, dated, attributed evidence. Refresh them with the scripts; never fabricate statistics.
- Changes deploy through GitHub Actions. Always sign human/agent commits with GPG.
