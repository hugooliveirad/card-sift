#!/usr/bin/env python3
"""Derive J25 membership from Jumpstart Atlas's catalog, without maintaining another decklist."""
import argparse
import datetime as dt
import json
from pathlib import Path
import urllib.request

SOURCE = 'https://raw.githubusercontent.com/hugooliveirad/jumpstart-atlas/main/index.html'
parser = argparse.ArgumentParser()
parser.add_argument('--source', help='Read a local Atlas HTML file instead of GitHub')
args = parser.parse_args()
if args.source:
    text = Path(args.source).read_text()
else:
    request = urllib.request.Request(SOURCE, headers={'User-Agent': 'CardSift/1.0'})
    with urllib.request.urlopen(request, timeout=30) as response:
        text = response.read().decode('utf-8')
start = text.index('const CATALOG = ') + len('const CATALOG = ')
catalog, _ = json.JSONDecoder().raw_decode(text[start:])
if catalog.get('set') != 'j25' or not catalog.get('decks'):
    raise ValueError('Expected the Foundations Jumpstart catalog')
names = sorted({card['name'] for deck in catalog['decks'] for card in deck['cards']})
if len(names) < 300:
    raise ValueError('Incomplete J25 catalog; refusing to replace membership data')
data = {'schema': 1, 'source': 'https://github.com/hugooliveirad/jumpstart-atlas',
        'catalogSource': catalog.get('source'), 'fetchedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
        'decks': len(catalog['decks']), 'names': names,
        'deckInfo': {deck['id']: {key: deck[key] for key in ('name', 'variant', 'color')}
                     for deck in catalog['decks']},
        'membership': {name: [{'deck': deck['id'], 'quantity': card['quantity']}
                             for deck in catalog['decks'] for card in deck['cards']
                             if card['name'] == name] for name in names}}
Path('data/j25.json').write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
print(f"Derived {len(names)} card names from {data['decks']} Atlas J25 decks.")
