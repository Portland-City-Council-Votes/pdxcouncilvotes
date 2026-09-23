// Full data page: every vote in a filterable table.
// Filters live in the URL hash so the home page (and anyone) can link to a filtered view.

(function () {
  "use strict";

  const { loadAll, el, fmtDate } = window.PCV;
  const VOTE_ABBR = { Yea: "Y", Nay: "N", Absent: "A", Abstain: "Ab" };
  const FILTER_IDS = ["q", "theme", "neighborhood", "councilor", "vote", "sort", "contested"];

  const els = Object.fromEntries(
    FILTER_IDS.concat(["filters", "results", "summary", "banner"]).map((id) => [id, document.getElementById(id)])
  );

  let rows = [];
  let councilors = [];

  function fillSelect(select, options) {
    options.forEach(([value, label]) => select.add(new Option(label, value)));
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
      const node = els[id];
      if (!params.has(id)) {
        if (node.type === "checkbox") node.checked = false;
        else node.value = id === "sort" ? "newest" : "";
        return;
      }
      if (node.type === "checkbox") node.checked = params.get(id) === "1";
      else if (node.tagName === "SELECT" && ![...node.options].some((o) => o.value === params.get(id))) return;
      else node.value = params.get(id);
    });
  }

  function tallyText(t) {
    const parts = [`${t.Yea}–${t.Nay}`];
    if (t.Absent) parts.push(`${t.Absent} absent`);
    if (t.Abstain) parts.push(`${t.Abstain} abstain`);
    return parts.join(", ");
  }

  function renderBanner(f) {
    const c = councilors.find((x) => x.name === f.councilor);
    els.banner.hidden = !c;
    els.banner.replaceChildren();
    if (!c) return;
    const counts = { Yea: 0, Nay: 0, Absent: 0, Abstain: 0 };
    let dissent = 0;
    rows.forEach((r) => {
      const v = r[c.name];
      if (v in counts) counts[v]++;
      // Voted against the outcome: Nay on something that passed, or Yea on something that failed.
      const passed = r.tally.Yea > r.tally.Nay;
      if ((v === "Nay" && passed) || (v === "Yea" && !passed && r.tally.Nay > 0)) dissent++;
    });
    els.banner.append(
      c.photo ? el("img", { src: c.photo, alt: "", width: "72", height: "72" }) : null,
      el("div", {},
        el("h2", {}, c.full_name),
        el("p", { class: "meta" }, c.district ? `District ${c.district} councilor` : "",
          c.profile ? [" · ", el("a", { href: c.profile, target: "_blank", rel: "noopener" }, "City profile")] : null),
        el("p", {}, `${counts.Yea} Yea · ${counts.Nay} Nay · ${counts.Absent} absent · ${counts.Abstain} abstain across ${rows.length} votes. ` +
          `On the losing side ${dissent} time${dissent === 1 ? "" : "s"}.`)
      )
    );
  }

  function renderRow(r, focus) {
    const item = el("td", { class: "c-item" },
      el("a", { href: r.url, class: "item-title", target: "_blank", rel: "noopener" }, r.title),
      r.synopsis ? el("p", { class: "synopsis" }, r.synopsis) : null,
      el("p", { class: "meta" }, [r.doc_number, r.type, r.action].filter(Boolean).join(" · ")),
      r.news.length ? el("ul", { class: "news" },
        r.news.map((n) => el("li", {},
          el("a", { href: n.url, target: "_blank", rel: "noopener" }, n.headline),
          el("span", { class: "outlet" }, " — " + n.outlet)))) : null
    );
    const tags = (list, cls) => list.map((t) => el("span", { class: "tag " + cls }, t));
    const cells = [
      el("td", { class: "c-date" }, el("time", { datetime: r.date }, fmtDate(r.date))),
      item,
      el("td", { class: "c-tags" }, tags(r.themes, "tag-theme"), tags(r.neighborhoods, "tag-place")),
      el("td", { class: "c-tally" + (r.split ? " is-split" : "") }, tallyText(r.tally)),
    ];
    r.votes.forEach((v, i) => {
      const c = councilors[i];
      const label = c.district ? `${v.name} (D${c.district})` : v.name;
      const first = i === 0 || councilors[i - 1].district !== c.district;
      const cls = "v v-" + (v.vote || "none").toLowerCase() + (focus === v.name ? " is-focus" : "") + (first ? " d-start" : "");
      cells.push(el("td", { class: cls, "data-name": label, title: `${label}: ${v.vote || "no vote recorded"}` },
        el("span", { "aria-hidden": "true" }, VOTE_ABBR[v.vote] || "–"),
        el("span", { class: "sr-only" }, v.vote || "no vote recorded")
      ));
    });
    return el("tr", { class: r.split ? "is-split" : "" }, cells);
  }

  function render() {
    const f = readFilters();
    writeHash(f);
    renderBanner(f);
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

    // Councilors are ordered by district; mark where each district starts.
    const head = el("tr", {},
      el("th", { scope: "col", class: "c-date" }, "Date"),
      el("th", { scope: "col", class: "c-item" }, "Item"),
      el("th", { scope: "col", class: "c-tags" }, "Theme / Area"),
      el("th", { scope: "col", class: "c-tally" }, "Yea–Nay"),
      councilors.map((c, i) => {
        const first = i === 0 || councilors[i - 1].district !== c.district;
        return el("th", { scope: "col", class: "v-head" + (f.councilor === c.name ? " is-focus" : "") + (first ? " d-start" : "") },
          el("span", { class: "v-name" }, c.name),
          c.district ? el("span", { class: "v-district" }, "D" + c.district) : null);
      })
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
      ({ votes: rows, councilors } = await loadAll());
    } catch (err) {
      els.summary.textContent = "Couldn't load the vote data (" + err.message + ").";
      return;
    }
    fillSelect(els.theme, uniqueSorted(rows.map((r) => r.themes)).map((t) => [t, t]));
    fillSelect(els.neighborhood, uniqueSorted(rows.map((r) => r.neighborhoods)).map((n) => [n, n]));
    fillSelect(els.councilor, councilors.map((c) => [c.name, c.district ? `${c.full_name} (District ${c.district})` : c.full_name]));
    readHash();
    render();
  }

  els.filters.addEventListener("input", render);
  els.filters.addEventListener("submit", (e) => e.preventDefault());
  els.filters.addEventListener("reset", () => setTimeout(render));
  window.addEventListener("hashchange", () => { readHash(); render(); });
  load();
})();
