#!/usr/bin/env python3
"""Collect exact search totals for indexed cards; never derive counts from shares."""
import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import html
import json
from pathlib import Path
import re
import threading
import time
import urllib.parse
from mtgtop8 import FORMATS, fetch_url

BASE = 'https://www.mtgtop8.com/search'
PACE = threading.Lock()
LAST_REQUEST = 0


def collect(code, start, end, name):
    global LAST_REQUEST
    # Bound concurrent lookups and space new cards so a refresh is gentle on the source.
    with PACE:
        time.sleep(max(0, 1 - (time.monotonic() - LAST_REQUEST)))
        LAST_REQUEST = time.monotonic()
    return parse_count(fetch_url(search_url(code, start, end, name)), code, start, end, name)


def search_url(code, start, end, name=None):
    params = {'format': code, 'date_start': start.strftime('%d/%m/%Y'),
              'date_end': end.strftime('%d/%m/%Y'), 'MD_check': 1, 'SB_check': 1}
    if name:
        params['cards'] = name
    return BASE + '?' + urllib.parse.urlencode(params, encoding='windows-1252')


def parse_count(body, code, start, end, name):
    # Confirm the server applied every filter before trusting the total.
    for key, value in [('date_start', start.strftime('%d/%m/%Y')),
                       ('date_end', end.strftime('%d/%m/%Y'))]:
        if not re.search(r'name=' + key + r'\b[^>]*value="' + re.escape(value) + '"', body):
            raise ValueError('Search did not confirm date filter')
    if not re.search(r'<option value="?' + re.escape(code) + r'"?\s+selected\b', body):
        raise ValueError('Search did not confirm format')
    for key in ('MD_check', 'SB_check'):
        if not re.search(r'name=' + key + r'\b[^>]*\bchecked\b', body):
            raise ValueError('Search did not confirm both deck sections')
    field = re.search(r'<textarea name=cards[^>]*>(.*?)</textarea>', body, re.S)
    if not field or html.unescape(field[1]).strip() != name:
        raise ValueError('Search did not confirm card identity: ' + name)
    match = re.search(r'>([\d,]+) decks matching', body)
    if not match:
        raise ValueError('Missing search total')
    return int(match[1].replace(',', ''))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='data/deck-counts.json')
    parser.add_argument('--max-age-days', type=int, default=7)
    args = parser.parse_args()
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    now = dt.datetime.now(dt.timezone.utc)
    old = json.loads(output.read_text()) if output.exists() else None
    age = now - dt.datetime.fromisoformat(old['fetchedAt']) if old else None
    reuse = old is not None and dt.timedelta(0) <= age < dt.timedelta(days=args.max_age_days)
    end = dt.date.fromisoformat(old['through']) if reuse else now.date()
    start = end - dt.timedelta(days=364)
    candidates = json.loads(Path('data/metagame.json').read_text())
    set_cache = json.loads(Path('data/set-cache.json').read_text())
    wanted = {f: {c['name']: c['name'] for c in candidates['formats'][f]['cards']} for f in FORMATS}
    for card in set_cache['cards']:
        name = card['name']
        source_name = name.replace(' // ', ' / ') if card.get('layout') in ('split', 'room') else name.split(' // ')[0]
        for f in set_cache['priorityFormats']:
            if card.get('legalities', {}).get(f) in ('legal', 'restricted'):
                wanted[f][name] = source_name
    progress = output.with_suffix('.progress.json')
    checkpoint = json.loads(progress.read_text()) if progress.exists() else {}
    if checkpoint.get('through') != end.isoformat() or checkpoint.get('schema') != 2:
        checkpoint = {'schema': 2, 'through': end.isoformat(), 'formats': {}}
    if reuse:
        for f, data in old['formats'].items():
            saved = checkpoint['formats'].setdefault(f, {})
            for card in data['cards']:
                query_name = urllib.parse.parse_qs(urllib.parse.urlsplit(card['url']).query, encoding='windows-1252')['cards'][0]
                saved.setdefault(query_name, card['decks'])
    snapshot = {'schema': 1, 'source': 'MTGTop8', 'fetchedAt': old['fetchedAt'] if reuse else now.isoformat(),
                'window': 'Last 365 days', 'from': start.isoformat(), 'through': end.isoformat(),
                'selection': 'Annual statistics plus every legal card in the cached set families for Pauper and Duel Commander',
                'setCoverage': {'sets': [s['code'] for s in set_cache['sets']], 'formats': set_cache['priorityFormats']},
                'sections': ['mainboard', 'sideboard'], 'formats': {}}
    for format_name, code in FORMATS.items():
        saved = checkpoint['formats'].setdefault(format_name, {})
        names = sorted(set(wanted[format_name].values()))
        missing = [name for name in names if name not in saved]
        failures = []
        with ThreadPoolExecutor(max_workers=3) as pool:
            futures = {pool.submit(collect, code, start, end, name): name for name in missing}
            for i, future in enumerate(as_completed(futures), len(names) - len(missing) + 1):
                name = futures[future]
                try:
                    saved[name] = future.result()
                except Exception as error:
                    failures.append(f'{name}: {error}')
                    continue
                temporary_progress = progress.with_suffix('.tmp')
                temporary_progress.write_text(json.dumps(checkpoint, ensure_ascii=False))
                temporary_progress.replace(progress)
                if i % 25 == 0:
                    print(f'{format_name}: {i}/{len(names)} cards', flush=True)
        if failures:
            raise ValueError('Incomplete counts; previous snapshot retained. ' + '; '.join(failures))
        cards = [{'name': name, 'decks': saved[source_name], 'url': search_url(code, start, end, source_name)} for name, source_name in sorted(wanted[format_name].items())]
        snapshot['formats'][format_name] = {'code': code, 'url': search_url(code, start, end), 'cards': cards}
        print(f'{format_name}: completed {len(cards)} exact card counts', flush=True)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(output)
    progress.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
