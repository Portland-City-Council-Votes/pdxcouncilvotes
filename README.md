# Portland Council Votes

A searchable record of how each member of Portland's 12-member City Council has voted on major items since the expanded council took office in January 2025. Filter by theme, neighborhood, councilor, or split votes only.

It's a static site with no build step: `index.html` loads `data/votes.csv` and does all filtering in the browser.

## Preview locally

```sh
python3 -m http.server
```

Then open http://localhost:8000. Opening `index.html` directly from disk won't work, because browsers block loading the CSV from a `file://` page.

## Publish with GitHub Pages

In the repository's **Settings → Pages**, set the source to **Deploy from a branch**, pick the branch and `/ (root)`, and save.

## Data

- `data/votes.csv`: one row per major agenda item, with each councilor's vote.
- `data/meetings.csv`: which meetings have been processed.

The data comes from the official meeting agendas at [portland.gov/council](https://www.portland.gov/council/agenda/all?committee=950). Synopses, themes and the choice of which items count as "major" are editorial calls, not official City categories. See [CLAUDE.md](CLAUDE.md) for the schema and the rules for what gets included.

Check the data before committing:

```sh
python3 scripts/validate_data.py
```
