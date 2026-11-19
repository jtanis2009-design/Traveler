"use strict";
// Live vehicle map. Vehicle positions are worked out from live stop times
// (Transitous / OpenOV): each vehicle is placed along its route between the
// stop it last left and the next stop, the same way most live trackers do it.
(function () {
  const API = "https://api.transitous.org/api/v5";
  const TZ = "Europe/Amsterdam";
  const REFRESH_MS = 45_000;
  const TRACK_REFRESH_MS = 30_000;
  const CATS = {
    bus: ["BUS", "COACH"],
    metro: ["SUBWAY", "METRO"],
    tram: ["TRAM", "CABLE_TRAM"],
    train: ["RAIL", "REGIONAL_RAIL", "REGIONAL_FAST_RAIL", "LONG_DISTANCE", "HIGHSPEED_RAIL", "NIGHT_RAIL", "SUBURBAN"],
    ferry: ["FERRY"],
  };
  const catOf = m => Object.keys(CATS).find(k => CATS[k].includes(m)) || "other";
  const fmt = new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  const hm = ms => fmt.format(new Date(ms));
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = s => document.querySelector(s);

  // ---------- geometry ----------
  function decode(str, precision) {
    const f = Math.pow(10, precision || 5), out = [];
    let i = 0, lat = 0, lon = 0;
    while (i < str.length) {
      for (let k = 0; k < 2; k++) {
        let r = 0, sh = 0, b;
        do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32);
        const v = r & 1 ? ~(r >> 1) : r >> 1;
        if (k === 0) lat += v; else lon += v;
      }
      out.push([lat / f, lon / f]);
    }
    return out;
  }
  function dist(a, b) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  function bearing(a, b) {
    const toR = Math.PI / 180, y = Math.sin((b[1] - a[1]) * toR) * Math.cos(b[0] * toR);
    const x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos((b[1] - a[1]) * toR);
    return (Math.atan2(y, x) / toR + 360) % 360;
  }
  function makePath(pts) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    return { pts, cum, len: cum[cum.length - 1] || 0 };
  }
  function pointAt(path, d) {
    const { pts, cum } = path;
    if (pts.length === 1) return { ll: pts[0], deg: null };
    d = Math.max(0, Math.min(d, path.len));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= d) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi], seg = cum[hi] - cum[lo], f = seg ? (d - cum[lo]) / seg : 0;
    return { ll: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], deg: seg ? bearing(a, b) : null };
  }
  function textOn(hex) {
    const n = parseInt(hex, 16);
    return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160 ? "#0E1A24" : "#FFFFFF";
  }
  const DEFAULT_COLORS = { bus: "4B5B68", metro: "0A5C8A", tram: "6B3FA0", train: "1F3A93", ferry: "117A8B", other: "4B5B68" };

  // ---------- state ----------
  let map, tiles, ready = false, visible = false;
  let vehicles = new Map();           // tripId -> vehicle
  let filter = "all";
  let myLines = new Set();
  let fetchCtl = null, refreshTimer = null, tickTimer = null, moveTimer = null, lastFetch = null, lastCount = 0, fetchError = null;
  let tracked = null;
  let meMarker = null;

  function iconHtml(v, big) {
    const bg = "#" + (v.color || DEFAULT_COLORS[v.cat]);
    const fg = v.textColor ? "#" + v.textColor : textOn(v.color || DEFAULT_COLORS[v.cat]);
    return `<div class="veh${v.realTime ? "" : " sched"}${big ? " big" : ""}" style="--c:${esc(bg)};--t:${esc(fg)}">
      <span class="veh-dir"><i></i></span><span class="veh-name">${esc(v.name || "")}</span></div>`;
  }
  function makeIcon(v, big) {
    const s = big ? 40 : 30;
    return L.divIcon({ className: "veh-icon", html: iconHtml(v, big), iconSize: [s, s], iconAnchor: [s / 2, s / 2] });
  }

  // ---------- init ----------
  function init(center) {
    if (ready) return;
    ready = true;
    map = L.map("map", { zoomControl: false, attributionControl: true, minZoom: 7, maxZoom: 18 }).setView(center || [51.92, 4.48], 14);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    setTiles();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", setTiles);
    map.on("moveend", () => { clearTimeout(moveTimer); moveTimer = setTimeout(fetchVehicles, 350); requestAnimationFrame(render); });
    map.on("dragstart", () => { if (tracked) { tracked.follow = false; renderPanel(); } });

    document.querySelectorAll("#mapFilters [data-filter]").forEach(b => b.addEventListener("click", () => {
      filter = b.dataset.filter;
      document.querySelectorAll("#mapFilters [data-filter]").forEach(x => x.setAttribute("aria-pressed", x === b));
      render();
    }));
    $("#locateBtn").addEventListener("click", locate);
    $("#trackPanel").addEventListener("click", e => {
      if (e.target.closest("[data-close]")) return untrack();
      if (e.target.closest("[data-follow]") && tracked) {
        tracked.follow = !tracked.follow;
        if (tracked.follow && tracked.lastPos) map.panTo(aboveCenter(tracked.lastPos));
        renderPanel();
      }
      if (e.target.closest("[data-fit]") && tracked?.line) { tracked.follow = false; renderPanel(); map.fitBounds(tracked.line.getBounds(), { paddingTopLeft: [30, 70], paddingBottomRight: [30, panelHeight() + 20] }); }
    });
  }
  function isDark() {
    const t = document.documentElement.dataset.theme;
    return t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  }
  function setTiles() {
    if (tiles) tiles.remove();
    tiles = L.tileLayer(`https://{s}.basemaps.cartocdn.com/${isDark() ? "dark_all" : "rastertiles/voyager"}/{z}/{x}/{y}{r}.png`, {
      subdomains: "abcd", maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
  }

  // ---------- all vehicles in view ----------
  async function fetchVehicles() {
    if (!ready || !visible || document.visibilityState !== "visible") return;
    const z = Math.round(map.getZoom());
    const b = map.getBounds().pad(0.15);
    const now = Date.now();
    const p = new URLSearchParams({
      min: `${b.getSouth().toFixed(5)},${b.getWest().toFixed(5)}`,
      max: `${b.getNorth().toFixed(5)},${b.getEast().toFixed(5)}`,
      zoom: String(z),
      startTime: new Date(now - 60_000).toISOString(),
      endTime: new Date(now + REFRESH_MS + 120_000).toISOString(),
    });
    fetchCtl?.abort();
    const ctl = fetchCtl = new AbortController();
    try {
      const res = await fetch(`${API}/map/trips?${p}`, { signal: ctl.signal });
      if (!res.ok) throw new Error(`The live map answered ${res.status}.`);
      const segs = await res.json();
      const next = new Map();
      for (const s of segs) {
        if (s.mode === "AIRPLANE") continue;
        const pts = s.polyline ? decode(s.polyline, 5) : [];
        const path = makePath(pts.length >= 2 ? pts : [[s.from.lat, s.from.lon], [s.to.lat, s.to.lon]]);
        const seg = { dep: Date.parse(s.departure), arr: Date.parse(s.arrival), path };
        for (const tr of s.trips || []) {
          let v = next.get(tr.tripId);
          if (!v) {
            const old = vehicles.get(tr.tripId);
            v = { id: tr.tripId, name: tr.displayName || tr.routeShortName || "", mode: s.mode, cat: catOf(s.mode),
                  color: s.routeColor || "", realTime: !!s.realTime, segs: [], marker: old?.marker || null, markerKey: old?.markerKey };
            next.set(tr.tripId, v);
          }
          v.realTime = v.realTime || !!s.realTime;
          v.segs.push(seg);
        }
      }
      for (const v of next.values()) {
        v.segs.sort((a, b) => a.dep - b.dep);
        v.segs = v.segs.filter((s, i, a) => i === 0 || s.dep !== a[i - 1].dep || s.arr !== a[i - 1].arr);
      }
      for (const [id, v] of vehicles) if (!next.has(id) && v.marker) v.marker.remove();
      vehicles = next;
      lastFetch = new Date(); fetchError = null;
    } catch (e) {
      if (e.name === "AbortError") return;
      fetchError = e.message || "Network error.";
    }
    render();
  }

  function positionOf(v, t) {
    const s = v.segs;
    if (!s.length) return null;
    const at = (g, f) => {
      const p = pointAt(g.path, f * g.path.len);
      if (p.deg == null || f >= 1) p.deg = pointAt(g.path, Math.max(0, g.path.len - 1)).deg;
      return p;
    };
    if (t < s[0].dep) return s[0].dep - t <= 120_000 ? at(s[0], 0) : null;
    for (let i = 0; i < s.length; i++) {
      const g = s[i];
      if (t < g.dep) return at(s[i - 1], 1);             // waiting at a stop
      if (t <= g.arr) return at(g, g.arr > g.dep ? (t - g.dep) / (g.arr - g.dep) : 1);
    }
    return t - s[s.length - 1].arr <= 180_000 ? at(s[s.length - 1], 1) : null;
  }
  function passesFilter(v) {
    if (filter === "all") return true;
    if (filter === "mine") return myLines.has(v.name);
    return v.cat === filter;
  }

  function render() {
    if (!ready || !visible) return;
    const t = Date.now();
    const bounds = map.getBounds().pad(0.1);
    let shown = 0;
    for (const v of vehicles.values()) {
      const pos = tracked && v.id === tracked.id ? null : (passesFilter(v) ? positionOf(v, t) : null);
      if (!pos || !bounds.contains(pos.ll)) { if (v.marker) { v.marker.remove(); v.marker = null; } continue; }
      shown++;
      const key = v.name + v.color + v.realTime;
      if (!v.marker || v.markerKey !== key) {
        v.marker?.remove();
        v.marker = L.marker(pos.ll, { icon: makeIcon(v), keyboard: false, riseOnHover: true }).addTo(map);
        v.marker.on("click", () => track(v.id));
        v.markerKey = key;
      } else v.marker.setLatLng(pos.ll);
      setDir(v.marker, pos.deg);
    }
    lastCount = shown;
    if (tracked) renderTracked(t);
    renderStatus();
  }
  function setDir(marker, deg) {
    const el = marker.getElement()?.querySelector(".veh-dir");
    if (!el) return;
    el.style.display = deg == null ? "none" : "";
    if (deg != null) el.style.transform = `rotate(${deg.toFixed(0)}deg)`;
  }
  function renderStatus() {
    const z = map.getZoom();
    let txt;
    if (fetchError && !vehicles.size) txt = `Couldn't load vehicles. ${esc(fetchError)}`;
    else if (!lastFetch) txt = "Loading vehicles…";
    else {
      txt = `<strong>${lastCount}</strong> ${lastCount === 1 ? "vehicle" : "vehicles"} · updated ${hm(lastFetch)}`;
      if (z < 10) txt += "<br>Zoomed out: trains only. Zoom in for buses, trams and metro.";
      else if (filter === "mine" && !myLines.size) txt += "<br>Open a trip first to see your lines here.";
    }
    $("#mapStatus").innerHTML = txt;
  }

  // ---------- one tracked vehicle ----------
  async function track(tripId, board) {
    if (tracked?.id === tripId) { tracked.follow = true; if (board) tracked.board = board; render(); renderPanel(); return; }
    untrack(true);
    const v = vehicles.get(tripId);
    tracked = { id: tripId, board: board || null, follow: true, loading: true, firstPaint: true, name: v?.name, color: v?.color, cat: v?.cat };
    renderPanel();
    await loadTracked();
    if (tracked?.id === tripId) {
      clearInterval(tracked.timer);
      tracked.timer = setInterval(() => { if (visible && document.visibilityState === "visible") loadTracked(); }, TRACK_REFRESH_MS);
    }
  }
  async function loadTracked() {
    const tr = tracked;
    if (!tr) return;
    try {
      const res = await fetch(`${API}/trip?${new URLSearchParams({ tripId: tr.id })}`);
      if (!res.ok) throw new Error(res.status === 404 ? "This trip isn't in the timetable any more." : `The planner answered ${res.status}.`);
      const d = await res.json();
      if (tracked !== tr) return;
      const leg = (d.legs || []).find(l => l.tripId === tr.id) || (d.legs || []).find(l => l.mode !== "WALK");
      if (!leg) throw new Error("No route found for this vehicle.");
      const raw = [leg.from, ...(leg.intermediateStops || []), leg.to];
      let pts = leg.legGeometry?.points ? decode(leg.legGeometry.points, leg.legGeometry.precision || 6) : [];
      if (pts.length < 2) pts = raw.map(s => [s.lat, s.lon]);
      const path = makePath(pts);
      // Place each stop along the route line (searching forward so loops don't confuse it).
      let from = 0;
      const stops = raw.map((s, i) => {
        let best = from, bd = Infinity;
        const end = i === 0 ? Math.min(pts.length, 50) : pts.length;
        for (let k = from; k < end; k++) { const dd = dist(pts[k], [s.lat, s.lon]); if (dd < bd) { bd = dd; best = k; } if (bd < 15 && dd > 2000) break; }
        from = best;
        return {
          name: s.name, id: s.stopId, parent: s.parentId, lat: s.lat, lon: s.lon, track: s.track || s.scheduledTrack || "",
          arr: Date.parse(s.arrival || s.departure), dep: Date.parse(s.departure || s.arrival),
          sArr: Date.parse(s.scheduledArrival || s.scheduledDeparture || s.arrival || s.departure),
          sDep: Date.parse(s.scheduledDeparture || s.scheduledArrival || s.departure || s.arrival),
          cancelled: !!s.cancelled, along: path.cum[best],
        };
      });
      for (let i = 1; i < stops.length; i++) if (stops[i].along < stops[i - 1].along) stops[i].along = stops[i - 1].along;
      Object.assign(tr, {
        loading: false, error: null, leg, path, stops,
        name: leg.routeShortName || leg.displayName || tr.name, color: leg.routeColor || tr.color, textColor: leg.routeTextColor,
        cat: catOf(leg.mode), mode: leg.mode, realTime: !!leg.realTime, headsign: leg.headsign || leg.to?.name,
        agency: leg.agencyName, cancelled: !!leg.cancelled, updated: new Date(),
      });
      drawTracked();
    } catch (e) {
      if (tracked !== tr) return;
      tr.loading = false; tr.error = e.message || "Network error.";
    }
    render(); renderPanel();
  }
  function drawTracked() {
    const tr = tracked;
    const color = "#" + (tr.color || DEFAULT_COLORS[tr.cat]);
    if (!tr.line) {
      tr.casing = L.polyline(tr.path.pts, { color: "#000", opacity: .25, weight: 9, interactive: false }).addTo(map);
      tr.line = L.polyline(tr.path.pts, { color, weight: 5, opacity: .95, interactive: false }).addTo(map);
    } else { tr.line.setLatLngs(tr.path.pts); tr.casing.setLatLngs(tr.path.pts); }
    tr.stopLayer?.remove();
    tr.stopLayer = L.layerGroup(tr.stops.map(s => L.circleMarker([s.lat, s.lon], {
      radius: isBoard(s) ? 7 : 4.5, color, weight: isBoard(s) ? 4 : 2, fillColor: "#fff", fillOpacity: 1,
    }).bindTooltip(`${esc(s.name)} · ${hm(s.arr)}`, { direction: "top", offset: [0, -4] }))).addTo(map);
    const key = tr.name + tr.color + tr.realTime;
    if (!tr.marker || tr.markerKey !== key) {
      tr.marker?.remove();
      tr.marker = L.marker([tr.stops[0].lat, tr.stops[0].lon], { icon: makeIcon(tr, true), zIndexOffset: 1000, keyboard: false }).addTo(map);
      tr.markerKey = key;
    }
  }
  function isBoard(s) {
    const b = tracked?.board;
    return !!b && (b.id === s.id || (b.name && b.name === s.name));
  }
  function trackedPos(t) {
    const st = tracked.stops, n = st.length;
    if (t < st[0].dep) return { along: st[0].along, state: "waiting", i: 0 };
    for (let i = 0; i < n - 1; i++) {
      if (t < st[i].dep) return { along: st[i].along, state: "stop", i };
      if (t < st[i + 1].arr) {
        const f = (t - st[i].dep) / Math.max(1, st[i + 1].arr - st[i].dep);
        return { along: st[i].along + f * (st[i + 1].along - st[i].along), state: "moving", i };
      }
    }
    return { along: st[n - 1].along, state: "arrived", i: n - 1 };
  }
  function renderTracked(t) {
    const tr = tracked;
    if (!tr?.stops || !tr.marker) return;
    const p = trackedPos(t);
    const pt = pointAt(tr.path, p.along);
    tr.marker.setLatLng(pt.ll);
    setDir(tr.marker, p.state === "moving" || p.state === "stop" ? pt.deg : null);
    tr.pos = p; tr.lastPos = pt.ll;
    if (tr.follow) {
      if (tr.firstPaint) {
        tr.firstPaint = false;
        const z = Math.max(map.getZoom(), 14);
        map.setView(aboveCenter(pt.ll, z), z, { animate: false });
      } else {
        // Keep the vehicle in the part of the map that the panel doesn't cover.
        const cp = map.latLngToContainerPoint(pt.ll), size = map.getSize(), visH = size.y - panelHeight();
        if (cp.x < size.x * .2 || cp.x > size.x * .8 || cp.y < visH * .25 || cp.y > visH * .8) map.panTo(aboveCenter(pt.ll), { animate: true });
      }
    }
    renderPanel(true);
  }
  function panelHeight() { const el = $("#trackPanel"); return el.hidden ? 0 : el.offsetHeight + 10; }
  function aboveCenter(ll, z = map.getZoom()) { return map.unproject(map.project(ll, z).add([0, panelHeight() / 2]), z); }
  function untrack(silent) {
    if (!tracked) return;
    clearInterval(tracked.timer);
    ["marker", "line", "casing", "stopLayer"].forEach(k => tracked[k]?.remove());
    tracked = null;
    if (!silent) { renderPanel(); render(); }
  }

  function countdown(ms) {
    const m = Math.round(ms / 60000);
    if (m <= 0) return "now";
    if (m < 60) return `in ${m} min`;
    return `in ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
  }
  const delayOf = (a, s) => Math.round((a - s) / 60000);
  let panelSig = "";
  function renderPanel(fromTick) {
    const el = $("#trackPanel");
    const tr = tracked;
    if (!tr) { el.hidden = true; el.innerHTML = ""; panelSig = ""; return; }
    el.hidden = false;
    const chip = `<span class="chip" style="background:#${esc(tr.color || DEFAULT_COLORS[tr.cat || "other"])};color:${tr.textColor ? "#" + esc(tr.textColor) : textOn(tr.color || DEFAULT_COLORS[tr.cat || "other"])};border-color:transparent">${esc(tr.name || "…")}</span>`;
    const close = `<button class="iconbtn" type="button" data-close aria-label="Stop tracking"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
    if (tr.loading || tr.error) {
      el.innerHTML = `<div class="tp-head"><div class="tp-title">${chip}<span>${tr.error ? esc(tr.error) : "Finding this vehicle…"}</span></div>${close}</div>`;
      return;
    }
    const t = Date.now(), p = tr.pos || trackedPos(t), st = tr.stops, n = st.length;
    const nextIdx = p.state === "waiting" ? 0 : p.state === "stop" ? p.i : Math.min(p.i + 1, n - 1);
    const nx = st[nextIdx];
    const delay = delayOf(nx.arr, nx.sArr) || delayOf(nx.dep, nx.sDep);
    let pill;
    if (tr.cancelled) pill = `<span class="flag cancel">Cancelled</span>`;
    else if (!tr.realTime) pill = `<span class="flag sched-flag">Timetable only</span>`;
    else if (delay > 0) pill = `<span class="flag late">Live · +${delay} min</span>`;
    else if (delay < 0) pill = `<span class="flag live">Live · ${-delay} min early</span>`;
    else pill = `<span class="flag live">Live · on time</span>`;

    let where;
    if (p.state === "waiting") where = `Leaves <strong>${esc(st[0].name)}</strong> at <strong class="num">${hm(st[0].dep)}</strong> · ${countdown(st[0].dep - t)}`;
    else if (p.state === "stop") where = `At <strong>${esc(st[p.i].name)}</strong> now`;
    else if (p.state === "moving") where = `Next stop <strong>${esc(nx.name)}</strong> · <span class="num">${hm(nx.arr)}</span> (${countdown(nx.arr - t)})`;
    else where = `Arrived at <strong>${esc(st[n - 1].name)}</strong>`;

    let boardLine = "";
    const bi = st.findIndex(isBoard);
    if (bi >= 0) {
      const b = st[bi], bt = bi === 0 ? b.dep : b.arr;
      boardLine = bt > t - 30_000
        ? `<div class="tp-board">At your stop <strong>${esc(b.name)}</strong> <span class="num">${hm(bt)}</span> · <strong>${countdown(bt - t)}</strong></div>`
        : `<div class="tp-board past">Already passed your stop ${esc(b.name)}</div>`;
    }

    // Avoid rebuilding the list every tick unless something visible changed.
    const sig = [tr.updated?.getTime(), p.state, p.i, Math.floor(t / 30000), tr.follow].join("|");
    if (fromTick && sig === panelSig) return;
    panelSig = sig;

    const rows = st.map((s, i) => {
      const passed = p.state === "arrived" || i < nextIdx;
      const tm = i === 0 ? s.dep : s.arr, sch = i === 0 ? s.sDep : s.sArr, d = delayOf(tm, sch);
      return `<li class="${passed ? "passed" : ""}${i === nextIdx && p.state !== "arrived" ? " next" : ""}${isBoard(s) ? " mine" : ""}${s.cancelled ? " cx" : ""}">
        <span class="num tp-t${d > 0 ? " late" : ""}">${hm(tm)}${d > 0 ? `<s>${hm(sch)}</s>` : ""}</span>
        <span class="tp-dot"></span>
        <span class="tp-n">${esc(s.name)}${s.track ? ` <small>· ${esc(s.track)}</small>` : ""}${s.cancelled ? ` <small class="cxl">skipped</small>` : ""}</span></li>`;
    }).join("");
    const scrollTop = el.querySelector(".tp-stops")?.scrollTop;
    el.innerHTML = `
      <div class="tp-head">
        <div class="tp-title">${chip}<span class="tp-hs">${esc(tr.headsign || "")}</span></div>
        ${close}
      </div>
      <div class="tp-sub">${pill}<span class="tp-ag">${esc(tr.agency || "")}</span></div>
      <div class="tp-where">${where}</div>
      ${boardLine}
      <div class="tp-actions">
        <button class="btn sm" type="button" data-follow aria-pressed="${tr.follow}">${tr.follow ? "Following" : "Follow"}</button>
        <button class="btn sm" type="button" data-fit>Whole route</button>
      </div>
      <ol class="tp-stops" style="--c:#${esc(tr.color || DEFAULT_COLORS[tr.cat])}">${rows}</ol>`;
    const list = el.querySelector(".tp-stops");
    if (!tr.scrolledOnce) {
      const target = list.querySelector("li.mine:not(.passed)") || list.querySelector("li.next");
      if (target) list.scrollTop = Math.max(0, target.offsetTop - 40);
      tr.scrolledOnce = true;
    } else if (scrollTop != null) list.scrollTop = scrollTop;
  }

  // ---------- my location ----------
  function locate() {
    if (!navigator.geolocation) return;
    $("#locateBtn").classList.add("busy");
    navigator.geolocation.getCurrentPosition(pos => {
      $("#locateBtn").classList.remove("busy");
      const ll = [pos.coords.latitude, pos.coords.longitude];
      if (!meMarker) meMarker = L.circleMarker(ll, { radius: 8, color: "#fff", weight: 3, fillColor: "#1A73E8", fillOpacity: 1 }).addTo(map);
      else meMarker.setLatLng(ll);
      if (tracked) tracked.follow = false;
      map.setView(ll, Math.max(map.getZoom(), 15));
      renderPanel();
    }, () => { $("#locateBtn").classList.remove("busy"); $("#mapStatus").innerHTML = "Location is off. Allow location for this site to use this button."; },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
  }

  // ---------- public ----------
  window.LiveMap = {
    show(center) {
      init(center);
      visible = true;
      setTimeout(() => map.invalidateSize(), 0);
      fetchVehicles();
      clearInterval(refreshTimer); clearInterval(tickTimer);
      refreshTimer = setInterval(fetchVehicles, REFRESH_MS);
      tickTimer = setInterval(render, 1000);
    },
    hide() { visible = false; clearInterval(refreshTimer); clearInterval(tickTimer); },
    track(tripId, board) { track(tripId, board); },
    setMyLines(names) { myLines = new Set(names); },
    resume() { if (visible) { fetchVehicles(); if (tracked) loadTracked(); } },
  };
})();
