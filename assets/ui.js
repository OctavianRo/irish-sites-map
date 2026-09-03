/**
 * Planner UI: schedule builder on the left, map in the middle, verdicts on the
 * right. All the transport thinking lives in planner.js / network.js - this
 * file is presentation and state.
 */
(function () {
  'use strict';

  const NET = window.RoadNetwork, VEH = window.Vehicles, PLAN = window.Planner;
  const SITES = window.SITE_INDEX || { sites: [], authorities: [], categories: [] };
  const S = { lat: 0, lon: 1, cat: 2, units: 3, auth: 4, ref: 5, granted: 6, addr: 7 };
  const STORE_KEY = 'ie-haulage-planner-v1';

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = n => Math.round(n * 10) / 10;
  const eur = n => '€' + (Math.round(n * 100) / 100).toFixed(2);

  // ------------------------------------------------------------- state ---
  const blankRun = (n) => ({
    id: 'run' + Math.random().toString(36).slice(2, 8),
    name: 'Run ' + n, driver: '', date: new Date().toISOString().slice(0, 10),
    transportCode: 'ART-44', startTime: '07:00', defaultServiceMin: 45,
    adr: false, returnToStart: false, stops: [],
  });

  let state = load() || {
    runs: [blankRun(1)], active: 0,
    rates: { dieselPerLitre: 1.75, driverPerHour: 22, runningPerKm: 0.18 },
  };
  let tab = 'plan';
  let plan = null;              // last computed plan for the active run
  let fleetRows = null;

  const run = () => state.runs[state.active];

  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* private mode */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.runs) || !s.runs.length) return null;
      s.active = Math.min(s.active | 0, s.runs.length - 1);
      return s;
    } catch (e) { return null; }
  }

  let toastT;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2600);
  }

  // --------------------------------------------------------------- map ---
  // The map is an aid, not the tool. If Leaflet cannot load - offline, or a
  // firewall that blocks the CDN - the planner carries on without it.
  const hasMap = typeof L !== 'undefined' && L && typeof L.map === 'function';
  let map, routeLayer, stopLayer;
  if (hasMap) {
    map = L.map('map', { preferCanvas: true, zoomControl: true }).setView([53.3, -7.8], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    stopLayer = L.layerGroup().addTo(map);
    map.on('click', e => {
      addStop({ name: `Point ${r1(e.latlng.lat)}, ${r1(e.latlng.lng)}`, lat: +e.latlng.lat.toFixed(5), lon: +e.latlng.lng.toFixed(5) });
    });
  } else {
    $('map').innerHTML = `<div class="empty" style="margin:24px">Map tiles could not be loaded, so
      the map is switched off. Every route, warning and timing still works — read them in the
      panels either side.</div>`;
    $('mapnote').style.display = 'none';
    document.querySelector('.maplegend').style.display = 'none';
  }

  const LINE = { ok: '#38bdf8', caution: '#f59e0b', block: '#ef4444', alt: '#6b7885' };

  function drawMap() {
    if (!hasMap) return;
    routeLayer.clearLayers(); stopLayer.clearLayers();
    const r = run();
    const pts = [];

    if (plan && plan.legs) {
      for (const leg of plan.legs) {
        // Alternatives first so the recommendation draws on top.
        for (const opt of (leg.options || [])) {
          if (opt.recommended) continue;
          L.polyline(opt.polyline, { color: LINE.alt, weight: 3, opacity: .45, dashArray: '6 6' })
            .bindPopup(`<b>${esc(opt.objectives.map(o => PLAN.OBJECTIVES[o].label).join(' / '))}</b><br>${opt.km} km · ${PLAN.minToHrs(opt.driveMin)} · tolls ${eur(opt.tollEur)}`)
            .addTo(routeLayer);
        }
        if (!leg.route) continue;
        for (const s of leg.route.steps) {
          const a = NET.node(s.fromId), b = NET.node(s.toId);
          L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
            color: s.verdict === 'caution' ? LINE.caution : LINE.ok,
            weight: s.verdict === 'caution' ? 6 : 5, opacity: .92,
          }).bindPopup(
            `<b>${esc(s.ref)}</b> · ${esc(s.clsLabel)}<br>${esc(s.from)} → ${esc(s.to)}<br>` +
            `${s.km} km · ${s.min} min at ${s.kph} km/h` +
            (s.tollEur ? `<br>Toll ${eur(s.tollEur)}` : '') +
            (s.verdict === 'caution' ? '<br><b style="color:#fcd34d">Tight for this vehicle</b>' : '')
          ).addTo(routeLayer);
        }
        // The unmodelled final mile, drawn dashed so nobody mistakes it for a route.
        const endNode = NET.node(leg.route.nodes[leg.route.nodes.length - 1]);
        L.polyline([[endNode.lat, endNode.lon], [leg.to.lat, leg.to.lon]],
          { color: LINE.alt, weight: 2, opacity: .8, dashArray: '3 5' })
          .bindPopup(`<b>Final mile — not routed</b><br>${esc(leg.access.advice)}`)
          .addTo(routeLayer);
      }
    }

    r.stops.forEach((st, i) => {
      pts.push([st.lat, st.lon]);
      const depot = i === 0;
      L.marker([st.lat, st.lon], {
        icon: L.divIcon({
          className: '', iconSize: [24, 24], iconAnchor: [12, 12],
          html: `<div class="dropmark${depot ? ' depot' : ''}">${depot ? 'D' : i}</div>`,
        }),
      }).bindPopup(`<b>${esc(st.name)}</b><br><span class="mono">${st.lat}, ${st.lon}</span>` +
        (st.detail ? `<br>${esc(st.detail)}` : '')).addTo(stopLayer);
    });

    if (pts.length === 1) map.setView(pts[0], 11);
    else if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.18));
  }

  // ------------------------------------------------------------ search ---
  const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

  function searchPlaces(q) {
    q = q.trim();
    if (q.length < 2) return [];
    const coord = COORD_RE.exec(q);
    if (coord) {
      const lat = +coord[1], lon = +coord[2];
      if (lat > 49 && lat < 56 && lon > -11 && lon < -5) {
        return [{ kind: 'coord', name: `${lat}, ${lon}`, detail: 'Map coordinate', lat, lon }];
      }
    }
    const needle = q.toLowerCase();
    const out = [];
    for (const n of NET.NODES.values()) {
      if (n.name.toLowerCase().includes(needle)) {
        out.push({ kind: 'town', name: n.name, detail: `${n.county} · on the strategic network`, lat: n.lat, lon: n.lon });
      }
    }
    out.sort((a, b) => a.name.toLowerCase().indexOf(needle) - b.name.toLowerCase().indexOf(needle));
    const towns = out.slice(0, 8);

    const siteHits = [];
    for (let i = 0; i < SITES.sites.length && siteHits.length < 40; i++) {
      const s = SITES.sites[i];
      const hay = (s[S.addr] + ' ' + SITES.authorities[s[S.auth]] + ' ' + s[S.ref]).toLowerCase();
      if (!hay.includes(needle)) continue;
      siteHits.push({
        kind: 'site', name: s[S.addr] || SITES.categories[s[S.cat]],
        detail: `${SITES.authorities[s[S.auth]]} · ${s[S.ref]} · ${s[S.units] ? s[S.units] + ' units' : SITES.categories[s[S.cat]]}`,
        lat: s[S.lat], lon: s[S.lon], units: s[S.units],
      });
    }
    siteHits.sort((a, b) => (b.units || 0) - (a.units || 0));
    return towns.concat(siteHits.slice(0, 24));
  }

  let searchSel = -1, searchHits = [];
  function renderSearch(hits) {
    searchHits = hits; searchSel = -1;
    $('f-results').innerHTML = hits.map((h, i) =>
      `<div class="res" data-i="${i}"><div class="r1">${esc(h.name)}</div><div class="r2">${esc(h.detail)}</div></div>`
    ).join('');
  }

  // ------------------------------------------------------------- stops ---
  function addStop(place) {
    const r = run();
    r.stops.push({
      name: place.name, detail: place.detail || '', lat: place.lat, lon: place.lon,
      serviceMin: r.stops.length === 0 ? 0 : r.defaultServiceMin,
    });
    invalidate();
  }

  function renderStops() {
    const r = run();
    const host = $('stops');
    if (!r.stops.length) {
      host.innerHTML = '<div class="empty">No stops yet.<br>The first stop is the depot you start from.</div>';
      return;
    }
    host.innerHTML = r.stops.map((st, i) => `
      <div class="stop${i === 0 ? ' depot' : ''}" data-i="${i}">
        <div class="seq">${i === 0 ? 'D' : i}</div>
        <div class="body">
          <div class="nm" title="${esc(st.name)}">${esc(st.name)}</div>
          <div class="meta">${st.lat.toFixed(4)}, ${st.lon.toFixed(4)}${st.detail ? ' · ' + esc(st.detail) : ''}</div>
        </div>
        ${i === 0 ? '' : `<input class="svc" type="number" min="0" max="480" step="5" value="${st.serviceMin}"
             title="Offload time in minutes" data-svc="${i}">`}
        <div class="acts">
          <button class="iconbtn" data-up="${i}" title="Move up"${i === 0 ? ' disabled' : ''}>▲</button>
          <button class="iconbtn" data-down="${i}" title="Move down"${i === r.stops.length - 1 ? ' disabled' : ''}>▼</button>
          <button class="iconbtn del" data-del="${i}" title="Remove">✕</button>
        </div>
      </div>`).join('');
  }

  function renderRuns() {
    $('runs').innerHTML = state.runs.map((r, i) => {
      const v = r._verdict || '';
      return `<span class="runtab${i === state.active ? ' on' : ''}" data-run="${i}">
        <span class="dot ${v}"></span>${esc(r.name)}${r.driver ? ' · ' + esc(r.driver.split(' ').pop()) : ''}
        <span class="x" data-delrun="${i}" title="Delete this run">✕</span></span>`;
    }).join('');
  }

  function renderForm() {
    const r = run();
    $('f-driver').value = r.driver;
    $('f-date').value = r.date;
    $('f-start').value = r.startTime;
    $('f-service').value = r.defaultServiceMin;
    $('f-adr').checked = !!r.adr;
    $('f-return').checked = !!r.returnToStart;
    $('f-code').value = r.transportCode;
    const v = VEH.resolve(r.transportCode);
    $('code-detail').innerHTML = v ? `${esc(v.body)}<br>
      <span class="mono">${v.lengthM}m · ${v.heightM.toFixed(2)}m high · ${v.gvwT}t gross ·
      ${v.axles} axles · ${v.payloadT}t payload</span><br>${esc(v.notes)}` : '';
    $('r-diesel').value = state.rates.dieselPerLitre;
    $('r-driver').value = state.rates.driverPerHour;
    $('r-run').value = state.rates.runningPerKm;
  }

  // ------------------------------------------------------------ planning --
  function invalidate() { plan = null; fleetRows = null; run()._verdict = ''; renderAll(); }

  function computePlan() {
    const r = run();
    const stops = r.stops.slice();
    if (r.returnToStart && stops.length > 1) {
      stops.push(Object.assign({}, stops[0], { name: stops[0].name + ' (return)', serviceMin: 0 }));
    }
    plan = PLAN.planSchedule(Object.assign({}, r, { stops }), { rates: state.rates });
    r._verdict = plan.error ? 'blocked' : plan.verdict;
    fleetRows = null;
    save(); renderAll();
    if (plan.error) toast(plan.error);
  }

  // ------------------------------------------------------------ rendering --
  const VERDICT = {
    clear: { ico: '✓', t: 'Cleared to run', s: 'Every road on this route suits the booked vehicle and the day is inside EU drivers\' hours.' },
    caution: { ico: '!', t: 'Runnable, with cautions', s: 'The route works but includes sections that are tight for this vehicle. Read the road notes before dispatch.' },
    illegal: { ico: '✕', t: 'Breaches drivers\' hours', s: 'The roads are fine but the day as scheduled cannot legally be driven.' },
    blocked: { ico: '✕', t: 'Not drivable as booked', s: 'This vehicle cannot legally or physically complete the run. Change the transport code or the stops.' },
  };

  function paneHTML() {
    if (tab === 'ref') return refHTML();
    if (tab === 'fleet') return fleetHTML();
    if (!plan) {
      return `<div class="empty">Add a depot and at least one drop, then press
        <b>Plan the day</b>.<br><br>The planner checks the roads against the transport code,
        applies EU 561/2006 drivers' hours, and recommends a route.</div>`;
    }
    if (plan.error) return `<div class="verdict v-blocked"><div class="ico">✕</div><div>
      <div class="vt">${esc(plan.error)}</div></div></div>`;
    return tab === 'roads' ? roadsHTML() : dayHTML();
  }

  function dayHTML() {
    const v = VERDICT[plan.verdict] || VERDICT.caution;
    const m = plan.money || {};
    let h = `<div class="verdict v-${plan.verdict}"><div class="ico">${v.ico}</div><div>
        <div class="vt">${v.t}</div><div class="vs">${v.s}</div></div></div>`;

    h += `<div class="kpis">
      <div class="kpi"><div class="n">${plan.totals.km}</div><div class="l">km</div></div>
      <div class="kpi"><div class="n">${PLAN.minToHrs(plan.totals.driveMin)}</div><div class="l">driving</div></div>
      <div class="kpi"><div class="n">${PLAN.minToHrs(plan.totals.dutyMin || 0)}</div><div class="l">duty</div></div>
      <div class="kpi"><div class="n">${eur(m.totalEur || 0)}</div><div class="l">all-in cost</div></div>
    </div>`;

    if (plan.blockers.length) {
      h += `<div class="sec"><h3>Blockers</h3>` +
        plan.blockers.map(b => `<div class="card block">${esc(b.text)}</div>`).join('') + `</div>`;
    }

    if (plan.compliance.violations.length || plan.compliance.notes.length) {
      h += `<div class="sec"><h3>Drivers' hours — EU 561/2006</h3>`;
      h += plan.compliance.violations.map(x => `<div class="card block">${esc(x)}</div>`).join('');
      h += plan.compliance.notes.map(x => `<div class="card note small">${esc(x)}</div>`).join('');
      h += `</div>`;
    }

    // Timeline
    h += `<div class="sec"><h3>Driver's day</h3><div class="tl">` +
      plan.timeline.filter(e => e.min > 0 || e.type === 'depart').map(e => `
        <div class="ev ${e.type}">
          <span class="t">${PLAN.minToHHMM(e.startMin)}${e.min ? '–' + PLAN.minToHHMM(e.endMin) : ''}</span>
          <span class="pip"></span>
          <span class="lbl">${esc(e.label)}</span>
          <span class="dur">${e.min ? e.min + 'm' : ''}</span>
        </div>`).join('') +
      `</div><div class="small dim" style="margin-top:7px">Ends ${PLAN.minToHHMM(plan.endMin)} ·
        ${PLAN.minToHrs(plan.totals.breakMin)} statutory break ·
        ${PLAN.minToHrs(plan.totals.workMin)} offloading</div></div>`;

    // Legs and route options
    h += `<div class="sec"><h3>Legs and route options</h3>`;
    plan.legs.forEach((leg, i) => {
      h += `<div class="card" style="padding:9px 10px 4px">
        <div style="display:flex;gap:8px;align-items:baseline">
          <b>${i + 1}. ${esc(leg.from.name)} → ${esc(leg.to.name)}</b>
          <span class="spacer" style="flex:1"></span>
          <span class="mono dim small">${leg.route ? leg.route.km + ' km' : '—'}</span>
        </div>`;
      if (!leg.route) {
        h += `<div class="small" style="color:#fca5a5;margin:6px 0 8px">No legal route for this
          transport code — every option needs a road the vehicle cannot use.</div>`;
        if (leg.suggestion) {
          h += `<div class="small muted" style="margin:0 0 9px">
            <b>${esc(leg.suggestion.code)}</b> (${esc(leg.suggestion.name)}, ${leg.suggestion.payloadT}t payload)
            can make this drop.
            <button class="btn small" data-swap="${esc(leg.suggestion.code)}"
              style="margin-left:6px">Switch this run to ${esc(leg.suggestion.code)}</button></div>`;
        }
        h += `</div>`;
        return;
      }
      h += `<div class="small muted" style="margin:5px 0 8px">${esc(leg.reason)}</div>`;
      for (const opt of leg.options) {
        h += `<details class="opt${opt.recommended ? ' rec' : ''}"${opt.recommended ? ' open' : ''}>
          <summary>
            <span class="tag">${opt.recommended ? 'Use this' : esc(opt.objectives.map(o => PLAN.OBJECTIVES[o].label).join(' / '))}</span>
            <span class="small">${esc(PLAN.OBJECTIVES[opt.key].blurb)}</span>
            <span class="figs">${opt.km} km · ${PLAN.minToHrs(opt.driveMin)}<br>
              tolls ${eur(opt.tollEur)} · all-in ${eur(opt.money.totalEur)}</span>
          </summary>
          <div class="inner"><div class="leglist">` +
          opt.itinerary.map(s => `<div class="l ${s.verdict}">
              <span class="ref">${esc(s.ref)}</span>
              <span class="to">→ ${esc(s.to)}${s.verdict === 'caution' ? ' ⚠' : ''}</span>
              <span class="km">${s.km} km</span></div>`).join('') +
          `</div>
            <div class="small dim" style="margin-top:7px;padding-top:7px;border-top:1px solid var(--line)">
              Final mile: ${esc(leg.access.advice)}
            </div></div></details>`;
      }
      h += `</div>`;
    });
    h += `</div>`;

    h += `<div class="sec"><h3>Cost of the day</h3>
      <table class="grid">
        <tr><td>Diesel · ${plan.vehicle.lPer100} l/100km</td><td class="num">${eur(m.fuelEur)}</td></tr>
        <tr><td>Running · tyres, maintenance, AdBlue</td><td class="num">${eur(m.runningEur)}</td></tr>
        <tr><td>Driver · ${PLAN.minToHrs(plan.totals.dutyMin)} duty</td><td class="num">${eur(m.driverEur)}</td></tr>
        <tr><td>Tolls</td><td class="num">${eur(m.tollEur)}</td></tr>
        <tr><td><b>Total</b></td><td class="num"><b>${eur(m.totalEur)}</b></td></tr>
        <tr><td class="dim">Per drop</td><td class="num dim">${eur(m.perDrop)}</td></tr>
      </table>
      <div class="small dim" style="margin-top:6px">Toll rates are indicative
        (${esc(NET.TOLLS.ratesAsOf)}) — check them against your eFlow account.</div></div>`;
    return h;
  }

  function roadsHTML() {
    // One row per distinct road used, worst verdict wins.
    const roads = new Map();
    for (const leg of plan.legs) {
      if (!leg.route) continue;
      for (const s of leg.route.steps) {
        const cur = roads.get(s.ref) || { ref: s.ref, cls: s.clsLabel, km: 0, verdict: 'ok', toll: 0 };
        cur.km = r1(cur.km + s.km); cur.toll = r1(cur.toll + s.tollEur);
        if (s.verdict === 'caution') cur.verdict = 'caution';
        roads.set(s.ref, cur);
      }
    }
    const v = plan.vehicle;
    let h = `<div class="card" style="margin-bottom:14px">
      <b>${esc(v.code)}</b> — ${esc(v.name)}<br>
      <span class="mono small dim">${v.lengthM}m long · ${v.widthM}m wide · ${v.heightM.toFixed(2)}m high ·
      ${v.gvwT}t on ${v.axles} axles · ${v.turnM}m turning radius</span>
      <div class="small muted" style="margin-top:5px">Needs a running lane of at least
        <b>${NET.widthNeedM(v).toFixed(2)}m</b>. ${v.isHGV
          ? 'Limited to 80 km/h on every road class as a goods vehicle over 3.5t.'
          : 'Not an HGV — normal speed limits, no tachograph.'}</div></div>`;

    const warn = plan.warnings.filter(w => w.severity === 'caution');
    const notes = plan.warnings.filter(w => w.severity === 'note');
    h += `<div class="sec"><h3>Road warnings</h3>`;
    if (!warn.length && !plan.blockers.length) {
      h += `<div class="card ok small">No tight or restricted sections on the recommended route
        for a ${esc(v.code)}.</div>`;
    }
    h += plan.blockers.map(b => `<div class="card block small">${esc(b.text)}</div>`).join('');
    h += warn.map(w => `<div class="card caution small">${esc(w.text)}</div>`).join('');
    h += `</div>`;

    if (notes.length) {
      h += `<div class="sec"><h3>Worth knowing</h3>` +
        [...new Set(notes.map(n => n.text))].slice(0, 12)
          .map(t => `<div class="warnitem"><span class="w-ref">note</span><span>${esc(t)}</span></div>`).join('') +
        `</div>`;
    }

    h += `<div class="sec"><h3>Roads used</h3><table class="grid">
      <thead><tr><th>Road</th><th>Class</th><th style="text-align:right">km</th>
      <th style="text-align:right">Toll</th><th>For ${esc(v.code)}</th></tr></thead><tbody>` +
      [...roads.values()].sort((a, b) => b.km - a.km).map(rd => `<tr>
        <td class="mono">${esc(rd.ref)}</td><td class="dim">${esc(rd.cls)}</td>
        <td class="num">${rd.km}</td><td class="num">${rd.toll ? eur(rd.toll) : '—'}</td>
        <td><span class="pill ${rd.verdict}">${rd.verdict === 'ok' ? 'suited' : 'tight'}</span></td>
      </tr>`).join('') + `</tbody></table></div>`;

    // Access assessment per drop.
    h += `<div class="sec"><h3>Final mile at each drop</h3><table class="grid">
      <thead><tr><th>Drop</th><th style="text-align:right">Off network</th><th>Risk</th></tr></thead><tbody>` +
      plan.legs.map((leg, i) => `<tr>
        <td>${i + 1}. ${esc(leg.to.name)}<div class="small dim">${esc(leg.access.advice)}</div></td>
        <td class="num">${leg.access.approachKm} km</td>
        <td><span class="pill ${leg.access.level === 'low' ? 'ok' : leg.access.level === 'medium' ? 'caution' : 'block'}">${leg.access.level}</span></td>
      </tr>`).join('') + `</tbody></table>
      <div class="small dim" style="margin-top:6px">The network stops at trunk roads. Anything past
        that is measured, not routed — treat a high risk as "survey it or send a smaller unit".</div></div>`;
    return h;
  }

  function fleetHTML() {
    const r = run();
    if (r.stops.length < 2) return `<div class="empty">Add a depot and at least one drop to compare the fleet.</div>`;
    if (!fleetRows) {
      const stops = r.stops.slice();
      if (r.returnToStart) stops.push(Object.assign({}, stops[0], { serviceMin: 0 }));
      fleetRows = PLAN.fleetFit(stops, { adr: r.adr });
    }
    const best = fleetRows.filter(x => x.verdict !== 'blocked')
      .sort((a, b) => b.payloadT - a.payloadT)[0];
    let h = '';
    if (best) {
      h += `<div class="verdict v-clear"><div class="ico">✓</div><div>
        <div class="vt">Largest unit that can do this run: ${esc(best.code)}</div>
        <div class="vs">${esc(best.vehicle.name)} — ${best.payloadT}t payload, ${best.km} km,
          ${PLAN.minToHrs(best.driveMin)} driving, ${eur(best.costEur)} all-in.</div></div></div>`;
    } else {
      h += `<div class="verdict v-blocked"><div class="ico">✕</div><div>
        <div class="vt">Nothing in the fleet can complete this run</div>
        <div class="vs">Split the drops across separate runs, or check the stop coordinates.</div>
      </div></div>`;
    }
    h += `<table class="grid"><thead><tr>
      <th>Code</th><th style="text-align:right">Payload</th><th style="text-align:right">km</th>
      <th style="text-align:right">Drive</th><th style="text-align:right">Cost</th><th>Verdict</th>
      </tr></thead><tbody>` +
      fleetRows.map(x => `<tr${x === best ? ' style="background:rgba(56,189,248,.07)"' : ''}>
        <td><b class="mono">${esc(x.code)}</b><div class="small dim">${esc(x.vehicle.name)}</div></td>
        <td class="num">${x.payloadT}t</td>
        <td class="num">${x.verdict === 'blocked' ? '—' : x.km}</td>
        <td class="num">${x.verdict === 'blocked' ? '—' : PLAN.minToHrs(x.driveMin)}</td>
        <td class="num">${x.verdict === 'blocked' ? '—' : eur(x.costEur)}</td>
        <td><span class="pill ${x.verdict}">${x.verdict}</span>
          ${x.cautions ? `<div class="small dim">${x.cautions} tight</div>` : ''}
          ${x.highRiskDrops ? `<div class="small dim">${x.highRiskDrops} risky drop${x.highRiskDrops > 1 ? 's' : ''}</div>` : ''}
        </td></tr>`).join('') + `</tbody></table>
      <div class="small dim" style="margin-top:8px">Payload is gross weight less tare — the reason
        to keep asking for the artic even when the rigid fits.</div>`;
    return h;
  }

  function refHTML() {
    let h = `<div class="sec"><h3>Transport codes</h3><table class="grid">
      <thead><tr><th>Code</th><th style="text-align:right">L × H</th><th style="text-align:right">Gross</th>
      <th style="text-align:right">Axles</th><th style="text-align:right">Payload</th></tr></thead><tbody>` +
      VEH.PROFILES.map(p => {
        const v = VEH.resolve(p.code);
        return `<tr><td><b class="mono">${esc(p.code)}</b><div class="small dim">${esc(p.body)}</div></td>
          <td class="num">${p.lengthM}m<br>${p.heightM.toFixed(2)}m</td>
          <td class="num">${p.gvwT}t</td><td class="num">${p.axles}</td>
          <td class="num">${v.payloadT}t</td></tr>`;
      }).join('') + `</tbody></table></div>`;

    h += `<div class="sec"><h3>Access restrictions</h3>` +
      Object.values(NET.ZONES).map(z => `<div class="card ${z.severity === 'block' ? 'block' : 'note'}">
        <b>${esc(z.name)}</b><div class="small muted" style="margin-top:4px">${esc(z.rule)}</div>
        ${z.permit ? `<div class="small dim" style="margin-top:4px">${esc(z.permit)}</div>` : ''}</div>`).join('') +
      `</div>`;

    h += `<div class="sec"><h3>Roads never to send a lorry down</h3><table class="grid"><tbody>` +
      NET.KNOWN_TRAPS.map(t => `<tr><td><b>${esc(t.road)}</b>
        <div class="small dim">${esc(t.why)}</div></td></tr>`).join('') +
      `</tbody></table></div>`;

    h += `<div class="sec"><h3>Toll rates by axle class (${esc(NET.TOLLS.ratesAsOf)}, indicative)</h3>
      <table class="grid"><thead><tr><th>Plaza</th><th style="text-align:right">Car</th>
      <th style="text-align:right">2-axle</th><th style="text-align:right">3-axle</th>
      <th style="text-align:right">4+ axle</th></tr></thead><tbody>` +
      Object.values(NET.TOLLS.plazas).map(p => `<tr><td>${esc(p.name)}
        ${p.note ? `<div class="small dim">${esc(p.note)}</div>` : ''}</td>
        <td class="num">${eur(p.car)}</td><td class="num">${eur(p.hgv2)}</td>
        <td class="num">${eur(p.hgv3)}</td><td class="num">${eur(p.hgv4)}</td></tr>`).join('') +
      `</tbody></table></div>`;

    const H = PLAN.HOS;
    h += `<div class="sec"><h3>Drivers' hours applied here</h3><table class="grid"><tbody>
      <tr><td>Continuous driving before a break</td><td class="num">${H.maxContinuousDriveMin / 60}h 30m</td></tr>
      <tr><td>Break length (or 15 + 30 split)</td><td class="num">${H.breakMin} min</td></tr>
      <tr><td>Daily driving</td><td class="num">9h (10h twice a week)</td></tr>
      <tr><td>Duty window, normal daily rest</td><td class="num">13h</td></tr>
      <tr><td>Duty window, reduced daily rest</td><td class="num">15h (3× a week)</td></tr>
      <tr><td>Weekly / fortnightly driving</td><td class="num">56h / 90h</td></tr>
      </tbody></table>
      <div class="card note small" style="margin-top:8px">Loading and offloading is
        <b>other work</b>, not a break. A 45-minute tip does not reset the 4h30 driving clock, and
        this planner will not pretend it does.</div></div>`;

    h += `<div class="sec"><h3>What this tool does and does not know</h3>
      <div class="card small">
        <b>Modelled:</b> ${NET.NODES.size} junctions and towns joined by ${NET.EDGES.length} sections of
        motorway, national, and the regional roads that matter. Signed headroom, tunnel and
        dangerous-goods restrictions, toll plazas, the Dublin five-axle cordon, and width and bend
        ratings for every section.
      </div>
      <div class="card small caution">
        <b>Not modelled:</b> the last few kilometres to a gate, individual bridge weight plates,
        temporary roadworks and diversions, live traffic, and site-specific hardstanding or
        overhead lines. Distances come from the strategic network, so treat them as planning
        figures — within about 10% of the real run, not satnav-exact.
      </div>
      <div class="card small">Always confirm a first-time drop with the site before dispatch, and
        check <a href="https://www.tii.ie" target="_blank" rel="noopener">TII</a> for live
        restrictions.</div></div>`;
    return h;
  }

  function renderPane() {
    $('pane').innerHTML = paneHTML();
    const n = plan && !plan.error
      ? plan.warnings.filter(w => w.severity === 'caution').length + plan.blockers.length : 0;
    const badge = $('b-roads');
    badge.textContent = n;
    badge.className = 'badge' + (plan && plan.blockers.length ? ' bad' : n ? ' warn' : '');
    $('res-sub').textContent = plan && !plan.error
      ? `${run().transportCode} · ${plan.totals.km} km` : '';
  }

  function renderAll() { renderRuns(); renderForm(); renderStops(); renderPane(); drawMap(); save(); }

  // ------------------------------------------------------------- events ---
  $('f-code').innerHTML = VEH.PROFILES.map(p =>
    `<option value="${p.code}">${p.code} — ${p.name}</option>`).join('');

  const bind = (id, ev, fn) => $(id).addEventListener(ev, fn);
  bind('f-driver', 'input', e => { run().driver = e.target.value; renderRuns(); save(); });
  bind('f-date', 'change', e => { run().date = e.target.value; save(); });
  bind('f-start', 'change', e => { run().startTime = e.target.value || '07:00'; invalidate(); });
  bind('f-service', 'change', e => {
    const r = run(); r.defaultServiceMin = Math.max(0, +e.target.value || 0);
    r.stops.forEach((s, i) => { if (i > 0) s.serviceMin = r.defaultServiceMin; });
    invalidate();
  });
  bind('f-code', 'change', e => { run().transportCode = e.target.value; invalidate(); });
  bind('f-adr', 'change', e => { run().adr = e.target.checked; invalidate(); });
  bind('f-return', 'change', e => { run().returnToStart = e.target.checked; invalidate(); });
  for (const [id, key] of [['r-diesel', 'dieselPerLitre'], ['r-driver', 'driverPerHour'], ['r-run', 'runningPerKm']]) {
    bind(id, 'change', e => { state.rates[key] = Math.max(0, +e.target.value || 0); if (plan) computePlan(); else save(); });
  }

  let searchT;
  bind('f-search', 'input', e => {
    clearTimeout(searchT);
    const q = e.target.value;
    searchT = setTimeout(() => renderSearch(searchPlaces(q)), 140);
  });
  bind('f-search', 'keydown', e => {
    if (!searchHits.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + searchHits.length) % searchHits.length;
      [...$('f-results').children].forEach((c, i) => c.classList.toggle('sel', i === searchSel));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      addStop(searchHits[searchSel < 0 ? 0 : searchSel]);
      e.target.value = ''; renderSearch([]);
    } else if (e.key === 'Escape') { renderSearch([]); }
  });
  $('f-results').addEventListener('click', e => {
    const el = e.target.closest('.res'); if (!el) return;
    addStop(searchHits[+el.dataset.i]);
    $('f-search').value = ''; renderSearch([]);
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) renderSearch([]);
  });

  $('stops').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const r = run();
    if (b.dataset.del != null) { r.stops.splice(+b.dataset.del, 1); invalidate(); }
    else if (b.dataset.up != null) {
      const i = +b.dataset.up; if (i > 0) { const [s] = r.stops.splice(i, 1); r.stops.splice(i - 1, 0, s); invalidate(); }
    } else if (b.dataset.down != null) {
      const i = +b.dataset.down; if (i < r.stops.length - 1) { const [s] = r.stops.splice(i, 1); r.stops.splice(i + 1, 0, s); invalidate(); }
    }
  });
  $('stops').addEventListener('change', e => {
    if (e.target.dataset.svc == null) return;
    run().stops[+e.target.dataset.svc].serviceMin = Math.max(0, +e.target.value || 0);
    invalidate();
  });

  $('runs').addEventListener('click', e => {
    const del = e.target.closest('[data-delrun]');
    if (del) {
      e.stopPropagation();
      const i = +del.dataset.delrun;
      if (state.runs.length === 1) { state.runs = [blankRun(1)]; state.active = 0; }
      else { state.runs.splice(i, 1); state.active = Math.min(state.active, state.runs.length - 1); }
      plan = null; fleetRows = null; renderAll(); return;
    }
    const tabEl = e.target.closest('[data-run]');
    if (tabEl) { state.active = +tabEl.dataset.run; plan = null; fleetRows = null; renderAll(); }
  });

  $('tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return;
    tab = t.dataset.tab;
    [...$('tabs').children].forEach(c => c.classList.toggle('on', c === t));
    $('res-title').textContent = { plan: 'Plan', roads: 'Roads', fleet: 'Fleet fit', ref: 'Reference' }[tab];
    renderPane();
  });

  bind('btn-plan', 'click', () => {
    if (run().stops.length < 2) return toast('Add a depot and at least one drop first.');
    computePlan();
    if (tab === 'ref') { tab = 'plan'; [...$('tabs').children].forEach((c, i) => c.classList.toggle('on', i === 0)); }
    renderPane();
  });

  bind('btn-optimise', 'click', () => {
    const r = run();
    if (r.stops.length < 4) return toast('Optimising needs a depot and at least three drops.');
    const v = VEH.resolve(r.transportCode);
    const out = PLAN.optimiseOrder(r.stops, v, { fixedEnd: false, ctx: { adr: r.adr } });
    r.stops = out.stops;
    computePlan();
    toast(out.improvedMin > 0
      ? `Resequenced: ${out.improvedMin} min of driving saved.`
      : 'Already in the best order found.');
  });

  bind('btn-newrun', 'click', () => {
    state.runs.push(blankRun(state.runs.length + 1));
    state.active = state.runs.length - 1; plan = null; fleetRows = null; renderAll();
  });
  bind('btn-duperun', 'click', () => {
    const copy = JSON.parse(JSON.stringify(run()));
    copy.id = 'run' + Math.random().toString(36).slice(2, 8);
    copy.name = run().name + ' copy'; copy._verdict = '';
    state.runs.push(copy); state.active = state.runs.length - 1;
    plan = null; fleetRows = null; renderAll();
  });
  bind('btn-clear', 'click', () => { run().stops = []; invalidate(); });

  bind('btn-csv', 'click', () => {
    const rows = [['run', 'driver', 'date', 'transport_code', 'seq', 'stop', 'lat', 'lon',
      'offload_min', 'arrive', 'leg_km', 'leg_drive_min', 'verdict']];
    for (const r of state.runs) {
      const stops = r.stops.slice();
      if (r.returnToStart && stops.length > 1) stops.push(Object.assign({}, stops[0], { serviceMin: 0 }));
      const p = PLAN.planSchedule(Object.assign({}, r, { stops }), { rates: state.rates });
      if (p.error) continue;
      rows.push([r.name, r.driver, r.date, r.transportCode, 0, stops[0].name,
        stops[0].lat, stops[0].lon, 0, r.startTime, '', '', p.verdict]);
      p.legs.forEach((leg, i) => rows.push([r.name, r.driver, r.date, r.transportCode, i + 1,
        leg.to.name, leg.to.lat, leg.to.lon, leg.to.serviceMin != null ? leg.to.serviceMin : r.defaultServiceMin,
        leg.arriveMin != null ? PLAN.minToHHMM(leg.arriveMin) : '',
        leg.route ? leg.route.km : '', leg.route ? leg.route.driveMin : '',
        leg.route ? 'ok' : 'no-route']));
    }
    const csv = rows.map(r => r.map(c => {
      const s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const fallback = () => {
      // No clipboard API (file:// or an older browser): offer the file instead.
      try {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url; a.download = `schedules-${new Date().toISOString().slice(0, 10)}.csv`;
        a.click(); URL.revokeObjectURL(url);
        toast('Schedule CSV downloaded.');
      } catch (e) { console.log(csv); toast('CSV written to the console.'); }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(csv)
          .then(() => toast('Schedule CSV copied to the clipboard.'))
          .catch(fallback);
      } else fallback();
    } catch (e) { fallback(); }
  });

  $('pane').addEventListener('click', e => {
    const swap = e.target.closest('[data-swap]');
    if (!swap) return;
    run().transportCode = swap.dataset.swap;
    computePlan();
    toast(`Run reassigned to ${swap.dataset.swap}.`);
  });

  // ------------------------------------------------------- first launch ---
  if (!run().stops.length && state.runs.length === 1) {
    // A worked example: a silo delivery run out of Dublin that a 44t artic
    // cannot finish, which is the point the tool exists to make.
    const r = run();
    r.name = 'Example run'; r.driver = 'J. Murphy'; r.transportCode = 'ART-44';
    r.stops = [
      { name: 'Red Cow depot, Dublin', detail: 'M50 J9', lat: 53.3251, lon: -6.3805, serviceMin: 0 },
      { name: 'Naas housing scheme', detail: 'Kildare', lat: 53.2200, lon: -6.6590, serviceMin: 45 },
      { name: 'Kilkenny apartments', detail: 'Kilkenny', lat: 52.6540, lon: -7.2520, serviceMin: 45 },
      { name: 'Kenmare site', detail: 'Kerry', lat: 51.8800, lon: -9.5830, serviceMin: 60 },
    ];
    computePlan();
  } else {
    renderAll();
  }
})();
