#!/usr/bin/env python3
"""Check data/votes.csv and data/meetings.csv against the schema in CLAUDE.md.

Run from the repo root:  python3 scripts/validate_data.py
Exits non-zero and prints every problem found if anything is wrong.
"""

import csv
import re
import sys
from datetime import date
from pathlib import Path

from add_votes import THEMES

ROOT = Path(__file__).resolve().parent.parent

META_COLUMNS = [
    "date", "doc_number", "title", "synopsis", "type", "action",
    "theme", "neighborhood", "url",
]
COUNCILORS = [
    "Morillo", "Avalos", "Ryan", "Pirtle-Guiney", "Zimmerman", "Dunphy",
    "Smith", "Green", "Clark", "Kanal", "Novick", "Koyama Lane",
]
TYPES = {"Ordinance", "Emergency ordinance", "Resolution", "Report"}
VOTES = {"Yea", "Nay", "Absent", "Abstain", ""}
MEETING_STATUSES = {"pending", "done", "cancelled"}
AGENDA_URL = re.compile(r"^https://www\.portland\.gov/council/")


def parse_date(value):
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def check_votes(errors):
    path = ROOT / "data" / "votes.csv"
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        expected = META_COLUMNS + COUNCILORS
        if reader.fieldnames != expected:
            errors.append(f"{path.name}: header must be exactly: {','.join(expected)}")
            return
        seen = set()
        for line, row in enumerate(reader, start=2):
            where = f"{path.name}:{line}"
            if None in row:
                errors.append(f"{where}: more fields than the header")
                continue
            if parse_date(row["date"]) is None:
                errors.append(f"{where}: date {row['date']!r} is not YYYY-MM-DD")
            for col in ("doc_number", "title", "action", "theme", "neighborhood"):
                if not row[col].strip():
                    errors.append(f"{where}: {col} is empty")
            bad_themes = [t for t in row["theme"].split("; ") if t not in THEMES]
            if bad_themes:
                errors.append(f"{where}: unknown theme(s) {bad_themes}; see THEMES in scripts/add_votes.py")
            if row["type"] not in TYPES:
                errors.append(f"{where}: type {row['type']!r} not one of {sorted(TYPES)}")
            if not AGENDA_URL.match(row["url"]):
                errors.append(f"{where}: url should point at portland.gov/council/...")
            key = (row["date"], row["doc_number"])
            if key in seen:
                errors.append(f"{where}: duplicate of {row['doc_number']} on {row['date']}")
            seen.add(key)
            for name in COUNCILORS:
                if row[name] not in VOTES:
                    errors.append(f"{where}: {name} vote {row[name]!r} not one of Yea/Nay/Absent/Abstain/blank")


def check_meetings(errors):
    path = ROOT / "data" / "meetings.csv"
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["date", "url", "status", "items_logged", "notes"]:
            errors.append(f"{path.name}: header must be exactly: date,url,status,items_logged,notes")
            return
        seen = set()
        for line, row in enumerate(reader, start=2):
            where = f"{path.name}:{line}"
            if parse_date(row["date"]) is None:
                errors.append(f"{where}: date {row['date']!r} is not YYYY-MM-DD")
            if row["date"] in seen:
                errors.append(f"{where}: duplicate meeting date {row['date']}")
            seen.add(row["date"])
            if not AGENDA_URL.match(row["url"]):
                errors.append(f"{where}: url should point at portland.gov/council/...")
            if row["status"] not in MEETING_STATUSES:
                errors.append(f"{where}: status {row['status']!r} not one of {sorted(MEETING_STATUSES)}")
            if row["status"] == "done" and not row["items_logged"].isdigit():
                errors.append(f"{where}: a done meeting needs items_logged (a number, 0 is fine)")


def check_motions(errors):
    path = ROOT / "data" / "motions.csv"
    expected = ["date", "doc_number", "seq", "item", "kind", "motion", "note", "theme",
                "neighborhood", "url"] + COUNCILORS
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != expected:
            errors.append(f"{path.name}: header must be exactly: {','.join(expected)}")
            return
        seen = set()
        for line, row in enumerate(reader, start=2):
            where = f"{path.name}:{line}"
            if parse_date(row["date"]) is None:
                errors.append(f"{where}: date {row['date']!r} is not YYYY-MM-DD")
            if row["kind"] not in {"Amendment", "Procedural", "Motion"}:
                errors.append(f"{where}: kind {row['kind']!r} not Amendment/Procedural/Motion")
            if not row["motion"].strip() or not row["item"].strip():
                errors.append(f"{where}: motion and item are required")
            bad_themes = [t for t in row["theme"].split("; ") if t not in THEMES]
            if bad_themes:
                errors.append(f"{where}: unknown theme(s) {bad_themes}")
            if not AGENDA_URL.match(row["url"]):
                errors.append(f"{where}: url should point at portland.gov/council/...")
            key = (row["date"], row["doc_number"] or row["item"], row["seq"])
            if key in seen:
                errors.append(f"{where}: duplicate roll call {key}")
            seen.add(key)
            recorded = 0
            for name in COUNCILORS:
                if row[name] not in VOTES:
                    errors.append(f"{where}: {name} vote {row[name]!r} not one of Yea/Nay/Absent/Abstain/blank")
                recorded += bool(row[name])
            if recorded < 12 and not row["note"]:
                errors.append(f"{where}: {12 - recorded} councilor(s) blank without a note explaining why")


def check_news(errors):
    path = ROOT / "data" / "news.csv"
    with (ROOT / "data" / "votes.csv").open(newline="", encoding="utf-8") as f:
        docs = {r["doc_number"] for r in csv.DictReader(f)}
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames != ["doc_number", "outlet", "headline", "url", "image"]:
            errors.append(f"{path.name}: header must be exactly: doc_number,outlet,headline,url,image")
            return
        seen = set()
        for line, row in enumerate(reader, start=2):
            where = f"{path.name}:{line}"
            if row["doc_number"] not in docs:
                errors.append(f"{where}: {row['doc_number']} is not in votes.csv")
            if not row["headline"].strip() or not row["outlet"].strip():
                errors.append(f"{where}: headline and outlet are required")
            if not row["url"].startswith("https://"):
                errors.append(f"{where}: url must start with https://")
            if "oregonlive.com" in row["url"] and not row["url"].endswith("?outputType=amp"):
                errors.append(f"{where}: OregonLive links must end with ?outputType=amp")
            if row["image"] and not row["image"].startswith("https://"):
                errors.append(f"{where}: image must be an https:// URL (or blank)")
            if (row["doc_number"], row["url"]) in seen:
                errors.append(f"{where}: duplicate link for {row['doc_number']}")
            seen.add((row["doc_number"], row["url"]))


def main():
    errors = []
    check_votes(errors)
    check_meetings(errors)
    check_motions(errors)
    check_news(errors)
    if errors:
        print("\n".join(errors))
        print(f"\n{len(errors)} problem(s) found.")
        return 1
    print("Data files look good.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
