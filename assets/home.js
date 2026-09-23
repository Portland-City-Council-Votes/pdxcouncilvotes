// Home page: explore votes by councilor or theme.

(function () {
  "use strict";

  const { loadAll, themeIcon, el, fmtDate, dataLink } = window.PCV;

  function renderStats(votes, motions) {
    const split = votes.filter((r) => r.split).length;
    const dates = votes.map((r) => r.date).sort();
    document.getElementById("stats").textContent = votes.length
      ? `${votes.length} final votes · ${split} split · ${motions.length} amendment and motion votes · ${fmtDate(dates[0], { month: "short", year: "numeric" })} to ${fmtDate(dates[dates.length - 1], { month: "short", year: "numeric" })}`
      : "No votes have been added yet.";
  }

  function renderCouncilors(votes, councilors) {
    const root = document.getElementById("councilors");
    const byDistrict = new Map();
    councilors.forEach((c) => {
      const key = c.district || "Other";
      if (!byDistrict.has(key)) byDistrict.set(key, []);
      byDistrict.get(key).push(c);
    });
    byDistrict.forEach((list, district) => {
      root.append(el("div", { class: "district" },
        el("h3", {}, typeof district === "number" ? `District ${district}` : district),
        el("ul", { class: "people" }, list.map((c) => {
          const nays = votes.filter((r) => r[c.name] === "Nay").length;
          return el("li", {},
            el("a", { class: "person", href: dataLink("councilor", c.name) },
              c.photo ? el("img", { src: c.photo, alt: "", width: "128", height: "128", loading: "lazy" }) : null,
              el("span", { class: "person-name" }, c.full_name),
              el("span", { class: "person-meta" }, `${nays} Nay vote${nays === 1 ? "" : "s"}`)));
        }))
      ));
    });
  }

  function renderThemes(votes, motions) {
    const count = (list) => {
      const m = new Map();
      list.forEach((r) => r.themes.forEach((t) => m.set(t, (m.get(t) || 0) + 1)));
      return m;
    };
    const finals = count(votes);
    const extra = count(motions);
    const root = document.getElementById("themes");
    [...finals.entries()].sort((a, b) => b[1] - a[1]).forEach(([theme, n]) => {
      const m = extra.get(theme) || 0;
      const href = "data.html#" + new URLSearchParams(m ? { theme, show: "all" } : { theme }).toString();
      root.append(el("a", { class: "theme-card", href },
        el("span", { class: "theme-icon", html: themeIcon(theme, 32) }),
        el("span", { class: "theme-name" }, theme),
        el("span", { class: "theme-count" }, `${n} final vote${n === 1 ? "" : "s"}` + (m ? ` · ${m} on amendments/motions` : ""))));
    });
  }

  async function load() {
    let data;
    try {
      data = await loadAll();
    } catch (err) {
      document.getElementById("stats").textContent = "Couldn't load the vote data (" + err.message + ").";
      return;
    }
    renderStats(data.votes, data.motions);
    renderCouncilors(data.votes, data.councilors);
    renderThemes(data.votes, data.motions);
  }

  load();
})();
