// Home page: explore votes by councilor or theme.

(function () {
  "use strict";

  const { loadAll, fetchJSON, themeIcon, el, fmtDate, dataLink } = window.PCV;

  function renderStats(votes, motions) {
    const split = votes.filter((r) => r.split).length;
    const dates = votes.map((r) => r.date).sort();
    document.getElementById("stats").textContent = votes.length
      ? `${votes.length} final votes · ${split} split · ${motions.length} amendment and motion votes · ${fmtDate(dates[0], { month: "short", year: "numeric" })} to ${fmtDate(dates[dates.length - 1], { month: "short", year: "numeric" })}`
      : "No votes have been added yet.";
  }

  // Districts 3 and 4 were elected to two-year terms in 2024, so their seats are on the
  // November 3, 2026 ballot (portland.gov/transition/advisory/questions/city-council-elections).
  function renderCouncilors(votes, councilors) {
    const root = document.getElementById("councilors");
    const byDistrict = new Map();
    councilors.forEach((c) => {
      const key = c.district || "Other";
      if (!byDistrict.has(key)) byDistrict.set(key, []);
      byDistrict.get(key).push(c);
    });
    byDistrict.forEach((list, district) => {
      const up = list.some((c) => c.next_election);
      root.append(el("div", { class: "district" + (up ? " is-up" : ""), "data-district": district, tabindex: "-1" },
        el("h3", {}, typeof district === "number" ? `District ${district}` : district,
          up ? el("span", { class: "up-tag" }, "On the ballot Nov. 3") : null),
        el("ul", { class: "people" }, list.map((c) => {
          const label = c.next_election ? `${c.full_name}, seat up for election ${fmtDate(c.next_election)}` : c.full_name;
          return el("li", {},
            el("a", { class: "person" + (c.next_election ? " is-up" : ""), href: dataLink("councilor", c.name), "aria-label": `${label}: see every vote` },
              c.photo ? el("img", { src: c.photo, alt: "", width: "150", height: "150", loading: "lazy" }) : null,
              el("span", { class: "person-name" }, c.full_name)));
        }))
      ));
    });
  }

  // Point-in-polygon (ray casting) on [lon, lat] rings; holes are the rings after the first.
  function inRing(pt, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeometry(pt, geom) {
    const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
    return polys.some(([outer, ...holes]) => inRing(pt, outer) && !holes.some((h) => inRing(pt, h)));
  }

  // Address -> location via OpenStreetMap Nominatim (limited to the Portland area), then -> district.
  function setupDistrictFinder() {
    const form = document.getElementById("find-district");
    const input = document.getElementById("address");
    const out = document.getElementById("find-result");
    let districts = null;

    const highlight = (d) => {
      document.querySelectorAll(".district").forEach((box) => {
        const mine = String(box.dataset.district) === String(d);
        box.classList.toggle("is-mine", mine);
        const tag = box.querySelector(".mine-tag");
        if (mine && !tag) box.querySelector("h3").append(el("span", { class: "mine-tag" }, "Your district"));
        if (!mine && tag) tag.remove();
      });
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const address = input.value.trim();
      if (!address) return;
      out.className = "find-result";
      out.textContent = "Looking up that address…";
      highlight(null);
      try {
        if (!districts) districts = await fetchJSON("assets/districts.json");
        const q = /portland|oregon|\bor\b|\b97\d{3}\b/i.test(address) ? address : `${address}, Portland, Oregon`;
        const url = "https://nominatim.openstreetmap.org/search?" + new URLSearchParams({
          q, format: "jsonv2", limit: "1", countrycodes: "us",
          viewbox: "-122.95,45.72,-122.30,45.35", bounded: "1",
        });
        const res = await fetch(url, { headers: { "Accept-Language": "en" } });
        if (!res.ok) throw new Error(`address search failed (${res.status})`);
        const [hit] = await res.json();
        if (!hit) {
          out.classList.add("is-error");
          out.textContent = "Couldn't find that address in the Portland area. Try adding the street type (St, Ave) and direction (NE, SE…).";
          return;
        }
        const pt = [parseFloat(hit.lon), parseFloat(hit.lat)];
        const match = districts.features.find((f) => inGeometry(pt, f.geometry));
        const found = address;
        if (!match) {
          out.classList.add("is-error");
          out.textContent = `${found} looks to be outside Portland city limits, so it isn't in a City Council district.`;
          return;
        }
        const d = match.properties.district;
        out.classList.add("is-found");
        out.replaceChildren(`${found} is in `, el("strong", {}, `District ${d}`), ". Its three councilors are highlighted below.");
        highlight(d);
        const box = document.querySelector(`.district[data-district="${d}"]`);
        if (box) {
          box.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
          box.focus({ preventScroll: true });
        }
      } catch (err) {
        out.classList.add("is-error");
        out.textContent = "Address search isn't available right now (" + err.message + "). Please try again in a moment.";
      }
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
    setupDistrictFinder();
    renderThemes(data.votes, data.motions);
  }

  load();
})();
