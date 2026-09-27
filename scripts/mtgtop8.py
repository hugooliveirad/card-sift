"""Shared, paced access to the public MTGTop8 pages used by the snapshots."""
import time
import gzip
import urllib.request

FORMATS = {'pauper': 'PAU', 'standard': 'ST', 'modern': 'MO', 'premodern': 'PREM',
           'pioneer': 'PI', 'legacy': 'LE', 'vintage': 'VI', 'duel': 'EDH'}


def fetch_url(url):
    for attempt in range(3):
        time.sleep(0.65 * (attempt + 1))
        try:
            req = urllib.request.Request(url, headers={
                'Accept-Encoding': 'gzip',
                'User-Agent': 'CardSift/1.0 (collection organizer; github.com/hugooliveirad/card-sift)'})
            with urllib.request.urlopen(req, timeout=30) as response:
                raw = response.read()
                if response.headers.get('Content-Encoding', '').lower() == 'gzip':
                    raw = gzip.decompress(raw)
                try:
                    return raw.decode('utf-8')
                except UnicodeDecodeError:
                    return raw.decode('windows-1252')
        except Exception:
            if attempt == 2:
                raise
