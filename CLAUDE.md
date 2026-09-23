# Portland Council Votes — project notes

Read this before touching the data. It replaces the earlier "Project Notes (for future Claude)" artifact; this file is the source of truth now because it lives in the repo and survives between sessions.

## Goal

A public, searchable site of Portland City Council votes where visitors can:

1. Browse a spreadsheet-style view: date, item, a short plain-language synopsis, and how each of the 12 councilors voted.
2. Filter by **theme** (Housing, Public Safety, Budget/Taxes, Transportation, Homelessness, Environment/Energy, Arts & Culture, Government Operations, Government Transparency, …).
3. Filter by **neighborhood** affected (a named area when the agenda gives one, otherwise "Citywide").

**Decided (Sept 2026):** a static site served by GitHub Pages from this repo. No build step, no backend. `index.html` + `assets/app.js` load `data/votes.csv` and filter in the browser.

**Scope (Sept 2026):** every full-council meeting since the 12-member council's first meeting on **January 2, 2025** through the present, not just the last year.

## Layout

| Path | What it is |
|---|---|
| `index.html`, `assets/` | The site. Councilor columns come from the CSV header, so the page needs no change when data is added. |
| `data/votes.csv` | The dataset, one row per major agenda item with a final vote. |
| `data/meetings.csv` | Progress tracker, one row per meeting: date, agenda URL, `pending`/`done`/`cancelled`, items logged, notes. |
| `scripts/parse_agenda.py`, `scripts/add_votes.py` | Read an agenda page into structured items; append chosen items to the CSVs. See "How to work through the meetings". |
| `scripts/validate_data.py` | Schema check for both CSVs. Run `python3 scripts/validate_data.py` before every commit that touches `data/`; CI runs it too. |

Preview locally with `python3 -m http.server` and open http://localhost:8000 (opening `index.html` as a file won't load the CSV).

## Where the data comes from

Do **not** use `portland.gov/council/votes?page=N`: it returns duplicate, stale or wrong pages when fetched programmatically.

Use the individual meeting agenda pages instead:

```
https://www.portland.gov/council/agenda/YYYY/M/D
```

These load reliably and list every item with its type, sponsor, department, neighborhood tag, amendments and procedural motions, and the final vote as named Aye/Nay/Absent/Abstain lists.

The list of all full-council meeting dates (paginated, reliable):

```
https://www.portland.gov/council/agenda/all?committee=950&page=N
```

`committee=950` limits it to full City Council (no committees).

**Network:** the cloud environment must allow `www.portland.gov`. If fetches fail with an egress/proxy block, the user has to add that domain under Network access in the environment settings.

## What counts as "major"

**Skip:** board/commission appointments and reappointments, foreclosure-lien initiations, routine lawsuit/property-damage settlements, standard contract/procurement awards, Local Improvement District assessments, minutes approvals, and items only "passed to second reading" (log them on the date of the final vote instead, so nothing is counted twice).

**Include:** code amendments (Chapter/Title changes), resolutions, franchise/utility agreements, notable appropriations (large or contested), renamings/redesignations, budget items, and **any vote that isn't unanimous**, whatever its category.

When unsure, include it. Filtering out noise later is cheaper than re-fetching pages for missed items.

## `data/votes.csv` schema

```
date,doc_number,title,synopsis,type,action,theme,neighborhood,url,
Morillo,Avalos,Ryan,Pirtle-Guiney,Zimmerman,Dunphy,Smith,Green,Clark,Kanal,Novick,Koyama Lane
```

