/**
 * Delivery planner UI.
 *
 * Left: the order book and the fleet that has to shift it. Middle: the map.
 * Right: the resulting loads, each driver's day, and the roads involved.
 * All the transport logic lives in planner.js / network.js / orders.js.
 */
(function () {
  'use strict';

  const NET = window.RoadNetwork, VEH = window.Vehicles, PLAN = window.Planner,
        ORD = window.Orders, EIR = window.Eircode;
  const SITES = window.SITE_INDEX || { sites: [], authorities: [], categories: [] };
  const SI = { lat: 0, lon: 1, cat: 2, units: 3, auth: 4, ref: 5, granted: 6, addr: 7 };
  const STORE_KEY = 'ie-delivery-planner-v2';

  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r1 = n => Math.round(n * 10) / 10;
  const eur = n => '€' + (Math.round((n || 0) * 100) / 100).toFixed(2);
  const LOAD_COLOURS = ['#38bdf8', '#f59e0b', '#a855f7', '#22c55e', '#f472b6',
    '#facc15', '#2dd4bf', '#fb923c', '#818cf8', '#4ade80'];

  // ------------------------------------------------------------- state ---
  const NAAS = { name: 'Naas depot', eircode: 'W91', lat: 53.2200, lon: -6.6590 };

  const freshFleet = () => ([
    { id: 'V1', driver: 'J. Murphy', transportCode: 'ART-44', startTime: '06:00', maxDutyMin: 780, capacityOverrideT: null },
    { id: 'V2', driver: 'A. Byrne', transportCode: 'RIG-32', startTime: '06:30', maxDutyMin: 780, capacityOverrideT: null },
    { id: 'V3', driver: 'S. Doherty', transportCode: 'RIG-26H', startTime: '07:00', maxDutyMin: 780, capacityOverrideT: null },
  ]);

  let state = load() || {
    pasteText: '',
    deliveries: [], problems: [], importSummary: null,
    depot: Object.assign({}, NAAS),
    fleet: freshFleet(),
    settings: {
      today: new Date().toISOString().slice(0, 10),
      defaultServiceMin: 40, allowReloads: true, reloadMin: 45,
      returnToDepot: false, adr: false, maxDropsPerLoad: 12,
    },
    loadCaps: Object.assign({}, VEH.CLASS_LOAD_CAP_T),
    rates: { dieselPerLitre: 1.75, driverPerHour: 22, runningPerKm: 0.18 },
  };

  let ltab = 'orders', tab = 'loads', result = null, selectedLoad = null;

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        pasteText: state.pasteText, deliveries: state.deliveries, problems: state.problems,
        importSummary: state.importSummary, depot: state.depot, fleet: state.fleet,
        settings: state.settings, loadCaps: state.loadCaps, rates: state.rates,
      }));
    } catch (e) { /* private browsing */ }
  }
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!s || !Array.isArray(s.deliveries)) return null;
      s.loadCaps = Object.assign({}, VEH.CLASS_LOAD_CAP_T, s.loadCaps || {});
      if (!s.fleet || !s.fleet.length) s.fleet = freshFleet();
      return s;
    } catch (e) { return null; }
  }

  let toastT;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 3000);
  }

  // --------------------------------------------------------------- map ---
  const hasMap = typeof L !== 'undefined' && L && typeof L.map === 'function';
  let map, routeLayer, dropLayer;
  if (hasMap) {
    map = L.map('map', { preferCanvas: true }).setView([53.4, -7.9], 7);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO', subdomains: 'abcd', maxZoom: 19,
    }).addTo(map);
    routeLayer = L.layerGroup().addTo(map);
    dropLayer = L.layerGroup().addTo(map);
  } else {
    $('map').innerHTML = '<div class="empty" style="margin:24px">Map tiles could not be loaded, ' +
      'so the map is off. Every load, route and warning still works — read them in the panels either side.</div>';
    $('mapnote').style.display = 'none';
  }

  const colourFor = i => LOAD_COLOURS[i % LOAD_COLOURS.length];
  const loadIndexOf = d => {
    if (!result) return -1;
    return result.loads.findIndex(l => l.deliveries.some(x => x.id === d.id));
  };

  function drawMap() {
    if (!hasMap) return;
    routeLayer.clearLayers(); dropLayer.clearLayers();
    const pts = [];

    L.marker([state.depot.lat, state.depot.lon], {
      icon: L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 13],
        html: '<div class="dropmark depot">D</div>' }),
    }).bindPopup(`<b>${esc(state.depot.name)}</b><br>Depot`).addTo(dropLayer);
    pts.push([state.depot.lat, state.depot.lon]);

    if (result) {
      result.loads.forEach((l, li) => {
        if (!l.plan) return;
        const dim = selectedLoad && selectedLoad !== l.id;
        const colour = colourFor(li);
        for (const leg of l.plan.legs) {
          if (!leg.route) continue;
          for (const s of leg.route.steps) {
            const a = NET.node(s.fromId), b = NET.node(s.toId);
            L.polyline([[a.lat, a.lon], [b.lat, b.lon]], {
              color: s.verdict === 'caution' ? '#f59e0b' : colour,
              weight: dim ? 2 : (s.verdict === 'caution' ? 6 : 4),
              opacity: dim ? 0.28 : 0.9,
            }).bindPopup(`<b>${esc(s.ref)}</b> · ${esc(s.clsLabel)}<br>${esc(s.from)} → ${esc(s.to)}<br>` +
              `${s.km} km · ${s.min} min` + (s.tollEur ? `<br>Toll ${eur(s.tollEur)}` : '') +
              (s.verdict === 'caution' ? '<br><b style="color:#fcd34d">Tight for this vehicle</b>' : ''))
              .addTo(routeLayer);
          }
        }
      });
    }

    state.deliveries.forEach(d => {
      pts.push([d.lat, d.lon]);
      const li = loadIndexOf(d);
      const colour = li < 0 ? '#6b7885' : colourFor(li);
      const dim = selectedLoad && li >= 0 && result.loads[li].id !== selectedLoad;
      let seq = '';
      if (li >= 0) {
        const l = result.loads[li];
        seq = String(l.deliveries.findIndex(x => x.id === d.id) + 1);
      }
      L.marker([d.lat, d.lon], {
        opacity: dim ? 0.45 : 1,
        icon: L.divIcon({ className: '', iconSize: [22, 22], iconAnchor: [11, 11],
          html: `<div class="dropmark" style="background:${colour};color:#06232f">${seq || '·'}</div>` }),
      }).bindPopup(
        `<b>${esc(d.customer || d.ref)}</b><br><span class="mono">${esc(d.eircode)}</span> · ${esc(d.area)}<br>` +
        `${d.weightT != null ? d.weightT + ' t' : 'no weight given'}` +
        (d.dueBy ? ` · due ${esc(d.dueBy)}` : '') +
        `<br><span style="color:${d.precision === 'exact' ? '#86efac' : '#fcd34d'}">` +
        `${d.precision === 'exact' ? 'Exact coordinates' : 'Routing-area centre'}</span>` +
        (li >= 0 ? `<br>Load ${esc(result.loads[li].id)} · ${esc(result.loads[li].driver)}` : '<br><i>Not loaded</i>')
      ).addTo(dropLayer);
    });

    if (pts.length > 1) map.fitBounds(L.latLngBounds(pts).pad(0.15));
    else map.setView(pts[0], 10);
  }

  function drawLegend() {
    const el = $('maplegend');
    if (!result) {
      el.innerHTML = '<div class="lrow"><span class="sw" style="background:#6b7885"></span> Unplanned drop</div>';
      return;
    }
    el.innerHTML = result.loads.filter(l => l.plan).map((l, i) => {
      const li = result.loads.indexOf(l);
      return `<div class="lrow"><span class="sw" style="background:${colourFor(li)}"></span>
        ${esc(l.id)} ${esc(l.transportCode)} · ${l.deliveries.length} drops</div>`;
    }).join('') +
      '<div class="lrow"><span class="sw" style="background:#f59e0b"></span> Tight for that vehicle</div>' +
      '<div class="lrow"><span class="sw" style="background:#6b7885"></span> Not loaded</div>';
  }

  // ------------------------------------------------------------ import ---
  function runImport(text) {
    state.pasteText = text;
    const res = ORD.importDeliveries(text);
    state.deliveries = res.deliveries;
    state.problems = res.problems;
    state.importSummary = res.summary;
    result = null; selectedLoad = null;
    renderAll();
    if (res.deliveries.length) {
      toast(`Imported ${res.deliveries.length} deliveries` +
        (res.problems.length ? `, ${res.problems.length} rejected.` : '.'));
    } else {
      toast('Nothing could be imported — check the Orders panel for why.');
    }
  }

  // ---------------------------------------------------------- left pane ---
  function ordersHTML() {
    const s = state.importSummary;
    let h = `<div class="dropzone" id="dz">Drop a CSV here, or
      <b>choose a file</b> — or paste below.
      <input type="file" id="file" accept=".csv,.tsv,.txt" hidden></div>
      <textarea class="paste" id="paste" spellcheck="false"
        placeholder="Order Ref,Customer,Eircode,Weight (kg),Order Date,Due By&#10;SO-1001,Kelly Builders,W91 P6DF,8400,2026-08-28,2026-09-04">${esc(state.pasteText)}</textarea>
      <div class="btnrow" style="margin:8px 0 4px">
        <button class="btn" id="btn-import">Import orders</button>
        <button class="btn small" id="btn-sample">Load sample</button>
        <button class="btn small ghost danger" id="btn-clear-orders">Clear</button>
      </div>`;

    if (s && s.imported != null) {
      h += `<div class="card note small" style="margin-top:10px">
        <b>What was read</b><br>
        ${s.imported} orders${s.rejected ? `, ${s.rejected} rejected` : ''} ·
        ${s.delim === ',' ? 'comma' : s.delim}-separated${s.hasHeader ? ' with a header row' : ', no header'}<br>
        Weights taken as <b>${s.weightUnit === 'kg' ? 'kilograms' : 'tonnes'}</b> — ${esc(s.weightWhy)}.
        Total ${s.totalT} t${s.missingWeight ? ` · ${s.missingWeight} with no weight` : ''}<br>
        Located: ${s.exact} from coordinates, ${s.routingKeyOnly} from the Eircode routing area.
      </div>`;
    }

    if (state.problems.length) {
      h += `<div class="sec"><h3>Rejected lines</h3>` +
        state.problems.map(p => `<div class="card block small">
          <b>Line ${p.line}</b> — ${esc(p.reason)}
          <div class="mono dim" style="margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.raw || '')}</div>
        </div>`).join('') + `</div>`;
    }

    h += `<div class="sec"><h3>Deliveries <span class="dim">${state.deliveries.length}</span></h3>`;
    if (!state.deliveries.length) {
      h += `<div class="empty">No orders loaded.<br>Paste your delivery list above,
        or press <b>Load sample</b> to see the shape.</div>`;
    } else {
      h += state.deliveries.map(d => {
        const li = loadIndexOf(d);
        const colour = li < 0 ? 'transparent' : colourFor(li);
        return `<div class="orow" data-drop="${esc(d.id)}">
          <span class="swatch" style="background:${colour}"></span>
          <span>
            <div class="r1">${esc(d.customer || d.ref)}</div>
            <div class="r2"><span class="prec ${d.precision}"></span>${esc(d.eircode)} · ${esc(d.area)}${d.dueBy ? ' · due ' + esc(d.dueBy) : ''}</div>
          </span>
          <span class="wt">${d.weightT != null ? d.weightT + 't' : '—'}</span>
          <button class="iconbtn del" data-deldrop="${esc(d.id)}" title="Remove">✕</button>
        </div>`;
      }).join('');
    }
    h += `</div>`;
    return h;
  }

  function fleetHTML() {
    let h = `<div class="sec"><h3>Depot</h3>
      <div class="field">
        <div class="search-wrap">
          <input type="text" id="depot-q" autocomplete="off" spellcheck="false"
            placeholder="Eircode, town, or 53.2200,-6.6590" value="">
          <div class="results" id="depot-results"></div>
        </div>
        <div class="small dim" style="margin-top:5px">Now: <b>${esc(state.depot.name)}</b>
          <span class="mono">${state.depot.lat.toFixed(4)}, ${state.depot.lon.toFixed(4)}</span></div>
      </div></div>`;

    h += `<div class="sec"><h3>Vehicles and drivers</h3>`;
    h += state.fleet.map(f => {
      const v = VEH.resolve(f.transportCode, { loadCaps: state.loadCaps });
      const cap = f.capacityOverrideT != null ? f.capacityOverrideT : (v ? v.capacityT : 0);
      return `<div class="frow" data-veh="${esc(f.id)}">
        <div class="hd"><span class="nm">${esc(f.id)}</span>
          <button class="iconbtn del" data-delveh="${esc(f.id)}" title="Remove vehicle">✕</button></div>
        <div class="full"><label>Driver</label>
          <input type="text" data-f="driver" value="${esc(f.driver)}" placeholder="Name"></div>
        <div class="full"><label>Transport code</label>
          <select data-f="transportCode">${VEH.PROFILES.map(p =>
            `<option value="${p.code}"${p.code === f.transportCode ? ' selected' : ''}>${p.code} — ${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Start</label><input type="time" data-f="startTime" value="${esc(f.startTime)}" step="300"></div>
        <div><label>Max duty (h)</label>
          <input type="number" data-f="maxDutyH" value="${(f.maxDutyMin / 60).toFixed(1)}" min="1" max="15" step="0.5"></div>
        <div class="full"><label>Load capacity (t)</label>
          <input type="number" data-f="capacityOverrideT" value="${cap}" min="0" step="0.5">
          <div class="small dim" style="margin-top:4px">
            ${v ? `${v.payloadT}t payload on the plate, capped at ${v.capacityT}t by the
              ${esc(v.form)} rule${v.grossWarning ? ' · ⚠ ' + esc(v.grossWarning) : ''}` : ''}
          </div></div>
      </div>`;
    }).join('');
    h += `<div class="btnrow"><button class="btn small" id="btn-addveh">Add a vehicle</button>
      <button class="btn small ghost" id="btn-resetfleet">Reset fleet</button></div></div>`;

    h += `<div class="sec"><h3>Maximum load by body type</h3>
      <div class="row">
        <div class="field"><label>Artic (t)</label>
          <input type="number" id="cap-artic" value="${state.loadCaps.artic}" min="0" step="0.5"></div>
        <div class="field"><label>Rigid (t)</label>
          <input type="number" id="cap-rigid" value="${state.loadCaps.rigid}" min="0" step="0.5"></div>
        <div class="field"><label>Van (t)</label>
          <input type="number" id="cap-van" value="${state.loadCaps.van}" min="0" step="0.1"></div>
      </div>
      <div class="small dim">A ceiling applied on top of each vehicle's plated payload — the
        lower of the two is what gets loaded. Irish gross limits mean a 4-axle rigid plates at 32t,
        so its payload lands near 20t; raise a vehicle's own capacity above that only if your
        plating genuinely allows it.</div></div>`;
    return h;
  }

  function settingsHTML() {
    const s = state.settings;
    return `<div class="sec"><h3>Planning day</h3>
      <div class="row">
        <div class="field"><label>Date</label><input type="date" id="s-today" value="${esc(s.today)}"></div>
        <div class="field"><label>Default offload (min)</label>
          <input type="number" id="s-service" value="${s.defaultServiceMin}" min="0" step="5"></div>
      </div>
      <label class="check"><input type="checkbox" id="s-reload"${s.allowReloads ? ' checked' : ''}>
        Allow reloading at the depot for a second or third run</label>
      <div class="field"><label>Reload time (min)</label>
        <input type="number" id="s-reloadmin" value="${s.reloadMin}" min="0" step="5"></div>
      <label class="check"><input type="checkbox" id="s-return"${s.returnToDepot ? ' checked' : ''}>
        Finish the day back at the depot</label>
      <label class="check"><input type="checkbox" id="s-adr"${s.adr ? ' checked' : ''}>
        Loads include dangerous goods (ADR)</label>
      <div class="field"><label>Maximum drops per vehicle per day</label>
        <input type="number" id="s-maxdrops" value="${s.maxDropsPerLoad}" min="1" max="40" step="1"></div>
    </div>

    <div class="sec"><h3>Operating rates</h3>
      <div class="row">
        <div class="field"><label>Diesel €/l</label>
          <input type="number" id="r-diesel" value="${state.rates.dieselPerLitre}" step="0.01" min="0"></div>
        <div class="field"><label>Driver €/h</label>
          <input type="number" id="r-driver" value="${state.rates.driverPerHour}" step="0.5" min="0"></div>
        <div class="field"><label>Running €/km</label>
          <input type="number" id="r-run" value="${state.rates.runningPerKm}" step="0.01" min="0"></div>
      </div>
    </div>`;
  }

  // --------------------------------------------------------- right pane ---
  function loadsHTML() {
    if (!result) {
      return `<div class="empty">Load an order book and press <b>Build the plan</b>.<br><br>
        Each drop is checked against the vehicle assigned to it: weight against capacity,
        roads against the vehicle's dimensions, and the whole day against EU drivers' hours.</div>`;
    }
    const s = result.summary;
    let h = `<div class="kpis">
      <div class="kpi"><div class="n">${s.loaded}/${s.deliveries}</div><div class="l">orders loaded</div></div>
      <div class="kpi"><div class="n">${s.loadedT}t</div><div class="l">of ${s.totalT}t</div></div>
      <div class="kpi"><div class="n">${s.km}</div><div class="l">km</div></div>
      <div class="kpi"><div class="n">${eur(s.costEur)}</div><div class="l">${eur(s.costPerTonne)}/t</div></div>
    </div>`;

    if (s.unassigned) {
      h += `<div class="verdict v-caution"><div class="ico">!</div><div>
        <div class="vt">${s.unassigned} order${s.unassigned > 1 ? 's' : ''} did not make it onto a truck</div>
        <div class="vs">Listed at the bottom with the reason for each.</div></div></div>`;
    } else if (s.deliveries) {
      h += `<div class="verdict v-clear"><div class="ico">✓</div><div>
        <div class="vt">Every order is on a truck</div>
        <div class="vs">${s.vehiclesUsed} vehicle${s.vehiclesUsed > 1 ? 's' : ''},
          ${s.trips} run${s.trips > 1 ? 's' : ''}, ${PLAN.minToHrs(s.driveMin)} driving in total.</div></div></div>`;
    }

    h += `<div class="sec"><h3>Loads</h3>`;
    result.loads.forEach((l, li) => {
      const colour = colourFor(li);
      if (!l.plan) {
        h += `<div class="load idle"><div class="lh">
          <span class="cid" style="background:var(--line2)"></span>
          <span class="who"><span class="a">${esc(l.id)} · ${esc(l.driver || 'unassigned')}</span>
            <div class="b">${esc(l.transportCode)} — nothing to carry</div></span>
          <span class="figs">idle</span></div></div>`;
        return;
      }
      const p = l.plan;
      h += `<div class="load${selectedLoad === l.id ? ' sel' : ''}" data-load="${esc(l.id)}">
        <div class="lh">
          <span class="cid" style="background:${colour}"></span>
          <span class="who"><span class="a">${esc(l.id)} · ${esc(l.driver || 'unassigned')}</span>
            <div class="b">${esc(l.transportCode)} · ${l.trips.length} run${l.trips.length > 1 ? 's' : ''} · ${l.deliveries.length} drops</div></span>
          <span class="figs">${p.totals.km} km · ${PLAN.minToHrs(p.totals.driveMin)}<br>
            ${PLAN.minToHHMM(PLAN.hhmmToMin(l.startTime))}–${PLAN.minToHHMM(p.endMin)} ·
            <span class="pill ${p.verdict}">${p.verdict}</span></span>
        </div>
        <div class="lb">
          <div class="bar"><i style="width:${Math.min(100, l.utilPct)}%;background:${l.utilPct > 95 ? '#f59e0b' : colour}"></i></div>
          <div class="small dim">Heaviest run ${l.peakTripT}t of ${l.capacityT}t (${l.utilPct}%) ·
            ${l.weightT}t moved over the day · ${eur(p.money.totalEur)}</div>`;
      l.trips.forEach((t, ti) => {
        h += `<div class="trip"><div class="th">Run ${ti + 1} — ${r1(t.reduce((a, d) => a + (d.weightT || 0), 0))}t</div>` +
          t.map((d, i) => `<div class="d"><span class="n">${i + 1}</span>
            <span class="p">${esc(d.customer || d.ref)} <span class="dim">${esc(d.eircode)}</span></span>
            <span class="dim">${d.weightT != null ? d.weightT + 't' : '—'}</span></div>`).join('') +
          `</div>`;
      });
      h += `</div></div>`;
    });
    h += `</div>`;

    if (result.unassigned.length) {
      h += `<div class="sec"><h3>Not loaded</h3>` + result.unassigned.map(u => `
        <div class="card caution small"><b>${esc(u.delivery.ref)}</b> —
          ${esc(u.delivery.customer || '')} <span class="mono dim">${esc(u.delivery.eircode)}</span>
          ${u.delivery.weightT != null ? '· ' + u.delivery.weightT + 't' : ''}
          ${u.delivery.dueBy ? '· due ' + esc(u.delivery.dueBy) : ''}
          <div class="muted" style="margin-top:4px">${esc(u.reason.text)}</div></div>`).join('') + `</div>`;
    }
    return h;
  }

  const currentLoad = () => result && (result.loads.find(l => l.id === selectedLoad) ||
    result.loads.find(l => l.plan)) || null;

  function dayHTML() {
    const l = currentLoad();
    if (!l || !l.plan) return `<div class="empty">Build a plan, then pick a load to see the driver's day.</div>`;
    const p = l.plan, m = p.money;
    const V = {
      clear: ['✓', 'Cleared to run', 'Roads suit the vehicle and the day is inside EU drivers\' hours.'],
      caution: ['!', 'Runnable, with cautions', 'Includes sections that are tight for this vehicle.'],
      illegal: ['✕', 'Breaches drivers\' hours', 'The roads are fine but the day cannot legally be driven.'],
      blocked: ['✕', 'Not drivable as loaded', 'This vehicle cannot complete the run as built.'],
    }[p.verdict] || ['!', p.verdict, ''];

    let h = `<div class="verdict v-${p.verdict}"><div class="ico">${V[0]}</div><div>
      <div class="vt">${l.id} · ${esc(l.driver)} — ${V[1]}</div>
      <div class="vs">${V[2]}</div></div></div>`;

    h += `<div class="kpis">
      <div class="kpi"><div class="n">${p.totals.km}</div><div class="l">km</div></div>
      <div class="kpi"><div class="n">${PLAN.minToHrs(p.totals.driveMin)}</div><div class="l">driving</div></div>
      <div class="kpi"><div class="n">${PLAN.minToHrs(p.totals.dutyMin)}</div><div class="l">duty</div></div>
      <div class="kpi"><div class="n">${eur(m.totalEur)}</div><div class="l">all-in</div></div></div>`;

    if (p.blockers.length) {
      h += `<div class="sec"><h3>Blockers</h3>` +
        p.blockers.map(b => `<div class="card block">${esc(b.text)}</div>`).join('') + `</div>`;
    }
    if (p.compliance.violations.length || p.compliance.notes.length) {
      h += `<div class="sec"><h3>Drivers' hours — EU 561/2006</h3>` +
        p.compliance.violations.map(x => `<div class="card block">${esc(x)}</div>`).join('') +
        p.compliance.notes.map(x => `<div class="card note small">${esc(x)}</div>`).join('') + `</div>`;
    }

    h += `<div class="sec"><h3>The day</h3><div class="tl">` +
      p.timeline.filter(e => e.min > 0 || e.type === 'depart').map(e => `
        <div class="ev ${e.type}">
          <span class="t">${PLAN.minToHHMM(e.startMin)}${e.min ? '–' + PLAN.minToHHMM(e.endMin) : ''}</span>
          <span class="pip"></span><span class="lbl">${esc(e.label)}</span>
          <span class="dur">${e.min ? e.min + 'm' : ''}</span></div>`).join('') +
      `</div><div class="small dim" style="margin-top:7px">Ends ${PLAN.minToHHMM(p.endMin)} ·
        ${PLAN.minToHrs(p.totals.breakMin)} statutory break ·
        ${PLAN.minToHrs(p.totals.workMin)} at the kerb</div></div>`;

    h += `<div class="sec"><h3>Route per leg</h3>`;
    p.legs.forEach((leg, i) => {
      if (!leg.route) {
        h += `<div class="card block small">${i + 1}. ${esc(leg.from.name)} → ${esc(leg.to.name)}:
          no legal route for ${esc(l.transportCode)}.
          ${leg.suggestion ? `A ${esc(leg.suggestion.code)} could do it.` : ''}</div>`;
        return;
      }
      h += `<div class="card" style="padding:9px 10px">
        <div style="display:flex;gap:8px"><b>${i + 1}. ${esc(leg.to.name)}</b>
          <span style="flex:1"></span>
          <span class="mono dim small">${leg.route.km} km · ${PLAN.minToHrs(leg.route.driveMin)}</span></div>
        <div class="leglist" style="margin-top:5px">` +
        leg.route.itinerary.map(s => `<div class="l ${s.verdict}">
          <span class="ref">${esc(s.ref)}</span>
          <span class="to">→ ${esc(s.to)}${s.verdict === 'caution' ? ' ⚠' : ''}</span>
          <span class="km">${s.km} km</span></div>`).join('') +
        `</div><div class="small dim" style="margin-top:6px">${esc(leg.access.advice)}</div></div>`;
    });
    h += `</div>`;

    h += `<div class="sec"><h3>Cost</h3><table class="grid">
      <tr><td>Diesel · ${p.vehicle.lPer100} l/100km</td><td class="num">${eur(m.fuelEur)}</td></tr>
      <tr><td>Running</td><td class="num">${eur(m.runningEur)}</td></tr>
      <tr><td>Driver · ${PLAN.minToHrs(p.totals.dutyMin)}</td><td class="num">${eur(m.driverEur)}</td></tr>
      <tr><td>Tolls</td><td class="num">${eur(m.tollEur)}</td></tr>
      <tr><td><b>Total</b></td><td class="num"><b>${eur(m.totalEur)}</b></td></tr>
      <tr><td class="dim">Per tonne carried</td><td class="num dim">${eur(m.totalEur / Math.max(0.001, l.weightT))}</td></tr>
      </table></div>`;
    return h;
  }

  function roadsHTML() {
    const l = currentLoad();
    if (!l || !l.plan) return `<div class="empty">Build a plan, then pick a load.</div>`;
    const p = l.plan, v = p.vehicle;
    const roads = new Map();
    for (const leg of p.legs) {
      if (!leg.route) continue;
      for (const s of leg.route.steps) {
        const cur = roads.get(s.ref) || { ref: s.ref, cls: s.clsLabel, km: 0, verdict: 'ok', toll: 0 };
        cur.km = r1(cur.km + s.km); cur.toll = r1(cur.toll + s.tollEur);
        if (s.verdict === 'caution') cur.verdict = 'caution';
        roads.set(s.ref, cur);
      }
    }
    let h = `<div class="card" style="margin-bottom:14px"><b>${esc(v.code)}</b> — ${esc(v.name)}<br>
      <span class="mono small dim">${v.lengthM}m · ${v.heightM.toFixed(2)}m high · ${v.gvwT}t on ${v.axles} axles ·
      carrying ${l.peakTripT}t of ${l.capacityT}t</span>
      <div class="small muted" style="margin-top:5px">Needs a running lane of at least
        <b>${NET.widthNeedM(v).toFixed(2)}m</b>.</div></div>`;

    const warn = p.warnings.filter(w => w.severity === 'caution');
    h += `<div class="sec"><h3>Road warnings</h3>`;
    if (!warn.length && !p.blockers.length) {
      h += `<div class="card ok small">Nothing tight or restricted on this load's route.</div>`;
    }
    h += p.blockers.map(b => `<div class="card block small">${esc(b.text)}</div>`).join('');
    h += [...new Set(warn.map(w => w.text))].map(t => `<div class="card caution small">${esc(t)}</div>`).join('');
    h += `</div>`;

    h += `<div class="sec"><h3>Roads used</h3><table class="grid">
      <thead><tr><th>Road</th><th>Class</th><th style="text-align:right">km</th>
      <th style="text-align:right">Toll</th><th>Verdict</th></tr></thead><tbody>` +
      [...roads.values()].sort((a, b) => b.km - a.km).map(rd => `<tr>
        <td class="mono">${esc(rd.ref)}</td><td class="dim">${esc(rd.cls)}</td>
        <td class="num">${rd.km}</td><td class="num">${rd.toll ? eur(rd.toll) : '—'}</td>
        <td><span class="pill ${rd.verdict}">${rd.verdict === 'ok' ? 'suited' : 'tight'}</span></td></tr>`).join('') +
      `</tbody></table></div>`;

    h += `<div class="sec"><h3>Final mile at each drop</h3><table class="grid">
      <thead><tr><th>Drop</th><th style="text-align:right">Off network</th><th>Risk</th></tr></thead><tbody>` +
      p.legs.map((leg, i) => `<tr>
        <td>${i + 1}. ${esc(leg.to.name)}<div class="small dim">${esc(leg.access.advice)}</div></td>
        <td class="num">${leg.access.approachKm} km</td>
        <td><span class="pill ${leg.access.level === 'low' ? 'ok' : leg.access.level === 'medium' ? 'caution' : 'block'}">${leg.access.level}</span></td>
      </tr>`).join('') + `</tbody></table></div>`;
    return h;
  }

  function refHTML() {
    let h = `<div class="sec"><h3>How an Eircode is located</h3>
      <div class="card small">
        An Eircode is a three-character <b>routing key</b> naming a post town, then a
        four-character <b>unique identifier</b> for one letterbox. The identifier is deliberately
        non-geographic — no arithmetic turns it into a coordinate, and address-level lookup needs
        the licensed Eircode Address Database.
      </div>
      <div class="card small caution">
        So a drop given only as an Eircode is placed at the centre of its routing area — the right
        town, not the right gate. All ${EIR.KEYS.size} routing keys are built in.
        <b>If your order export has latitude and longitude, include them</b>: they override the
        Eircode and are shown with a green dot in the order list.
      </div>
      <div class="card small">Codes are validated as you import: the identifier never contains
        B, I, O, Q, S, U or Z, so a mistyped letter is rejected rather than silently mislocated.</div>
    </div>`;

    h += `<div class="sec"><h3>Order file columns</h3>
      <div class="card small">Headers are matched loosely, so most order-system exports import
      as they are. Recognised, in any order and any letter case:</div>
      <table class="grid"><tbody>
        <tr><td><b>Eircode</b></td><td class="dim">eircode, postcode, post code</td></tr>
        <tr><td><b>Weight</b></td><td class="dim">weight, kg, tonnes, mass — unit detected from the header, or from the size of the numbers</td></tr>
        <tr><td>Reference</td><td class="dim">order no, ref, docket, job number, id</td></tr>
        <tr><td>Customer</td><td class="dim">customer, consignee, deliver to, site, name</td></tr>
        <tr><td>Order date</td><td class="dim">order date, date placed, ordered on</td></tr>
        <tr><td>Due by</td><td class="dim">due, required, deliver by, promise date</td></tr>
        <tr><td>Offload</td><td class="dim">service, unload, dwell, minutes</td></tr>
        <tr><td>Coordinates</td><td class="dim">lat / latitude and lon / lng / longitude</td></tr>
        <tr><td>Notes</td><td class="dim">notes, comment, instructions</td></tr>
      </tbody></table>
      <div class="small dim" style="margin-top:6px">Comma, tab, semicolon and pipe separated files
        all work, with or without a header row. Dates are read day-first.</div></div>`;

    h += `<div class="sec"><h3>How orders are prioritised</h3>
      <div class="card small">Overdue orders first, then by due date, then oldest order date.
        An order's urgency is converted into minutes of detour the planner will accept to take it
        today, so an overdue drop can pull a load off the most efficient line — which is usually
        what you want.</div></div>`;

    h += `<div class="sec"><h3>Transport codes</h3><table class="grid">
      <thead><tr><th>Code</th><th style="text-align:right">L × H</th><th style="text-align:right">Gross</th>
      <th style="text-align:right">Axles</th><th style="text-align:right">Capacity</th></tr></thead><tbody>` +
      VEH.PROFILES.map(p => {
        const v = VEH.resolve(p.code, { loadCaps: state.loadCaps });
        return `<tr><td><b class="mono">${esc(p.code)}</b><div class="small dim">${esc(p.body)}</div></td>
          <td class="num">${p.lengthM}m<br>${p.heightM.toFixed(2)}m</td>
          <td class="num">${p.gvwT}t</td><td class="num">${p.axles}</td>
          <td class="num">${v.capacityT}t</td></tr>`;
      }).join('') + `</tbody></table>
      <div class="small dim" style="margin-top:6px">Capacity is plated payload capped by the body-type
        rule set on the Fleet tab.</div></div>`;

    h += `<div class="sec"><h3>Access restrictions</h3>` +
      Object.values(NET.ZONES).map(z => `<div class="card ${z.severity === 'block' ? 'block' : 'note'}">
        <b>${esc(z.name)}</b><div class="small muted" style="margin-top:4px">${esc(z.rule)}</div>
        ${z.permit ? `<div class="small dim" style="margin-top:4px">${esc(z.permit)}</div>` : ''}</div>`).join('') +
      `</div>`;

    h += `<div class="sec"><h3>Roads never to send a lorry down</h3><table class="grid"><tbody>` +
      NET.KNOWN_TRAPS.map(t => `<tr><td><b>${esc(t.road)}</b>
        <div class="small dim">${esc(t.why)}</div></td></tr>`).join('') + `</tbody></table></div>`;

    h += `<div class="sec"><h3>Tolls by axle class (${esc(NET.TOLLS.ratesAsOf)}, indicative)</h3>
      <table class="grid"><thead><tr><th>Plaza</th><th style="text-align:right">Car</th>
      <th style="text-align:right">2-axle</th><th style="text-align:right">3-axle</th>
      <th style="text-align:right">4+ axle</th></tr></thead><tbody>` +
      Object.values(NET.TOLLS.plazas).map(p => `<tr><td>${esc(p.name)}
        ${p.note ? `<div class="small dim">${esc(p.note)}</div>` : ''}</td>
        <td class="num">${eur(p.car)}</td><td class="num">${eur(p.hgv2)}</td>
        <td class="num">${eur(p.hgv3)}</td><td class="num">${eur(p.hgv4)}</td></tr>`).join('') +
      `</tbody></table></div>`;

    h += `<div class="sec"><h3>What this tool does and does not know</h3>
      <div class="card small"><b>Modelled:</b> ${NET.NODES.size} junctions and towns joined by
        ${NET.EDGES.length} sections of motorway, national and significant regional road across
        Ireland and Northern Ireland; signed headroom, weight and length limits; tunnel and
        dangerous-goods restrictions; toll plazas by axle class; the Dublin five-axle HGV cordon;
        and EU 561/2006 drivers' hours.</div>
      <div class="card small caution"><b>Not modelled:</b> the last few kilometres to a gate,
        individual bridge weight plates, roadworks, live traffic, delivery time windows, and
        site-specific access. Distances are planning figures — within about 10% of the real run.</div>
    </div>`;
    return h;
  }

  // ------------------------------------------------------------- render ---
  function renderLeft() {
    $('lpane').innerHTML = ltab === 'orders' ? ordersHTML()
      : ltab === 'fleet' ? fleetHTML() : settingsHTML();
    $('b-orders').textContent = state.deliveries.length;
    $('b-orders').className = 'badge' + (state.problems.length ? ' warn' : '');
    $('b-fleet').textContent = state.fleet.length;
  }

  function renderRight() {
    $('pane').innerHTML = tab === 'loads' ? loadsHTML()
      : tab === 'day' ? dayHTML() : tab === 'roads' ? roadsHTML() : refHTML();
    const l = currentLoad();
    const n = l && l.plan
      ? l.plan.warnings.filter(w => w.severity === 'caution').length + l.plan.blockers.length : 0;
    const b = $('b-roads');
    b.textContent = n;
    b.className = 'badge' + (l && l.plan && l.plan.blockers.length ? ' bad' : n ? ' warn' : '');
    $('res-sub').textContent = result
      ? `${result.summary.loaded}/${result.summary.deliveries} loaded · ${result.summary.km} km` : '';
  }

  function renderAll() { renderLeft(); renderRight(); drawMap(); drawLegend(); save(); }

  // ------------------------------------------------------------ planning --
  /**
   * A big order book takes a couple of seconds, and the work is synchronous.
   * Paint the button as busy first, then yield a frame so the browser actually
   * shows it before the main thread is tied up.
   */
  function buildPlan(done) {
    const finish = typeof done === 'function' ? done : null;
    if (!state.deliveries.length) { toast('Import some orders first.'); return finish && finish(); }
    if (!state.fleet.length) { toast('Add at least one vehicle on the Fleet tab.'); return finish && finish(); }
    const btn = $('btn-plan');
    btn.disabled = true; btn.textContent = 'Planning…';
    requestAnimationFrame(() => setTimeout(() => {
      try { runPlan(); } finally {
        btn.disabled = false; btn.textContent = 'Build the plan';
        if (finish) finish();
      }
    }, 0));
  }

  function runPlan() {
    const fleet = state.fleet.map(f => Object.assign({}, f, { depot: state.depot }));
    const t0 = performance.now();
    result = PLAN.buildDayPlan(state.deliveries, fleet, {
      today: state.settings.today,
      rates: state.rates,
      defaultServiceMin: state.settings.defaultServiceMin,
      allowReloads: state.settings.allowReloads,
      reloadMin: state.settings.reloadMin,
      returnToDepot: state.settings.returnToDepot,
      maxDropsPerLoad: state.settings.maxDropsPerLoad,
      adr: state.settings.adr,
      loadCaps: state.loadCaps,
    });
    const first = result.loads.find(l => l.plan);
    selectedLoad = first ? first.id : null;
    renderAll();
    toast(`Planned ${result.summary.loaded} of ${result.summary.deliveries} orders across ` +
      `${result.summary.vehiclesUsed} vehicles in ${Math.round(performance.now() - t0)} ms.`);
  }

  // -------------------------------------------------------------- events --
  $('ltabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return;
    ltab = t.dataset.ltab;
    [...$('ltabs').children].forEach(c => c.classList.toggle('on', c === t));
    renderLeft();
  });
  $('tabs').addEventListener('click', e => {
    const t = e.target.closest('.tab'); if (!t) return;
    tab = t.dataset.tab;
    [...$('tabs').children].forEach(c => c.classList.toggle('on', c === t));
    $('res-title').textContent =
      { loads: 'Plan', day: 'Driver day', roads: 'Roads', ref: 'Reference' }[tab];
    renderRight();
  });

  $('btn-plan').addEventListener('click', () => buildPlan());

  // ---- left pane delegation (contents are re-rendered, so delegate) ----
  $('lpane').addEventListener('click', e => {
    const id = e.target.id;
    if (id === 'btn-import') return runImport($('paste').value);
    if (id === 'btn-sample') { $('paste').value = ORD.SAMPLE; return runImport(ORD.SAMPLE); }
    if (id === 'btn-clear-orders') {
      state.pasteText = ''; state.deliveries = []; state.problems = []; state.importSummary = null;
      result = null; selectedLoad = null; return renderAll();
    }
    if (id === 'dz' || e.target.closest('#dz')) return $('file').click();
    if (id === 'btn-addveh') {
      const n = state.fleet.length + 1;
      state.fleet.push({ id: 'V' + n, driver: '', transportCode: 'RIG-26H',
        startTime: '07:00', maxDutyMin: 780, capacityOverrideT: null });
      return renderLeft();
    }
    if (id === 'btn-resetfleet') { state.fleet = freshFleet(); return renderLeft(); }

    const delv = e.target.closest('[data-delveh]');
    if (delv) {
      state.fleet = state.fleet.filter(f => f.id !== delv.dataset.delveh);
      return renderLeft();
    }
    const deld = e.target.closest('[data-deldrop]');
    if (deld) {
      state.deliveries = state.deliveries.filter(d => d.id !== deld.dataset.deldrop);
      result = null; return renderAll();
    }
    const row = e.target.closest('[data-drop]');
    if (row && hasMap) {
      const d = state.deliveries.find(x => x.id === row.dataset.drop);
      if (d) map.setView([d.lat, d.lon], 11);
    }
  });

  $('lpane').addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'file' && t.files && t.files[0]) {
      const fr = new FileReader();
      fr.onload = () => { $('paste').value = fr.result; runImport(String(fr.result)); };
      fr.readAsText(t.files[0]);
      return;
    }
    const veh = t.closest('[data-veh]');
    if (veh && t.dataset.f) {
      const f = state.fleet.find(x => x.id === veh.dataset.veh);
      if (!f) return;
      const k = t.dataset.f;
      if (k === 'maxDutyH') f.maxDutyMin = Math.round(Math.max(1, +t.value || 13) * 60);
      else if (k === 'capacityOverrideT') f.capacityOverrideT = t.value === '' ? null : Math.max(0, +t.value);
      else f[k] = t.value;
      result = null;
      return renderAll();
    }
    const caps = { 'cap-artic': 'artic', 'cap-rigid': 'rigid', 'cap-van': 'van' };
    if (caps[t.id]) {
      state.loadCaps[caps[t.id]] = Math.max(0, +t.value || 0);
      state.fleet.forEach(f => { f.capacityOverrideT = null; });
      result = null; return renderAll();
    }
    const S = state.settings;
    switch (t.id) {
      case 's-today': S.today = t.value; break;
      case 's-service': S.defaultServiceMin = Math.max(0, +t.value || 0); break;
      case 's-reload': S.allowReloads = t.checked; break;
      case 's-reloadmin': S.reloadMin = Math.max(0, +t.value || 0); break;
      case 's-return': S.returnToDepot = t.checked; break;
      case 's-adr': S.adr = t.checked; break;
      case 's-maxdrops': S.maxDropsPerLoad = Math.max(1, +t.value || 12); break;
      case 'r-diesel': state.rates.dieselPerLitre = Math.max(0, +t.value || 0); break;
      case 'r-driver': state.rates.driverPerHour = Math.max(0, +t.value || 0); break;
      case 'r-run': state.rates.runningPerKm = Math.max(0, +t.value || 0); break;
      default: return;
    }
    result = null; renderAll();
  });

  $('lpane').addEventListener('input', e => {
    if (e.target.id === 'paste') { state.pasteText = e.target.value; return; }
    if (e.target.id === 'depot-q') return depotSearch(e.target.value);
    const veh = e.target.closest('[data-veh]');
    if (veh && e.target.dataset.f === 'driver') {
      const f = state.fleet.find(x => x.id === veh.dataset.veh);
      if (f) { f.driver = e.target.value; save(); }
    }
  });

  // Drag and drop a CSV anywhere over the orders panel.
  $('lpane').addEventListener('dragover', e => {
    const dz = e.target.closest('#dz'); if (!dz) return;
    e.preventDefault(); dz.classList.add('over');
  });
  $('lpane').addEventListener('dragleave', e => {
    const dz = e.target.closest('#dz'); if (dz) dz.classList.remove('over');
  });
  $('lpane').addEventListener('drop', e => {
    const dz = e.target.closest('#dz'); if (!dz) return;
    e.preventDefault(); dz.classList.remove('over');
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    const fr = new FileReader();
    fr.onload = () => runImport(String(fr.result));
    fr.readAsText(f);
  });

  // ---- depot picker ----
  let depotHits = [];
  function depotSearch(q) {
    const box = $('depot-results'); if (!box) return;
    q = String(q || '').trim();
    if (q.length < 2) { box.innerHTML = ''; depotHits = []; return; }
    const hits = [];
    const coord = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(q);
    if (coord) {
      hits.push({ name: `${+coord[1]}, ${+coord[2]}`, detail: 'Coordinates',
        lat: +coord[1], lon: +coord[2] });
    }
    for (const a of EIR.search(q).slice(0, 8)) {
      hits.push({ name: a.town, detail: `${a.key} · ${a.county}`, lat: a.lat, lon: a.lon, eircode: a.key });
    }
    const needle = q.toLowerCase();
    for (const n of NET.NODES.values()) {
      if (hits.length > 16) break;
      if (n.name.toLowerCase().includes(needle) && !hits.some(h => h.name === n.name)) {
        hits.push({ name: n.name, detail: `${n.county} · network node`, lat: n.lat, lon: n.lon });
      }
    }
    for (let i = 0; i < SITES.sites.length && hits.length < 22; i++) {
      const s = SITES.sites[i];
      if ((s[SI.addr] || '').toLowerCase().includes(needle)) {
        hits.push({ name: s[SI.addr], detail: `${SITES.authorities[s[SI.auth]]} · site`,
          lat: s[SI.lat], lon: s[SI.lon] });
      }
    }
    depotHits = hits;
    box.innerHTML = hits.map((h, i) =>
      `<div class="res" data-di="${i}"><div class="r1">${esc(h.name)}</div>
       <div class="r2">${esc(h.detail)}</div></div>`).join('');
  }
  $('lpane').addEventListener('click', e => {
    const r = e.target.closest('[data-di]'); if (!r) return;
    const h = depotHits[+r.dataset.di];
    state.depot = { name: h.name, lat: h.lat, lon: h.lon, eircode: h.eircode || '' };
    result = null; renderAll();
    toast(`Depot set to ${h.name}.`);
  });

  // ---- selecting a load ----
  $('pane').addEventListener('click', e => {
    const el = e.target.closest('[data-load]'); if (!el) return;
    selectedLoad = el.dataset.load;
    renderRight(); drawMap();
  });

  // ---- export ----
  $('btn-csv').addEventListener('click', () => {
    if (!result) return toast('Build a plan first.');
    const rows = [['vehicle', 'driver', 'transport_code', 'run', 'seq', 'order_ref', 'customer',
      'eircode', 'area', 'located_by', 'weight_t', 'ordered_on', 'due_by', 'arrive', 'leg_km', 'day_verdict']];
    for (const l of result.loads) {
      if (!l.plan) continue;
      let seq = 0;
      l.trips.forEach((trip, ti) => trip.forEach(d => {
        seq++;
        const leg = l.plan.legs.find(g => g.to && g.to.delivery && g.to.delivery.id === d.id);
        rows.push([l.id, l.driver, l.transportCode, ti + 1, seq, d.ref, d.customer, d.eircode,
          d.area, d.precision, d.weightT == null ? '' : d.weightT, d.orderedOn, d.dueBy,
          leg && leg.arriveMin != null ? PLAN.minToHHMM(leg.arriveMin) : '',
          leg && leg.route ? leg.route.km : '', l.plan.verdict]);
      }));
    }
    for (const u of result.unassigned) {
      rows.push(['', '', '', '', '', u.delivery.ref, u.delivery.customer, u.delivery.eircode,
        u.delivery.area, u.delivery.precision, u.delivery.weightT == null ? '' : u.delivery.weightT,
        u.delivery.orderedOn, u.delivery.dueBy, '', '', 'NOT LOADED: ' + u.reason.code]);
    }
    const csv = rows.map(r => r.map(c => {
      const s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
    const fallback = () => {
      try {
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
        const a = document.createElement('a');
        a.href = url; a.download = `plan-${state.settings.today}.csv`;
        a.click(); URL.revokeObjectURL(url);
        toast('Plan CSV downloaded.');
      } catch (err) { console.log(csv); toast('CSV written to the console.'); }
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(csv).then(() => toast('Plan CSV copied to the clipboard.')).catch(fallback);
      } else fallback();
    } catch (err) { fallback(); }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) {
      const box = $('depot-results'); if (box) box.innerHTML = '';
    }
  });

  // -------------------------------------------------------- first launch ---
  if (!state.deliveries.length && !state.pasteText) {
    state.pasteText = ORD.SAMPLE;
    runImport(ORD.SAMPLE);
    buildPlan();
  } else {
    renderAll();
  }
})();
