#!/usr/bin/env python3
"""Append chosen agenda items to data/votes.csv and update data/meetings.csv.

    python3 scripts/add_votes.py MEETING_DATE PARSED.json PICKS.json [--in-progress]

PARSED.json comes from scripts/parse_agenda.py --json. PICKS.json maps each
included document number to the editorial fields:

    {"2026-277": {"synopsis": "...", "theme": "Public Safety; Transportation"}}

A pick may also set "note" (appended to the synopsis) or "neighborhood" (only
to correct the parser, never to guess). Title, type, action, neighborhood,
URL and votes come from the agenda page itself. Items without a final vote,
duplicates already in votes.csv, and unknown theme names are refused.

The meeting is marked done with the number of items logged, unless
--in-progress is given (meeting still underway; it stays pending).
"""

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VOTES = ROOT / "data" / "votes.csv"
MEETINGS = ROOT / "data" / "meetings.csv"
THEMES = {
    "Housing", "Homelessness", "Public Safety", "Transportation", "Budget & Taxes",
    "Environment & Energy", "Economic Development", "Land Use & Planning",
    "Utilities", "Parks & Recreation", "Arts & Culture", "Health & Social Services",
    "Civil Rights & Equity", "Government Operations", "Government Transparency",
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("meeting_date")
    ap.add_argument("parsed")
    ap.add_argument("picks")
    ap.add_argument("--in-progress", action="store_true")
    args = ap.parse_args()

    items = json.load(open(args.parsed, encoding="utf-8"))
    picks = json.load(open(args.picks, encoding="utf-8"))

    with VOTES.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        header = reader.fieldnames
        existing = {(r["date"], r["doc_number"]) for r in reader}
    councilors = header[header.index("url") + 1:]

    # The same item can appear on several days of one agenda; use the entry with a final vote.
    voted = {}
    for it in items:
        if it["votes"] and it["doc_number"]:
            voted[it["doc_number"]] = it

    rows, problems = [], []
    for doc, pick in picks.items():
        it = voted.get(doc)
        if it is None:
            problems.append(f"{doc}: no final vote on this agenda")
            continue
        unknown = set(it["votes"]) - set(councilors)
        if unknown and "note" not in pick:
            problems.append(f"{doc}: votes from {sorted(unknown)} need a 'note' explaining them")
        themes = [t.strip() for t in pick["theme"].split(";")]
        bad = [t for t in themes if t not in THEMES]
        if bad:
            problems.append(f"{doc}: unknown theme(s) {bad}; allowed: {sorted(THEMES)}")
        date = it["day"] or args.meeting_date
        if (date, doc) in existing:
            problems.append(f"{doc}: already in votes.csv for {date}")
        synopsis = pick["synopsis"].strip()
        if pick.get("note"):
            synopsis += " " + pick["note"].strip()
        row = {
            "date": date, "doc_number": doc, "title": it["title"], "synopsis": synopsis,
            "type": it["type"], "action": it["action"], "theme": "; ".join(themes),
            "neighborhood": pick.get("neighborhood", it["neighborhood"]), "url": it["url"],
        }
        row.update({name: it["votes"].get(name, "") for name in councilors})
        rows.append(row)

    if problems:
        print("\n".join(problems))
        print("\nNothing written.")
        return 1

    with VOTES.open("a", newline="", encoding="utf-8") as f:
        csv.DictWriter(f, fieldnames=header).writerows(rows)

    with MEETINGS.open(newline="", encoding="utf-8") as f:
        mreader = csv.DictReader(f)
        mheader = mreader.fieldnames
        meetings = list(mreader)
    for m in meetings:
        if m["date"] == args.meeting_date:
            logged = int(m["items_logged"] or 0) + len(rows)
            m["items_logged"] = str(logged)
            if not args.in_progress:
                m["status"] = "done"
            break
    else:
        print(f"warning: {args.meeting_date} is not in meetings.csv", file=sys.stderr)
    with MEETINGS.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=mheader)
        w.writeheader()
        w.writerows(meetings)

    print(f"Added {len(rows)} item(s) for {args.meeting_date}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
