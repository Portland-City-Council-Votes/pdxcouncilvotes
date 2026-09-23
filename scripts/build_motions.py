#!/usr/bin/env python3
"""Rebuild data/motions.csv: every recorded roll call that isn't an item's final vote.

    python3 scripts/build_motions.py [--cache DIR]

Reads every non-cancelled meeting in data/meetings.csv, pulls the roll calls out
of each agenda page (amendments, Budget Committee approvals, procedural motions),
and writes them all to data/motions.csv, replacing what was there.

Theme and neighborhood come from the parent item: its row in votes.csv if it has
one, otherwise data/motion_parents.json (add an entry there when the script says
a parent is missing). With --cache DIR, pages are read from DIR/<date>.html when
present and saved there when fetched.

The City's minutes occasionally have typos. Two names run together without a
comma are split when both are councilors. A councilor listed on both sides of the
same roll call is left blank, with a note quoting what the minutes say.
"""

import argparse
import csv
import json
import re
import sys
from pathlib import Path

import parse_agenda

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
PROCEDURAL = re.compile(
    r"recess|reorder|postpone|continue|reconsider|call the question|limit debate|suspend|"
    r"\btable\b|adjourn|ruling|point of order|extend|testimony|agenda|refer|remand|"
    r"return .* to committee|rescind|withdraw",
    re.I,
)


def kind_of(text):
    if re.search(r"\bamend", text, re.I):
        return "Amendment"
    if PROCEDURAL.search(text):
        return "Procedural"
    return "Motion"


def split_merged(pairs, known):
    """Group votes by name, splitting 'Ryan Zimmerman' -> 'Ryan', 'Zimmerman' when the minutes drop a comma."""
    out = {}
    for name, vote in pairs:
        if name in known:
            out.setdefault(name, []).append(vote)
            continue
        words = name.split()
        for k in range(1, len(words)):
            a, b = " ".join(words[:k]), " ".join(words[k:])
            if a in known and b in known:
                out.setdefault(a, []).append(vote)
                out.setdefault(b, []).append(vote)
                break
        else:
            out.setdefault(name, []).append(vote)
    return out


def load_page(url, date, cache):
    if cache:
        path = Path(cache) / f"{date}.html"
        if path.exists():
            return path.read_text(encoding="utf-8")
        page = parse_agenda.fetch(url)
        path.write_text(page, encoding="utf-8")
        return page
    return parse_agenda.fetch(url)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache")
    args = ap.parse_args()
    if args.cache:
        Path(args.cache).mkdir(parents=True, exist_ok=True)

    with (DATA / "votes.csv").open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        parents = {r["doc_number"]: r for r in reader}
    councilors = header[header.index("url") + 1:]
    known = set(councilors)
    extra_themes = json.loads((DATA / "motion_parents.json").read_text(encoding="utf-8"))
    motion_themes = json.loads((DATA / "motion_themes.json").read_text(encoding="utf-8"))
    used = set()

    rows, missing = [], set()
    with (DATA / "meetings.csv").open(newline="", encoding="utf-8") as f:
        meetings = [m for m in csv.DictReader(f) if m["status"] != "cancelled"]
    for m in meetings:
        items = parse_agenda.parse(parse_agenda.page_lines(load_page(m["url"], m["date"], args.cache)))
        seq = {}
        for it in items:
            key = it["doc_number"] or it["title"]
            parent = parents.get(it["doc_number"]) if it["doc_number"] else None
            theme = parent["theme"] if parent else extra_themes.get(key)
            if it["roll_calls"] and not theme:
                missing.add(f"{key} ({m['date']}): {it['title'][:80]}")
            for rc in it["roll_calls"]:
                date = it["day"] or m["date"]
                seq[(date, key)] = seq.get((date, key), 0) + 1
                votes = split_merged(rc["pairs"], known)
                notes = []
                both = sorted(n for n, v in votes.items() if n in known and len(set(v)) > 1)
                if both:
                    notes.append("The City's minutes list " + ", ".join(
                        f"{n} as both {' and '.join(sorted(set(votes[n])))}" for n in both
                    ) + "; left blank here.")
                others = {n: v[0] for n, v in votes.items() if n not in known}
                for name, vote in others.items():
                    notes.append(f"{'Mayor ' if name == 'Wilson' else ''}{name} also voted {vote}.")
                merged = any(n not in known and " " in n for n, _ in rc["pairs"])
                if not rc["counts_ok"] and not both and not merged:
                    notes.append("The minutes' vote count doesn't match the names listed; names are recorded as listed.")
                row_theme = theme or ""
                tag = motion_themes.get(f"{date}|{it['doc_number']}|{seq[(date, key)]}")
                if tag:
                    if not rc["text"].startswith(tag["starts"]):
                        print(f"motion_themes.json entry {date}|{it['doc_number']}|{seq[(date, key)]} no longer matches: {rc['text'][:80]}")
                        return 1
                    used.add(f"{date}|{it['doc_number']}|{seq[(date, key)]}")
                    extra = [t for t in tag["theme"].split("; ") if t not in row_theme.split("; ")]
                    row_theme = "; ".join([row_theme] + extra) if row_theme else tag["theme"]
                row = {
                    "date": date, "doc_number": it["doc_number"], "seq": seq[(date, key)],
                    "item": parent["title"] if parent else it["title"].lstrip("*").strip(),
                    "kind": kind_of(rc["text"]), "motion": rc["text"], "note": " ".join(notes),
                    "theme": row_theme, "neighborhood": parent["neighborhood"] if parent
                    else parse_agenda.neighborhood_label(it["neighborhoods"]),
                    "url": m["url"],
                }
                row.update({c: (votes[c][0] if c in votes and c not in both else "") for c in councilors})
                rows.append(row)

    unused = set(k for k in motion_themes if not k.startswith("_")) - used
    if unused:
        print("motion_themes.json entries that matched nothing: " + ", ".join(sorted(unused)))
        return 1
    if missing:
        print("Add themes to data/motion_parents.json for:\n  " + "\n  ".join(sorted(missing)))
        return 1
    cols = ["date", "doc_number", "seq", "item", "kind", "motion", "note", "theme", "neighborhood", "url"] + councilors
    with (DATA / "motions.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} roll calls to data/motions.csv.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
