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
| `index.html`, `assets/home.js` | Home page: explore by councilor (photos) or theme; links into the data page with filters in the URL hash. (A neighborhood map was removed at the user's request: most items aren't tied to a neighborhood.) |
| `data.html`, `assets/data.js` | Full table of every vote ("View all data"), frozen header row, councilors ordered by district. |
| `budget.html`, `assets/budget.js`, `data/budget.json` | Budget breakdown page: headline figures, spending and revenue by category for each adopted budget, and the council's budget votes. Every figure in `budget.json` cites its budget-book page; add a new year the same way (check each number appears on the cited page). |
| `assets/districts.json` | Official City Council district boundaries (portlandmaps.com `COP_OpenData_Boundary/MapServer/1413`). Rebuilt from the Esri JSON rings (outer rings clockwise, holes counter-clockwise), because that server's GeoJSON output turns part of District 4 inside out. The home page's address box sends the typed address to OpenStreetMap Nominatim (from the visitor's browser, bounded to the Portland area), then tests the point against these polygons. |
| `assets/common.js`, `assets/style.css` | Shared data loading, theme icons and styles. |
| `assets/councilors.json`, `assets/councilors/` | Councilor names, districts, official City portraits (from portland.gov/council), and `next_election` for seats on the Nov. 3, 2026 ballot (Districts 3 and 4, per portland.gov: they served two-year terms). The home page rings those seats in red. **After the Nov. 2026 election:** update names/photos for any new councilors, move `next_election` to Districts 1 and 2 (2028), and update the votes.csv/motions.csv councilor columns. |
| `data/motions.csv` | Every other recorded roll call (amendments, Budget Committee approvals, procedural motions, consent agendas). Generated; never edit by hand. |
| `data/motion_parents.json`, `data/motion_themes.json` | Themes for motion parents that aren't in votes.csv, and extra subject themes for individual budget motions. |
| `data/news.csv` | News coverage linked to voted items: `doc_number,outlet,headline,url,image`. Shown as thumbnails beside the vote in the table (not on the home page, per the user). `image` is the article's og:image, filled by `scripts/fetch_news_images.py` (needs the news sites reachable); blank shows an outlet tile. |
| `data/votes.csv` | The dataset, one row per major agenda item with a final vote. |
| `data/meetings.csv` | Progress tracker, one row per meeting: date, agenda URL, `pending`/`done`/`cancelled`, items logged, notes. |
| `scripts/parse_agenda.py`, `scripts/add_votes.py` | Read an agenda page into structured items; append chosen items to the CSVs. See "How to work through the meetings". |
| `scripts/validate_data.py` | Schema check for both CSVs. Run `python3 scripts/validate_data.py` before every commit that touches `data/`; CI runs it too. |

**Cache busting:** the HTML pages load `assets/*.css`/`*.js` with a `?v=…` tag. GitHub Pages lets browsers cache those for 10 minutes, so bump the tag in all three HTML files whenever you change a CSS or JS file.

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

**Settlements:** include a lawsuit settlement only if it is $1 million or more, or the vote was split.

**Include:** code amendments (Chapter/Title changes), resolutions, franchise/utility agreements, notable appropriations (large or contested), renamings/redesignations, budget items, and **any vote that isn't unanimous**, whatever its category.

When unsure, include it. Filtering out noise later is cheaper than re-fetching pages for missed items.

## `data/motions.csv`

Built by `scripts/build_motions.py` from the notes on every agenda page: any line with a roll call like `(Aye (8): …; Nay (4): …)` that isn't the item's final "Votes" block. Columns: `date,doc_number,seq,item,kind,motion,note,theme,neighborhood,url` + councilors. `kind` is Amendment, Procedural or Motion (from the text). `motion` is quoted verbatim. Session-level roll calls (consent agenda, recesses) are filed under "Meeting business".

The City's minutes have typos; the script handles them openly: merged names ("Ryan Zimmerman") are split, a councilor listed on both sides is left blank with a `note`, and count mismatches get a `note`. Amendment subjects usually live in the item's amendment PDFs on efiles.portlandoregon.gov (reachable once that domain is allowed). To find them: the agenda item's title links to its portland.gov document page, which links to an efiles record; that record's container (`efiles.portlandoregon.gov/record?q=recContainer%3A<id>`) lists exhibits and "additional documents", and the amendments (e.g. "Kanal 1") are usually in "additional documents" (`/record/<id>/file/document`). Tag each amendment vote in `data/motion_themes.json` with the theme its document supports and a `basis` citing the page. Amendments with no document (e.g. Smith 2 on 2026-120) keep only the parent's themes. `data/motion_parents.json` can give an item a narrower base theme for its motions when the item's own themes don't fit every vote under it.

## `data/news.csv` rules

- Only link articles actually found (search results or the page itself) that are clearly about that item and vote. Never guess a URL or headline.
- Use the article's own headline and the outlet's name.
- **OregonLive URLs must end with `?outputType=amp`** (the validator enforces this).

## `data/votes.csv` schema

```
date,doc_number,title,synopsis,type,action,theme,neighborhood,url,
Morillo,Avalos,Ryan,Pirtle-Guiney,Zimmerman,Dunphy,Smith,Green,Clark,Kanal,Novick,Koyama Lane
```

- **date**: `YYYY-MM-DD`, the date of the final vote.
- **doc_number**: the agenda's document number.
- **title**: the official title as shown on the agenda.
- **synopsis**: one or two plain-language sentences on what the item does. Written by Claude; keep it neutral and say only what the agenda page supports (its title, fields and notes). No outside knowledge, examples or inferred motives: a Sept 2026 check had to strip claims like "such as foie gras" and "rather than staff".
- **type**: `Ordinance`, `Emergency ordinance`, `Resolution` or `Report`.
- **action**: the "Council action" field copied word for word (Passed, Passed as amended, Failed to pass, Adopted, Adopted as amended, Postponed, Referred, …).
- **theme**: assigned by Claude, not an official City category. One or more of the fixed list below, separated by `; ` (e.g. `Public Safety; Transportation`). The list lives in `THEMES` in `scripts/add_votes.py` and both scripts enforce it; add a theme there only when nothing fits, and mention it to the user.
  - FY Budget (the annual budget process: approval, adoption, levies, supplemental budgets, technical adjustments and their amendments; always paired with the subject theme when the text names one) · Housing · Homelessness · Public Safety · Transportation · Budget & Taxes · Environment & Energy · Economic Development · Land Use & Planning · Utilities (water, sewer, solid waste rates) · Parks & Recreation · Arts & Culture · Health & Social Services · Civil Rights & Equity · Business Regulation (rules for private businesses, e.g. rideshare, product bans) · Government Operations · Government Transparency
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
  4. `python3 scripts/build_motions.py` (from `scripts/`) to regenerate `data/motions.csv`; add a theme to `data/motion_parents.json` if it asks.
  5. `python3 scripts/validate_data.py`, then commit and push. Small commits mean nothing is lost if a session ends.
- An item "passed to second reading" gets its final vote at a later meeting, where it shows up as a "Second reading agenda item". Log it there.
- The user expects this to take several sessions. Don't apologize for the pace; report progress plainly.

## Daily bot runs

A scheduled Claude routine runs this once a day in a fresh cloud session. It never publishes directly: it opens (or updates) a pull request that the owner reviews and merges.

1. **Setup.** Work in a clone of `Portland-City-Council-Votes/pdxcouncilvotes`, on a branch `bot/updates`. If a pull request from `bot/updates` is already open, check that branch out and merge the live branch (`claude/workspace-recent-artifact-rywb4a`) into it; otherwise create `bot/updates` fresh from the live branch. Never push to the live branch, never force-push, never merge the pull request.
2. **New meetings.** Read `agenda/all?committee=950` pages 0 and 1 and add any meeting missing from `data/meetings.csv` as `pending` (mark "Cancelled" ones `cancelled`).
3. **Process meetings.** For every `pending` meeting with a date on or before today, follow "How to work through the meetings": parse, pick the major items, write synopses and themes by the rules above, `add_votes.py`. Use `--in-progress` only while the meeting has days still to come; once its last day has passed, mark it done (items continued to later meetings get logged there).
4. **Motions.** Run `scripts/build_motions.py`; add themes to `data/motion_parents.json` if it asks, and subject themes to `data/motion_themes.json` for named budget amendments (see the `data/motions.csv` section).
5. **News.** Coverage often appears days after a vote, so search for news about every item in `data/votes.csv` dated within the last 14 days (not just today's additions), plus any item newly added. Add only articles clearly about that item and vote, following the `data/news.csv` rules and skipping links already in the file (OPB, Willamette Week, Portland Mercury, KGW, KOIN, KPTV, KATU, Portland Tribune, Street Roots and OregonLive are the usual outlets; OregonLive links need `?outputType=amp`). Then run `scripts/fetch_news_images.py`.
6. **Check.** `python3 scripts/validate_data.py` must pass. Update the Progress section below. Bump the `?v=` tag only if CSS/JS changed.
7. **Publish for review.** If nothing changed, stop without committing. Otherwise commit, push `bot/updates`, and open or update the pull request into the live branch, titled "Council votes update" with the meeting dates. The body lists each new item (date, document number, title, action, Yea–Nay), its themes, every judgment call (items skipped and why, anything uncertain), and anything that needs the owner's decision.

## Progress

`data/meetings.csv` is the source of truth. As of Sept 23, 2026:

- **Done:** every meeting from Jan 2, 2025 through Sept 16, 2026 (64 meetings, 199 major items, 69 of them split votes).
- **Motions:** 338 roll calls across all 65 held meetings (Jan 2025 - Sept 2026) are in `data/motions.csv`.
- **In progress:** Sept 23-24, 2026. Items 2026-277 and 2026-301 are logged; the rest (2026-278, 263 reconsideration, 186, 212, 300, 311, 312) had no final vote yet. Re-run it once the meeting is over; `add_votes.py` refuses duplicates.
- **Ongoing:** add new meetings from the `agenda/all` listing as they happen.
- Mayor tie-break so far: 2026-222 (July 22, 2026), logged with a note in its synopsis.
- 2025-207 (June 4, 2025) was a vote to remand the Children's Levy recommendations; Yea means "send it back". The synopsis says so.
