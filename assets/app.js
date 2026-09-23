// Portland Council Votes: loads data/votes.csv and filters it in the browser.
// Councilor columns are every column after `url`, so the page follows the CSV header.

(function () {
  "use strict";

  const DATA_URL = "data/votes.csv";
  const FIRST_VOTE_COLUMN = "url";
  const VOTE_ABBR = { Yea: "Y", Nay: "N", Absent: "A", Abstain: "Ab" };
  const FILTER_IDS = ["q", "theme", "neighborhood", "councilor", "vote", "sort", "contested"];

  const els = Object.fromEntries(
    FILTER_IDS.concat(["filters", "results", "summary"]).map((id) => [id, document.getElementById(id)])
  );

  let rows = [];
  let councilors = [];

  // RFC 4180 CSV parser: quoted fields, escaped quotes, newlines inside quotes.
  function parseCSV(text) {
    const out = [];
    let row = [];
    let field = "";
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); out.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); out.push(row); }
    return out.filter((r) => r.some((v) => v.trim() !== ""));
  }

  // Themes and neighborhoods may hold several values separated by semicolons.
  const splitList = (value) => value.split(";").map((s) => s.trim()).filter(Boolean);

  function toRecords(table) {
    const [header, ...body] = table;
    const start = header.indexOf(FIRST_VOTE_COLUMN) + 1;
    councilors = header.slice(start);
    return body.map((cells) => {
      const r = Object.fromEntries(header.map((h, i) => [h, (cells[i] || "").trim()]));
      r.themes = splitList(r.theme);
      r.neighborhoods = splitList(r.neighborhood);
      r.votes = councilors.map((name) => ({ name, vote: r[name] }));
      r.tally = { Yea: 0, Nay: 0, Absent: 0, Abstain: 0 };
      r.votes.forEach((v) => { if (v.vote in r.tally) r.tally[v.vote]++; });
      r.split = r.tally.Yea > 0 && r.tally.Nay > 0;
      r.haystack = [r.title, r.synopsis, r.doc_number, r.action].join(" ").toLowerCase();
      return r;
    });
  }

  function fillSelect(select, values) {
    values.forEach((v) => select.add(new Option(v, v)));
  }

  function uniqueSorted(lists) {
    return [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));
  }

  function readFilters() {
    return {
      q: els.q.value.trim().toLowerCase(),
      theme: els.theme.value,
      neighborhood: els.neighborhood.value,
      councilor: els.councilor.value,
      vote: els.vote.value,
      sort: els.sort.value,
      contested: els.contested.checked,
    };
  }

  function matches(r, f) {
    if (f.q && !r.haystack.includes(f.q)) return false;
    if (f.theme && !r.themes.includes(f.theme)) return false;
    if (f.neighborhood && !r.neighborhoods.includes(f.neighborhood)) return false;
    if (f.contested && !r.split) return false;
    if (f.vote) {
      const pool = f.councilor ? r.votes.filter((v) => v.name === f.councilor) : r.votes;
      if (!pool.some((v) => v.vote === f.vote)) return false;
    }
    return true;
  }

  // Keep filters in the URL hash so a filtered view can be shared as a link.
  function writeHash(f) {
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => {
      if (k === "q") v = els.q.value.trim();
      if (k === "sort" && v === "newest") return;
      if (v === true) params.set(k, "1");
      else if (v) params.set(k, v);
    });
    const hash = params.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function readHash() {
    const params = new URLSearchParams(location.hash.slice(1));
    FILTER_IDS.forEach((id) => {
      if (!params.has(id)) return;
      const el = els[id];
      if (el.type === "checkbox") el.checked = params.get(id) === "1";
      else if (el.tagName === "SELECT" && ![...el.options].some((o) => o.value === params.get(id))) return;
      else el.value = params.get(id);
    });
  }

  const fmtDate = (iso) => {
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  };

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else node.setAttribute(k, v);
    });
    children.flat().forEach((c) => { if (c != null && c !== "") node.append(c); });
    return node;
  }

  function tallyText(t) {
    const parts = [`${t.Yea}–${t.Nay}`];
    if (t.Absent) parts.push(`${t.Absent} absent`);
    if (t.Abstain) parts.push(`${t.Abstain} abstain`);
    return parts.join(", ");
  }

  function renderRow(r, focus) {
    const item = el("td", { class: "c-item" },
      el("a", { href: r.url, class: "item-title", target: "_blank", rel: "noopener" }, r.title),
      r.synopsis ? el("p", { class: "synopsis" }, r.synopsis) : null,
      el("p", { class: "meta" }, [r.doc_number, r.type, r.action].filter(Boolean).join(" · "))
    );
    const tags = (list, cls) => list.map((t) => el("span", { class: "tag " + cls }, t));
    const cells = [
      el("td", { class: "c-date" }, el("time", { datetime: r.date }, fmtDate(r.date))),
      item,
      el("td", { class: "c-tags" }, tags(r.themes, "tag-theme"), tags(r.neighborhoods, "tag-place")),
      el("td", { class: "c-tally" + (r.split ? " is-split" : "") }, tallyText(r.tally)),
    ];
    r.votes.forEach((v) => {
      const cls = "v v-" + (v.vote || "none").toLowerCase() + (focus === v.name ? " is-focus" : "");
      cells.push(el("td", { class: cls, "data-name": v.name, title: `${v.name}: ${v.vote || "no vote recorded"}` },
        el("span", { "aria-hidden": "true" }, VOTE_ABBR[v.vote] || "–"),
        el("span", { class: "sr-only" }, v.vote || "no vote recorded")
      ));
    });
    return el("tr", { class: r.split ? "is-split" : "" }, cells);
  }

  function render() {
    const f = readFilters();
    writeHash(f);
    const list = rows.filter((r) => matches(r, f));
    list.sort((a, b) => (f.sort === "oldest" ? 1 : -1) * a.date.localeCompare(b.date));

    const total = rows.length;
    els.summary.textContent = total
      ? `Showing ${list.length} of ${total} votes.`
      : "No votes have been added yet. Data collection is in progress.";

    els.results.replaceChildren();
    if (!total) return;
    if (!list.length) {
      els.results.append(el("p", { class: "empty" }, "No votes match these filters."));
      return;
    }

    const head = el("tr", {},
      el("th", { scope: "col", class: "c-date" }, "Date"),
      el("th", { scope: "col", class: "c-item" }, "Item"),
      el("th", { scope: "col", class: "c-tags" }, "Theme / Area"),
      el("th", { scope: "col", class: "c-tally" }, "Yea–Nay"),
      councilors.map((name) => el("th", { scope: "col", class: "v-head" + (f.councilor === name ? " is-focus" : "") },
        el("span", {}, name)))
    );
    const table = el("table", { class: "votes" },
      el("caption", { class: "sr-only" }, "Council votes, one row per item, one column per councilor"),
      el("thead", {}, head),
      el("tbody", {}, list.map((r) => renderRow(r, f.councilor)))
    );
    els.results.append(el("div", { class: "table-scroll", tabindex: "0", role: "region", "aria-label": "Votes table" }, table));
  }

  async function load() {
    try {
      const res = await fetch(DATA_URL, { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status + " " + res.statusText);
      rows = toRecords(parseCSV(await res.text()));
    } catch (err) {
      els.summary.textContent = "Couldn't load the vote data (" + err.message + ").";
      return;
    }
    fillSelect(els.theme, uniqueSorted(rows.map((r) => r.themes)));
    fillSelect(els.neighborhood, uniqueSorted(rows.map((r) => r.neighborhoods)));
    fillSelect(els.councilor, councilors);
    readHash();
    render();
  }

  els.filters.addEventListener("input", render);
  els.filters.addEventListener("submit", (e) => e.preventDefault());
  els.filters.addEventListener("reset", () => setTimeout(render));
  load();
})();
