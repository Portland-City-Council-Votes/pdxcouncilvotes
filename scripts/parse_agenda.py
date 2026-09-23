#!/usr/bin/env python3
"""Read a portland.gov council agenda page and pull out each item's facts.

    python3 scripts/parse_agenda.py https://www.portland.gov/council/agenda/2026/9/23 [--json out.json]

Prints one block per agenda item (document number, type, final action,
neighborhood, final vote) so a person can decide which items are "major".
With --json, also writes the items for scripts/add_votes.py to use.

Only the final "Votes" block counts; votes on amendments and other motions
are ignored. The agenda's "Aye" is recorded as "Yea".
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.request
from datetime import datetime

REGIONS = {"North", "South", "Northeast", "Northwest", "Southeast", "Southwest"}
VOTE_WORDS = {"Aye": "Yea", "Yea": "Yea", "Nay": "Nay", "Absent": "Absent", "Abstain": "Abstain"}
FIELD_LABELS = {
    "Ordinance number", "Resolution number", "Document number", "Neighborhood",
    "Introduced by", "City department", "Council action", "Votes", "Time requested",
    "Time certain", "Second reading agenda item", "Testify on this item",
    "View testimony order", "Previous agenda item", "Contract number",
}
DAY_LINE = re.compile(
    r"^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), (\w+ \d{1,2}, \d{4})"
)
TYPE_LINE = re.compile(r"^\((Emergency ordinance|Ordinance|Resolution|Report|[^)]+)\)$")
VOTE_LINE = re.compile(r"^(Aye|Yea|Nay|Absent|Abstain) \((\d+)\):\s*(.*)$")
# Roll calls written into the notes, e.g. "Motion to amend ...: Moved by X. (Aye (8): A, B; Nay (4): C, D)".
ROLL_START = re.compile(r"\((?:Aye|Yea|Nay|Absent|Abstain):? \(\d*")
# Tolerates the minutes' typos: "Absent: (1)", "Nay (5) Name" and "Nay (Name, Name)" with no count.
ROLL_LABEL = re.compile(r"\b(Aye|Yea|Nay|Absent|Abstain):? \((\d+)?\)?:?")
NUMBER_FIELDS = {"Ordinance number", "Resolution number", "Contract number"}


def fetch(url, tries=4):
    for attempt in range(tries):
        try:
            page = urllib.request.urlopen(url, timeout=40).read().decode("utf-8")
            if "unexpected error" not in page[:500]:
                return page
        except OSError as err:
            print(f"retrying after {err}", file=sys.stderr)
        time.sleep(3 * (attempt + 1))
    raise SystemExit(f"could not fetch {url}")


def page_lines(page):
    page = re.sub(r"<(script|style|nav|header|footer)[^>]*>.*?</\1>", "", page, flags=re.S)
    page = re.sub(r"<(br|/p|/div|/li|/h\d|/tr|/dt|/dd|/span)[^>]*>", "\n", page)
    text = html.unescape(re.sub(r"<[^>]+>", "", page)).replace("\xa0", " ")
    lines = [re.sub(r"[ \t]+", " ", l).strip() for l in text.split("\n")]
    return [l for l in lines if l]


def parse(lines):
    items, day, cur = [], None, None
    i = 0
    while i < len(lines):
        line = lines[i]
        m = DAY_LINE.match(line)
        if m:
            day = datetime.strptime(m.group(2), "%B %d, %Y").date().isoformat()
            # Session notes (attendance, consent agenda, recesses) sit before the first item.
            cur = {
                "number": 0, "day": day, "title": "Meeting business", "type": "", "doc_number": "",
                "neighborhoods": [], "department": "", "action": "", "votes": {}, "motions": [],
                "notes": [],
            }
            items.append(cur)
        # An item starts with its agenda number, a title line, then "(Type)".
        elif line.isdigit() and i + 2 < len(lines) and TYPE_LINE.match(lines[i + 2]):
            cur = {
                "number": int(line), "day": day, "title": lines[i + 1].lstrip("*").strip(),
                "type": TYPE_LINE.match(lines[i + 2]).group(1), "doc_number": "",
                "neighborhoods": [], "department": "", "action": "", "votes": {},
                "motions": [], "notes": [],
            }
            items.append(cur)
            i += 3
            continue
        # Untyped agenda entries (agenda approval, elections, updates) still carry motions.
        elif (line.isdigit() and int(line) < 1000 and i + 1 < len(lines)
              and (i == 0 or lines[i - 1] not in NUMBER_FIELDS)):
            nxt = lines[i + 1]
            title = lines[i - 1] if (nxt in FIELD_LABELS or nxt.startswith("Motion")) else nxt
            cur = {
                "number": int(line), "day": day, "title": title, "type": "", "doc_number": "",
                "neighborhoods": [], "department": "", "action": "", "votes": {}, "motions": [],
                "notes": [],
            }
            items.append(cur)
            i += 1 if (nxt in FIELD_LABELS or nxt.startswith("Motion")) else 2
            continue
        elif cur is not None:
            if line == "Document number" and i + 1 < len(lines):
                cur["doc_number"] = lines[i + 1]
            elif line == "City department" and i + 1 < len(lines):
                cur["department"] = lines[i + 1]
            elif line == "Council action" and i + 1 < len(lines):
                cur["action"] = lines[i + 1]
            elif line == "Neighborhood":
                j = i + 1
                while j < len(lines) and lines[j] not in FIELD_LABELS and not lines[j].isdigit():
                    cur["neighborhoods"].append(lines[j])
                    j += 1
                i = j
                continue
            elif line.startswith("Motion "):
                cur["motions"].append(line)
                cur["notes"].append(line)
            elif line == "Votes":
                j = i + 1
                while j < len(lines):
                    vm = VOTE_LINE.match(lines[j])
                    if not vm:
                        break
                    word, count = VOTE_WORDS[vm.group(1)], int(vm.group(2))
                    names = [vm.group(3)] if vm.group(3) else []
                    j += 1
                    while len(names) < count and j < len(lines):
                        names.append(lines[j])
                        j += 1
                    for name in names:
                        cur["votes"][name.strip()] = word
                i = j
                continue
            elif ROLL_START.search(line):
                cur["notes"].append(line)
            elif line not in FIELD_LABELS:
                cur["notes"].append(line)
        i += 1
    for it in items:
        it["roll_calls"] = roll_calls(it.pop("notes"))
    return items


def roll_calls(notes):
    """Every recorded roll call in an item's notes, other than its final vote.

    A roll call is usually inline after the motion text; sometimes it sits on its
    own line(s) right after the text it belongs to.
    """
    out, last_text, loose, prev_roll = [], "", None, False
    for note in notes:
        start = ROLL_START.search(note)
        if not start:
            last_text, loose, prev_roll = note, None, False
            continue
        text = note[:start.start()].strip().rstrip(":").strip()
        # Split on the vote labels themselves; the minutes' punctuation between groups varies.
        body = note[start.start():]
        labels = list(ROLL_LABEL.finditer(body))
        end = body.find(")", labels[-1].end()) if labels else -1
        if end != -1:
            body = body[:end]
        pairs, counts_ok = [], True
        for k, lab in enumerate(labels):
            chunk = body[lab.end():labels[k + 1].start() if k + 1 < len(labels) else len(body)]
            listed = [x.strip(" .;:()") for x in chunk.split(",")]
            listed = [x for x in listed if x]
            if lab.group(2):
                counts_ok &= len(listed) == int(lab.group(2))
            pairs += [(name, VOTE_WORDS[lab.group(1)]) for name in listed]
        votes = dict(pairs)
        if text:
            out.append({"text": text, "votes": votes, "pairs": pairs, "counts_ok": counts_ok})
            loose = None
        elif prev_roll and out and loose is None:
            # The rest of a roll call that wrapped onto the next line.
            out[-1]["votes"].update(votes)
            out[-1]["pairs"] += pairs
            out[-1]["counts_ok"] &= counts_ok
        elif loose is not None:
            loose["votes"].update(votes)
            loose["pairs"] += pairs
            loose["counts_ok"] &= counts_ok
        else:
            loose = {"text": last_text.strip().rstrip(":").strip(), "votes": votes, "pairs": pairs,
                     "counts_ok": counts_ok}
            out.append(loose)
        prev_roll = True
    return out


def neighborhood_label(names):
    if not names:
        return "Not specified in agenda"
    if REGIONS <= set(names):
        rest = [n for n in names if n not in REGIONS]
        return "; ".join(["Citywide"] + rest)
    return "; ".join(names)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url")
    ap.add_argument("--json", help="write parsed items here")
    args = ap.parse_args()
    items = parse(page_lines(fetch(args.url)))
    for it in items:
        it["neighborhood"] = neighborhood_label(it["neighborhoods"])
        it["url"] = args.url
        tally = {}
        for v in it["votes"].values():
            tally[v] = tally.get(v, 0) + 1
        print(f"#{it['number']} [{it['day']}] {it['doc_number'] or '-'} ({it['type']})")
        print(f"   {it['title']}")
        print(f"   dept: {it['department'] or '-'} | area: {it['neighborhood']}")
        print(f"   action: {it['action'] or '(none yet)'} | votes: {tally or '-'}")
        others = [f"{n}={v}" for n, v in it["votes"].items() if v != "Yea"]
        if others:
            print("   not Yea: " + ", ".join(others))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=1)


if __name__ == "__main__":
    main()
