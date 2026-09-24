#!/usr/bin/env python3
"""Attribute card use to source-labeled archetypes in a bounded recent decklist sample."""
import argparse
import datetime as dt
import html
import json
from pathlib import Path
import re
import urllib.parse
from mtgtop8 import FORMATS, fetch_url

BASE = 'https://www.mtgtop8.com/'
MAX_DECKS = 25
WINDOW_DAYS = 60


def plain(text):
    return html.unescape(re.sub('<[^>]+>', '', text)).strip()


def parse_search(text, code, start, end):
    count = re.search(r'>(\d+) decks matching', text)
    if not count:
        raise ValueError('Missing deck search count; source markup may have changed')
    rows = re.findall(r'<tr class=hover_tr>(.*?)</tr>', text, re.S)
    if len(rows) != min(MAX_DECKS, int(count[1])):
        raise ValueError('Incomplete deck search page')
    decks = []
    for row in rows:
        cells = re.findall(r'<td\b[^>]*>(.*?)</td>', row, re.S)
        link = re.search(r'<a href=(event\?[^ >]+)>(.*?)</a>', cells[1]) if len(cells) == 8 else None
        if not link:
            raise ValueError('Missing deck identity in search result')
        params = urllib.parse.parse_qs(urllib.parse.urlsplit(html.unescape(link[1])).query)
        if params.get('f') != [code] or not params.get('d', [''])[0].isdigit():
            raise ValueError('Deck search returned a different format or invalid deck ID')
        played = dt.datetime.strptime(plain(cells[7]), '%d/%m/%y').date()
        if not start <= played <= end:
            raise ValueError('Deck search ignored its date window')
        decks.append({'id': params['d'][0], 'name': plain(link[2]),
                      'url': BASE + html.unescape(link[1]), 'event': plain(cells[4]),
                      'playedAt': played.isoformat()})
    if len({deck['id'] for deck in decks}) != len(decks):
        raise ValueError('Duplicate deck IDs in search results')
    return decks


def parse_deck(text, deck):
    if not re.search(r'\b(?:mtgo|dec)\?d=' + re.escape(deck['id']) + r'(?:&|[>"\s])', text):
        raise ValueError('Deck page does not match requested deck ' + deck['id'])
    archetype = re.search(r'<a href=archetype\?a=(\d+)>(.*?) decks</a>', text, re.S)
    if not archetype:
        raise ValueError('Missing source archetype for ' + deck['id'])
    sections = {'mainboard': {}, 'sideboard': {}, 'commander': {}}
    cards = re.findall(r'<div class=O14[^>]*>(.*?)</div>|<div id=(md|sb)[^\s>]+ class="deck_line [^"]*"[^>]*>\s*(\d+)\s*<span class=L14>(.*?)</span>', text, re.S)
    if not cards:
        raise ValueError('Missing decklist for ' + deck['id'])
    heading = ''
    for label, section, quantity, name in cards:
        if label:
            heading = plain(label)
            continue
        target = sections['commander' if heading == 'COMMANDER' else 'mainboard' if section == 'md' else 'sideboard']
        name, quantity = plain(name), int(quantity)
        if not name or not 0 < quantity <= 100:
            raise ValueError('Invalid card entry in ' + deck['id'])
        target[name] = target.get(name, 0) + quantity
    total = sum(sections['mainboard'].values())
    if total < 60 or total > 300 or sum(sections['sideboard'].values()) > 15:
        raise ValueError('Incomplete or unexpected decklist for ' + deck['id'])
    if sections['commander'] and total + sum(sections['commander'].values()) != 100:
        raise ValueError('Incomplete commander decklist for ' + deck['id'])
    return {**deck, 'archetype': {'id': archetype[1], 'name': plain(archetype[2]),
                                'url': BASE + 'archetype?a=' + archetype[1]}, **sections}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='data/archetypes.json')
    args = parser.parse_args()
    now = dt.datetime.now(dt.timezone.utc)
    end, start = now.date(), now.date() - dt.timedelta(days=WINDOW_DAYS)
    snapshot = {'schema': 1, 'source': 'MTGTop8', 'fetchedAt': now.isoformat(),
                'from': start.isoformat(), 'through': end.isoformat(),
                'maxDecksPerFormat': MAX_DECKS, 'selection': 'Most recent search results', 'formats': {}}
    for format_name, code in FORMATS.items():
        url = BASE + 'search?' + urllib.parse.urlencode({
            'format': code, 'date_start': start.strftime('%d/%m/%Y'),
            'date_end': end.strftime('%d/%m/%Y')})
        decks = parse_search(fetch_url(url), code, start, end)
        parsed = []
        for deck in decks:
            parsed.append(parse_deck(fetch_url(deck['url']), deck))
        snapshot['formats'][format_name] = {'url': url, 'decks': parsed}
        print(f'{format_name}: {len(parsed)} recent decklists, {len({d["archetype"]["id"] for d in parsed})} archetypes', flush=True)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.tmp')
    temporary.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(output)


if __name__ == '__main__':
    main()
