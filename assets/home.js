// Home page: explore votes by councilor, neighborhood map, or theme.

(function () {
  "use strict";

  const { loadAll, fetchJSON, hoodKey, themeIcon, el, fmtDate, dataLink } = window.PCV;
  const WIDE = ["Citywide", "Not specified in agenda"];
  const SVG_NS = "http://www.w3.org/2000/svg";

  function renderStats(votes) {
    const split = votes.filter((r) => r.split).length;
    const dates = votes.map((r) => r.date).sort();
    document.getElementById("stats").textContent = votes.length
      ? `${votes.length} votes · ${split} split votes · ${fmtDate(dates[0], { month: "short", year: "numeric" })} to ${fmtDate(dates[dates.length - 1], { month: "short", year: "numeric" })}`
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
              c.photo ? el("img", { src: c.photo, alt: "", width: "96", height: "96", loading: "lazy" }) : null,
              el("span", { class: "person-name" }, c.full_name),
              el("span", { class: "person-meta" }, `${nays} Nay vote${nays === 1 ? "" : "s"}`)));
        }))
      ));
    });
  }

  function renderThemes(votes) {
    const counts = new Map();
    votes.forEach((r) => r.themes.forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    const root = document.getElementById("themes");
    [...counts.entries()].sort((a, b) => b[1] - a[1]).forEach(([theme, n]) => {
      root.append(el("a", { class: "theme-card", href: dataLink("theme", theme) },
        el("span", { class: "theme-icon", html: themeIcon(theme, 32) }),
        el("span", { class: "theme-name" }, theme),
        el("span", { class: "theme-count" }, `${n} vote${n === 1 ? "" : "s"}`)));
    });
  }

  // Simple equirectangular projection; fine at city scale.
  function projector(features, width) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const walk = (c, fn) => (typeof c[0] === "number" ? fn(c) : c.forEach((x) => walk(x, fn)));
    features.forEach((f) => walk(f.geometry.coordinates, ([x, y]) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }));
    const k = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
    const scale = width / ((maxX - minX) * k);
    const height = (maxY - minY) * scale;
    return { width, height, project: ([x, y]) => [((x - minX) * k * scale).toFixed(1), ((maxY - y) * scale).toFixed(1)] };
  }

  function pathFor(geometry, project) {
    const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polys.map((rings) => rings.map((ring) =>
      "M" + ring.map((pt) => project(pt).join(",")).join("L") + "Z").join("")).join("");
  }

  async function renderMap(votes) {
    const counts = new Map();
    const labels = new Map();
    votes.forEach((r) => r.neighborhoods.forEach((n) => {
      counts.set(n, (counts.get(n) || 0) + 1);
    }));

    const wide = document.getElementById("map-wide");
    WIDE.forEach((name) => {
      const n = counts.get(name) || 0;
      wide.append(el("a", { class: "wide-link", href: dataLink("neighborhood", name) },
        el("strong", {}, n), " ", name === "Citywide" ? "citywide items" : "items not tagged to an area"));
    });

    const named = [...counts.entries()].filter(([n]) => !WIDE.includes(n)).sort((a, b) => a[0].localeCompare(b[0]));
    const list = document.getElementById("hood-list");
    named.forEach(([name, n]) => list.append(el("li", {},
      el("a", { href: dataLink("neighborhood", name) }, name), el("span", { class: "count" }, ` ${n}`))));

    let geo;
    try {
      geo = await fetchJSON("assets/neighborhoods.json");
    } catch (err) {
      document.getElementById("map").replaceWith(el("p", { class: "empty" }, "The map couldn't load. Use the neighborhood list instead."));
      return;
    }
    named.forEach(([name]) => labels.set(hoodKey(name), name));
    const max = Math.max(1, ...named.map(([, n]) => n));
    const svg = document.getElementById("map");
    const { width, height, project } = projector(geo.features, 800);
    svg.setAttribute("viewBox", `0 0 ${width} ${Math.ceil(height)}`);
    const tip = document.getElementById("map-tip");

    // Shared areas overlap two neighborhoods; draw them first so the named ones sit on top.
    const features = geo.features.slice().sort((a, b) => b.properties.shared - a.properties.shared);
    features.forEach((f) => {
      const dataName = labels.get(hoodKey(f.properties.name));
      const n = dataName ? counts.get(dataName) : 0;
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", pathFor(f.geometry, project));
      path.setAttribute("class", "hood" + (n ? " has-votes" : ""));
      if (n) path.style.setProperty("--level", (0.35 + 0.65 * (n / max)).toFixed(2));
      if (f.properties.shared) path.classList.add("shared");
      const label = `${f.properties.name}: ${n ? `${n} vote${n === 1 ? "" : "s"}` : "no tagged votes"}`;
      const title = document.createElementNS(SVG_NS, "title");
      title.textContent = label;
      path.append(title);
      let node = path;
      if (n) {
        const a = document.createElementNS(SVG_NS, "a");
        a.setAttribute("href", dataLink("neighborhood", dataName));
        a.setAttribute("aria-label", label);
        a.append(path);
        node = a;
      }
      path.addEventListener("mousemove", (e) => {
        tip.hidden = false;
        tip.textContent = label;
        const box = svg.getBoundingClientRect();
        tip.style.left = `${e.clientX - box.left + 12}px`;
        tip.style.top = `${e.clientY - box.top + 12}px`;
      });
      path.addEventListener("mouseleave", () => { tip.hidden = true; });
      svg.append(node);
    });
  }

  function renderNews(votes) {
    const items = votes.flatMap((r) => r.news.map((n) => ({ ...n, vote: r })))
      .sort((a, b) => b.vote.date.localeCompare(a.vote.date)).slice(0, 8);
    if (!items.length) return;
    document.getElementById("news-section").hidden = false;
    document.getElementById("news").append(...items.map((n) => el("li", {},
      el("a", { href: n.url, target: "_blank", rel: "noopener" }, n.headline),
      el("span", { class: "outlet" }, ` — ${n.outlet}`),
      el("p", { class: "meta" }, "About: ",
        el("a", { href: dataLink("q", n.vote.doc_number) }, n.vote.title), ` (${fmtDate(n.vote.date)})`))));
  }

  async function load() {
    let data;
    try {
      data = await loadAll();
    } catch (err) {
      document.getElementById("stats").textContent = "Couldn't load the vote data (" + err.message + ").";
      return;
    }
    renderStats(data.votes);
    renderCouncilors(data.votes, data.councilors);
    renderThemes(data.votes);
    renderNews(data.votes);
    renderMap(data.votes);
  }

  load();
})();