- **date**: `YYYY-MM-DD`, the date of the final vote.
- **doc_number**: the agenda's document number.
- **title**: the official title as shown on the agenda.
- **synopsis**: one or two plain-language sentences on what the item does. Written by Claude; keep it neutral and factual.
- **type**: `Ordinance`, `Emergency ordinance`, `Resolution` or `Report`.
- **action**: the "Council action" field copied word for word (Passed, Passed as amended, Failed to pass, Adopted, Adopted as amended, Postponed, Referred, …).
- **theme**: assigned by Claude, not an official City category. One or more of the fixed list below, separated by `; ` (e.g. `Public Safety; Transportation`). The list lives in `THEMES` in `scripts/add_votes.py` and both scripts enforce it; add a theme there only when nothing fits, and mention it to the user.
  - Housing · Homelessness · Public Safety · Transportation · Budget & Taxes · Environment & Energy · Economic Development · Land Use & Planning · Utilities (water, sewer, solid waste rates) · Parks & Recreation · Arts & Culture · Health & Social Services · Civil Rights & Equity · Business Regulation (rules for private businesses, e.g. rideshare, product bans) · Government Operations · Government Transparency
- **neighborhood**: from the agenda page's own "Neighborhood" tag(s), several separated by `; `. If it lists all six areas (North/South/Northeast/Northwest/Southeast/Southwest), use `Citywide`. If the page has no neighborhood tag, use `Not specified in agenda`. Never guess a neighborhood from the item's subject.
- **url**: the agenda page (or the item's own page) on portland.gov.
- **Mayor tie-breaks**: the Mayor votes only to break a 6–6 tie. There is no Mayor column; say so in the synopsis (e.g. "Mayor Wilson broke a 6–6 tie by voting Nay.") via the pick's `note`.
- **councilor columns**: `Yea`, `Nay`, `Absent` or `Abstain` (the agenda's "Aye" is recorded as "Yea"). Leave blank only if the page truly doesn't say.

Quote any field that contains a comma. Use Python's `csv` module to write rows rather than building lines by hand.

## How to work through the meetings

- `data/meetings.csv` lists every full-council meeting since the 12-member council's first meeting on Jan 2, 2025 (66 as of Sept 23, 2026; Nov 5, 2025 was cancelled). Use its `url` column rather than building URLs from dates: some differ (e.g. `2025/11/12-0`). Add new meetings from the `agenda/all` listing as they appear.
- Many meetings run over two or more days on one agenda page (e.g. "September 23-24, 2026"). In `votes.csv`, `date` is the day the vote happened when the page shows it, otherwise the meeting's first day.
- The listing pages sometimes return "The website encountered an unexpected error"; wait a few seconds and retry.
- For each meeting:
  1. `python3 scripts/parse_agenda.py <url> --json /tmp/m.json` prints every item with its type, final action, neighborhood and final vote (votes on amendments are ignored). It takes the votes straight from the page, so never retype them by hand.
  2. Decide which items are major, then write a picks file mapping each chosen document number to `{"synopsis": ..., "theme": ...}` (plus `note` for a Mayor tie-break).
  3. `python3 scripts/add_votes.py <meeting date> /tmp/m.json picks.json` appends the rows and marks the meeting done. Add `--in-progress` if the meeting hasn't finished yet (it stays pending and can be re-run for the remaining items later).
  4. `python3 scripts/validate_data.py`, then commit and push. Small commits mean nothing is lost if a session ends.
- An item "passed to second reading" gets its final vote at a later meeting, where it shows up as a "Second reading agenda item". Log it there.
- The user expects this to take several sessions. Don't apologize for the pace; report progress plainly.

## Progress

Working newest to oldest. `data/meetings.csv` is the source of truth; as of the last update:

- **Done:** every meeting from Jan 7 through Sept 16, 2026.
- **In progress:** Sept 23-24, 2026. Items 2026-277 and 2026-301 are logged; the rest (2026-278, 263 reconsideration, 186, 212, 300, 311, 312) had no final vote yet. Re-run it once the meeting is over; `add_votes.py` refuses duplicates.
- **Next up:** Dec 17, 2025, then back through the list to Jan 2, 2025.
- An earlier session (outside this repo) processed Sept 9-23 and lost its data; that work has been redone here.
- Known edge case: 2026-222 (July 22, 2026) failed 6-6 with Mayor Wilson breaking the tie by voting Nay. Log it with a `note`.
