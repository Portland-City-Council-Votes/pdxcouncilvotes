#!/usr/bin/env python3
"""Fill the image column of data/news.csv with each article's own preview image.

    python3 scripts/fetch_news_images.py [--all]

Reads each article page and takes its og:image (the picture news sites publish for
link previews), then writes the URL into the image column. The page's own title
must match the stored headline, so an image never lands on the wrong story. Rows that already have
an image are skipped unless --all is given. Articles that can't be fetched keep a
blank image, and the site shows an outlet tile instead.

The news sites must be reachable: from a cloud session, add their domains to the
environment's allowed network domains, or run this on your own computer.
"""

import argparse
import csv
import html
import re
import sys
import urllib.request
from pathlib import Path

NEWS = Path(__file__).resolve().parent.parent / "data" / "news.csv"
OG_IMAGE = re.compile(
    r'<meta[^>]+(?:property|name)=["\'](?:og:image|twitter:image)["\'][^>]*content=["\']([^"\']+)'
    r'|<meta[^>]+content=["\']([^"\']+)["\'][^>]*(?:property|name)=["\'](?:og:image|twitter:image)["\']',
    re.I,
)


OG_TITLE = re.compile(r'<meta[^>]+property=["\']og:title["\'][^>]*content=["\']([^"\']+)', re.I)
WORD = re.compile(r"[a-z0-9]+")


def same_story(page, headline):
    """True when the page's own title shares most of its words with our headline."""
    m = OG_TITLE.search(page) or re.search(r"<title>(.*?)</title>", page, re.S | re.I)
    if not m:
        return False
    title = set(WORD.findall(html.unescape(m.group(1)).lower()))
    words = set(WORD.findall(headline.lower()))
    return len(title & words) >= 0.6 * len(words)


def og_image(url, headline):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (portland-council-votes)"})
    page = urllib.request.urlopen(req, timeout=30).read(600_000).decode("utf-8", "replace")
    if not same_story(page, headline):
        print(f"skipped {url}: page title doesn't match the headline", file=sys.stderr)
        return ""
    m = OG_IMAGE.search(page)
    if not m:
        return ""
    image = html.unescape(m.group(1) or m.group(2)).strip()
    return image if image.startswith("https://") else ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    with NEWS.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    found = failed = 0
    cache = {}
    for row in rows:
        if row["image"] and not args.all:
            continue
        if row["url"] not in cache:
            try:
                cache[row["url"]] = og_image(row["url"], row["headline"])
            except OSError as err:
                print(f"couldn't fetch {row['url']}: {err}", file=sys.stderr)
                cache[row["url"]] = ""
        row["image"] = cache[row["url"]]
        if row["image"]:
            found += 1
        else:
            failed += 1
    with NEWS.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(f"Images found for {found} rows; {failed} still without one.")


if __name__ == "__main__":
    main()
