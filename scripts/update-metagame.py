#!/usr/bin/env python3
"""Fetch bounded main/sideboard evidence. Only replace the snapshot after a complete run."""
import argparse
import datetime as dt
import html
import json
from pathlib import Path
import re
import time
import urllib.parse
import urllib.request

FORMATS = {'pauper': 'PAU', 'standard': 'ST', 'modern': 'MO', 'premodern': 'PREM',
           'pioneer': 'PI', 'legacy': 'LE', 'vintage': 'VI'}
BASE = 'https://www.mtgtop8.com/topcards'


def fetch(params):
    url = BASE + '?' + urllib.parse.urlencode(params)
    for attempt in range(3):
        time.sleep(0.65 * (attempt + 1))
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'CardSift/1.0 (collection organizer; github.com/hugooliveirad/card-sift)'})
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
                try:
                    return raw.decode('utf-8')
                except UnicodeDecodeError:
                    return raw.decode('windows-1252')
        except Exception:
            if attempt == 2:
                raise


def parse_cards(text):
    rows = re.findall(r'<tr\s+id=md[^>]+>(.*?)</tr>', text, re.S)
    cards = []
    for row in rows:
        cells = re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)
        if len(cells) != 3:
            raise ValueError('Unexpected statistics table; refusing to publish incomplete data')
        name, share, average = [html.unescape(re.sub('<[^>]+>', '', cell)).strip() for cell in cells]
        cards.append({'name': name, 'percent': float(share.replace('%', '').strip()), 'average': float(average)})
    if not cards:
        raise ValueError('No card statistics found; source markup may have changed')
    return cards


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='data/metagame.json')
    args = parser.parse_args()
    menu = fetch({'f': 'PAU'})
    snapshot = {'schema': 1, 'fetchedAt': dt.datetime.now(dt.timezone.utc).isoformat(),
                'source': 'MTGTop8', 'window': 'Last 2 Months', 'maxPerSection': 100,
                'minimumPercent': 1, 'formats': {}}
    for name, code in FORMATS.items():
        select = re.search(r'id=meta_' + code + r'\s[^>]*>(.*?)</select>', menu, re.S)
        if not select:
            raise ValueError('Missing format menu: ' + name)
        meta = re.search(r'<option value=(\d+)\s[^>]*>Last 2 Months</option>', select[1])
        if not meta:
            raise ValueError('Missing two-month window: ' + name)
        cards = {}
        for section in ('MD', 'SB'):
            previous = None
            for page in range(1, 6):
                params = {'f': code, 'meta': meta[1], 'current_page': page, 'maindeck': section, 'lands': 1}
                body = fetch(params)
                rows = parse_cards(body)
                names = [r['name'] for r in rows]
                if names == previous:
                    raise ValueError('Pagination did not advance for ' + name)
                previous = names
                for row in rows:
                    if row['percent'] < 1:
                        continue
                    card = cards.setdefault(row['name'], {'name': row['name'], 'mainboard': 0, 'sideboard': 0})
                    card['mainboard' if section == 'MD' else 'sideboard'] = row['percent']
                pages = [int(n) for n in re.findall(r'PageSubmit\((\d+)\)', body)]
                if rows[-1]['percent'] < 1 or page >= max(pages, default=1):
                    break
        snapshot['formats'][name] = {'url': BASE + '?' + urllib.parse.urlencode({'f': code, 'meta': meta[1]}),
                                     'cards': sorted(cards.values(), key=lambda r: r['name'])}
        print(f'{name}: {len(cards)} cards with evidence', flush=True)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(output)


if __name__ == '__main__':
    main()
