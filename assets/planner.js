/**
 * Planning engine: route search, road-suitability verdicts, EU drivers' hours
 * and drop-sequence optimisation.
 *
 * Nothing in here talks to the DOM, so it runs identically in the browser and
 * under node for the test suite.
 */
(function (root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? { net: require('./network.js'), veh: require('./vehicles.js') }
    : { net: root.RoadNetwork, veh: root.Vehicles };
  const api = factory(deps.net, deps.veh);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof self !== 'undefined' ? self : this, function (NET, VEH) {
  'use strict';

  const MIN = 1, HOUR = 60;

  // ------------------------------------------------------ default costs ---
  const DEFAULT_RATES = {
    dieselPerLitre: 1.75,
    driverPerHour: 22.00,      // gross cost to the operator, not take-home
    runningPerKm: 0.18,        // tyres, maintenance, AdBlue, depreciation
  };

  // -------------------------------------------- EU 561/2006 drivers' hours --
  const HOS = {
    maxContinuousDriveMin: 4 * HOUR + 30 * MIN,
    breakMin: 45 * MIN,
    splitBreakFirstMin: 15 * MIN,
    splitBreakSecondMin: 30 * MIN,
    dailyDriveMin: 9 * HOUR,
    dailyDriveExtendedMin: 10 * HOUR,   // twice per fixed week
    normalDutyWindowMin: 13 * HOUR,     // implied by an 11h daily rest
    reducedDutyWindowMin: 15 * HOUR,    // implied by a 9h reduced daily rest, 3x per week
    weeklyDriveMin: 56 * HOUR,
    fortnightlyDriveMin: 90 * HOUR,
  };

  // ------------------------------------------------------ routing costs ---
  /**
   * Four ways of valuing the same road network. Running all of them and
   * comparing is what turns "here is a route" into "here is the route I would
   * actually send you on, and here is what you give up by taking another".
   */
  const OBJECTIVES = {
    balanced: {
      label: 'Recommended', blurb: 'Best all-round cost of time, fuel, tolls and risk.',
      cautionPenaltyMin: 12, tollWeightMin: 2.2, classBiasMin: 1.5,
    },
    fastest: {
      label: 'Fastest', blurb: 'Shortest driving time, tolls and tight roads accepted.',
      cautionPenaltyMin: 3, tollWeightMin: 0, classBiasMin: 0,
    },
    tollFree: {
      label: 'Toll-light', blurb: 'Avoids toll plazas where the detour is affordable.',
      cautionPenaltyMin: 12, tollWeightMin: 26, classBiasMin: 1.5,
    },
    trunk: {
      label: 'Trunk-road', blurb: 'Sticks to motorway and national roads - the low-risk option for a big combination.',
      cautionPenaltyMin: 45, tollWeightMin: 1.0, classBiasMin: 9,
    },
  };

  /** Extra minutes of "cost" for using a road class below national primary. */
  const CLASS_BIAS = {
    motorway: 0, dual: 0.2, primary: 0.6, secondary: 1.4, regional: 2.6, local: 4.5, urban: 4.0,
  };

  // --------------------------------------------------------------- route ---
  /**
   * Least-cost path for one vehicle between two network nodes.
   * Edges the vehicle physically or legally cannot use are removed from the
   * graph rather than penalised, so a returned route is always drivable.
   */
  function searchRoute(fromId, toId, vehicle, objectiveKey, ctx) {
    const obj = OBJECTIVES[objectiveKey] || OBJECTIVES.balanced;
    ctx = ctx || {};
    if (!NET.NODES.has(fromId) || !NET.NODES.has(toId)) return null;
    // A drop in the same town as the last one has no network legs, but it must
    // still come back with the full route shape - callers index into it.
    if (fromId === toId) return summarise([], [fromId], vehicle, ctx, 0);

    const dist = new Map(), prev = new Map(), done = new Set();
    dist.set(fromId, 0);
    // The graph is small enough (a few hundred nodes) that a linear scan for
    // the next node beats the bookkeeping of a real heap.
    while (true) {
      let cur = null, best = Infinity;
      for (const [id, d] of dist) if (!done.has(id) && d < best) { best = d; cur = id; }
      if (cur == null) break;
      if (cur === toId) break;
      done.add(cur);
      for (const { edge, to } of NET.ADJ.get(cur)) {
        if (done.has(to)) continue;
        const verdict = NET.assessEdge(edge, vehicle, ctx);
        if (verdict.blocked) continue;
        const kph = NET.edgeSpeedKph(edge, vehicle);
        const driveMin = edge.km / kph * 60;
        const toll = NET.tollFor(edge, vehicle);
        const cautions = verdict.reasons.filter(r => r.severity === 'caution').length;
        const cost = driveMin
          + cautions * obj.cautionPenaltyMin
          + toll * obj.tollWeightMin
          + edge.km * CLASS_BIAS[edge.cls] * (obj.classBiasMin / 9 || 0);
        const nd = best + cost;
        if (nd < (dist.has(to) ? dist.get(to) : Infinity)) { dist.set(to, nd); prev.set(to, { from: cur, edge }); }
      }
    }
    if (!prev.has(toId) && fromId !== toId) return null;

    const legs = [], nodes = [toId];
    let cur = toId;
    while (cur !== fromId) {
      const step = prev.get(cur);
      if (!step) return null;
      legs.unshift({ edge: step.edge, from: step.from, to: cur });
      nodes.unshift(step.from);
      cur = step.from;
    }
    return summarise(legs, nodes, vehicle, ctx, dist.get(toId));
  }

  function summarise(legs, nodes, vehicle, ctx, cost) {
    let km = 0, driveMin = 0, tollEur = 0;
    const steps = [], warnings = [], tollsHit = [];
    for (const leg of legs) {
      const e = leg.edge;
      const verdict = NET.assessEdge(e, vehicle, ctx);
      const kph = NET.edgeSpeedKph(e, vehicle);
      const min = e.km / kph * 60;
      const toll = NET.tollFor(e, vehicle);
      km += e.km; driveMin += min; tollEur += toll;
      if (toll > 0) tollsHit.push({ plaza: NET.TOLLS.plazas[e.toll].name, eur: toll });
      for (const r of verdict.reasons) {
        warnings.push(Object.assign({ ref: e.ref, from: NET.node(leg.from).name, to: NET.node(leg.to).name }, r));
      }
      steps.push({
        ref: e.ref, cls: e.cls, clsLabel: e.clsLabel,
        from: NET.node(leg.from).name, to: NET.node(leg.to).name,
        fromId: leg.from, toId: leg.to,
        km: Math.round(e.km * 10) / 10, min: Math.round(min), kph,
        tollEur: toll, verdict: verdict.blocked ? 'block' : (verdict.reasons.some(r => r.severity === 'caution') ? 'caution' : 'ok'),
      });
    }
    return {
      nodes, steps, warnings, tollsHit,
      km: Math.round(km * 10) / 10,
      driveMin: Math.round(driveMin),
      tollEur: Math.round(tollEur * 100) / 100,
      cost: cost || driveMin,
      polyline: nodes.map(id => { const n = NET.node(id); return [n.lat, n.lon]; }),
    };
  }

  /** Collapse consecutive steps on the same road reference into one instruction. */
  function itinerary(route) {
    const out = [];
    for (const s of route.steps) {
      const last = out[out.length - 1];
      if (last && last.ref === s.ref && last.verdict === s.verdict) {
        last.to = s.to; last.toId = s.toId;
        last.km = Math.round((last.km + s.km) * 10) / 10;
        last.min += s.min; last.tollEur = Math.round((last.tollEur + s.tollEur) * 100) / 100;
      } else {
        out.push(Object.assign({}, s));
      }
    }
    return out;
  }

  /**
   * Runs every objective, drops duplicates, and nominates one to actually use.
   * The recommendation is the balanced route unless another option is clearly
   * better value - a much cheaper run for a few extra minutes, or a
   * meaningfully safer road for a big combination.
   */
  function routeOptions(fromId, toId, vehicle, ctx, rates) {
    rates = Object.assign({}, DEFAULT_RATES, rates || {});
    const seen = new Map();
    for (const key of Object.keys(OBJECTIVES)) {
      const r = searchRoute(fromId, toId, vehicle, key, ctx);
      if (!r) continue;
      const sig = r.steps.map(s => s.fromId + '>' + s.toId).join('|');
      if (seen.has(sig)) { seen.get(sig).objectives.push(key); continue; }
      r.objectives = [key];
      r.key = key;
      r.itinerary = itinerary(r);
      r.money = money(r, vehicle, rates);
      r.cautionCount = r.warnings.filter(w => w.severity === 'caution').length;
      seen.set(sig, r);
    }
    const options = [...seen.values()];
    if (!options.length) return { options: [], recommended: null, reason: 'No legal route for this vehicle.' };

    const scored = options.map(o => ({
      o, value: o.money.totalEur + o.cautionCount * 8 + (o.driveMin / 60) * 2,
    })).sort((x, y) => x.value - y.value);

    const recommended = scored[0].o;
    const fastest = options.slice().sort((a, b) => a.driveMin - b.driveMin)[0];
    let reason;
    if (recommended === fastest) {
      reason = 'Fastest and cheapest option - nothing to trade off.';
    } else {
      const dMin = recommended.driveMin - fastest.driveMin;
      const dEur = Math.round((fastest.money.totalEur - recommended.money.totalEur) * 100) / 100;
      const dCaution = fastest.cautionCount - recommended.cautionCount;
      const bits = [];
      if (dEur > 0) bits.push(`saves €${dEur.toFixed(2)}`);
      if (dCaution > 0) bits.push(`avoids ${dCaution} tight section${dCaution > 1 ? 's' : ''}`);
      reason = `${bits.join(' and ') || 'Preferred'} for ${dMin > 0 ? dMin + ' min more' : 'no extra time'} driving.`;
    }
    for (const o of options) o.recommended = (o === recommended);
    options.sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0) || a.driveMin - b.driveMin);
    return { options, recommended, reason };
  }

  function money(route, vehicle, rates) {
    rates = Object.assign({}, DEFAULT_RATES, rates || {});
    const fuelEur = route.km / 100 * vehicle.lPer100 * rates.dieselPerLitre;
    const runningEur = route.km * rates.runningPerKm;
    const driverEur = route.driveMin / 60 * rates.driverPerHour;
    const totalEur = fuelEur + runningEur + driverEur + route.tollEur;
    const r2 = n => Math.round(n * 100) / 100;
    return { fuelEur: r2(fuelEur), runningEur: r2(runningEur), driverEur: r2(driverEur), tollEur: r2(route.tollEur), totalEur: r2(totalEur) };
  }

  // ---------------------------------------------------- the final mile ---
  /**
   * The network stops at the trunk roads, so the last few kilometres to a site
   * are assessed rather than routed. This is the honest part of the tool: it
   * says how much unmodelled local road stands between the vehicle and the
   * gate, and what that usually means for a combination of this size.
   */
  function assessAccess(point, vehicle) {
    const near = NET.nearestNodes(point.lat, point.lon, 3);
    const anchor = near[0];
    const approachKm = Math.round(anchor.km * 1.3 * 10) / 10;
    const bestClass = Math.min(...NET.ADJ.get(anchor.node.id)
      .map(a => ['motorway', 'dual', 'primary', 'secondary', 'regional', 'local', 'urban'].indexOf(a.edge.cls)));
    const anchorClass = ['motorway', 'dual', 'primary', 'secondary', 'regional', 'local', 'urban'][bestClass];

    const big = vehicle.lengthM >= 13;
    let level, advice;
    if (approachKm <= 1.5) {
      level = 'low';
      advice = `Site sits on or beside the ${anchorClass === 'motorway' ? 'motorway junction' : 'main road'} at ${anchor.node.name}. Confirm the gate width and a turning area.`;
    } else if (approachKm <= 5) {
      level = big ? 'medium' : 'low';
      advice = `About ${approachKm} km of local road off ${anchor.node.name}. ${big ? 'Check the last junction on aerial imagery before committing a 16.5m combination.' : 'Normally straightforward for this vehicle.'}`;
    } else if (approachKm <= 12) {
      level = big ? 'high' : 'medium';
      advice = `Roughly ${approachKm} km off the network at ${anchor.node.name}. ${big ? 'Treat as an artic risk: get a site survey or send a rigid.' : 'Allow extra time on unclassified road.'}`;
    } else {
      level = big ? 'high' : 'medium';
      advice = `${approachKm} km beyond the strategic network near ${anchor.node.name}. The approach is not modelled here - survey it or use a smaller unit.`;
    }

    const zones = [];
    for (const [key, z] of Object.entries(NET.ZONES)) {
      if (NET.inZone(z, point.lat, point.lon)) zones.push(Object.assign({ key }, z));
    }
    return { anchor: anchor.node, approachKm, anchorClass, level, advice, zones, alternates: near.slice(1).map(n => n.node) };
  }

  /**
   * Statutory access restriction on the destination itself, evaluated against
   * the planned arrival time. This is the check that catches a five-axle unit
   * booked into Dublin 2 for 09:00.
   */
  function zoneCheck(point, vehicle, arrivalMinOfDay) {
    const hits = [];
    for (const [key, z] of Object.entries(NET.ZONES)) {
      if (!NET.inZone(z, point.lat, point.lon)) continue;
      if (z.minAxles && vehicle.axles >= z.minAxles && z.banFrom) {
        const from = hhmmToMin(z.banFrom), to = hhmmToMin(z.banTo);
        const inWindow = arrivalMinOfDay != null && modDay(arrivalMinOfDay) >= from && modDay(arrivalMinOfDay) < to;
        hits.push({
          key, name: z.name, severity: inWindow ? 'block' : 'note',
          text: inWindow
            ? `${vehicle.code} has ${vehicle.axles} axles and the arrival falls inside the ${z.banFrom}-${z.banTo} ban. ${z.permit}`
            : `${vehicle.code} has ${vehicle.axles} axles: legal only outside ${z.banFrom}-${z.banTo}. Keep the drop before ${z.banFrom} or after ${z.banTo}.`,
          rule: z.rule,
        });
      } else if (z.severity === 'advise') {
        hits.push({ key, name: z.name, severity: 'note', text: z.rule, rule: z.rule });
      }
    }
    return hits;
  }

  // ------------------------------------------------------ time handling ---
  const hhmmToMin = s => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    return m ? (+m[1]) * 60 + (+m[2]) : 0;
  };
  const modDay = m => ((m % 1440) + 1440) % 1440;
  const minToHHMM = m => {
    const d = Math.floor(m / 1440), t = modDay(m);
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0') + (d ? ` +${d}d` : '');
  };
  const minToHrs = m => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;

  // ------------------------------------------------------ schedule plan ---
  /**
   * Turns one driver's day into a minute-by-minute timeline.
   *
   * Break handling follows EU 561/2006: only genuine breaks reset the 4h30
   * driving clock. Loading and unloading is *other work*, so a 45-minute tip
   * does not buy the driver a break - a mistake that shows up in tacho
   * infringement reports constantly, and one this planner refuses to make.
   */
  function planSchedule(schedule, opts) {
    opts = opts || {};
    const rates = Object.assign({}, DEFAULT_RATES, opts.rates || {});
    const vehicle = VEH.resolve(schedule.transportCode, schedule.vehicleOverrides);
    if (!vehicle) return { error: `Unknown transport code "${schedule.transportCode}".` };

    const ctx = { adr: !!schedule.adr };
    const stops = (schedule.stops || []).filter(s => s && Number.isFinite(s.lat) && Number.isFinite(s.lon));
    const result = {
      driver: schedule.driver || 'Unassigned',
      date: schedule.date || '',
      vehicle, ctx,
      timeline: [], legs: [], warnings: [], blockers: [],
      totals: { km: 0, driveMin: 0, workMin: 0, breakMin: 0, tollEur: 0 },
      compliance: { violations: [], notes: [] },
    };
    if (stops.length < 2) {
      result.warnings.push({ severity: 'note', text: 'Add a start point and at least one drop to plan the day.' });
      return result;
    }

    let clock = hhmmToMin(schedule.startTime || '07:00');
    const dayStart = clock;
    let sinceBreak = 0, dailyDrive = 0;

    const push = (type, label, min, extra) => {
      result.timeline.push(Object.assign({ type, label, startMin: clock, endMin: clock + min, min }, extra || {}));
      clock += min;
    };

    push('depart', `Depart ${stops[0].name}`, 0, { placeName: stops[0].name });
    for (const z of zoneCheck(stops[0], vehicle, clock)) {
      (z.severity === 'block' ? result.blockers : result.warnings).push({
        severity: z.severity, text: `Departing ${stops[0].name}: ${z.text}`, ref: z.name,
      });
    }

    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i], to = stops[i + 1];
      const a = NET.nearestNodes(from.lat, from.lon, 1)[0].node.id;
      const b = NET.nearestNodes(to.lat, to.lon, 1)[0].node.id;
      const picked = routeOptions(a, b, vehicle, ctx, rates);

      const access = assessAccess(to, vehicle);
      const leg = {
        index: i, from, to, access,
        options: picked.options, route: picked.recommended, reason: picked.reason,
      };

      if (!picked.recommended) {
        const alt = largestCodeThatCanRun(a, b, ctx, vehicle);
        leg.suggestion = alt;
        result.blockers.push({
          severity: 'block',
          text: `No legal route for ${vehicle.code} from ${from.name} to ${to.name}: every path needs a road this vehicle cannot use. ` +
            (alt
              ? `The largest unit that gets there is ${alt.code} (${alt.name}, ${alt.payloadT}t payload).`
              : 'Nothing in the fleet can reach it by road - check the coordinates.'),
        });
        result.legs.push(leg);
        continue;
      }

      const r = picked.recommended;
      // Approach kilometres off the strategic network, at local-road speed.
      const accessKm = access.approachKm + assessAccess(from, vehicle).approachKm;
      const accessMin = Math.round(accessKm / 34 * 60);
      leg.accessKm = Math.round(accessKm * 10) / 10;
      leg.accessMin = accessMin;

      let remaining = r.driveMin + accessMin;
      leg.departMin = clock;
      while (remaining > 0) {
        const untilBreak = HOS.maxContinuousDriveMin - sinceBreak;
        const chunk = Math.min(remaining, untilBreak);
        if (chunk > 0) {
          push('drive', `${from.name} → ${to.name}`, chunk, { legIndex: i, km: null });
          sinceBreak += chunk; dailyDrive += chunk; remaining -= chunk;
          result.totals.driveMin += chunk;
        }
        if (remaining > 0) {
          push('break', 'Statutory break (EU 561: 45 min after 4h30 driving)', HOS.breakMin, { statutory: true });
          result.totals.breakMin += HOS.breakMin;
          sinceBreak = 0;
        }
      }
      leg.arriveMin = clock;

      const serviceMin = Number.isFinite(to.serviceMin) ? to.serviceMin : (schedule.defaultServiceMin || 45);
      const zoneHits = zoneCheck(to, vehicle, clock);
      leg.zoneHits = zoneHits;
      for (const z of zoneHits) {
        (z.severity === 'block' ? result.blockers : result.warnings).push({
          severity: z.severity, text: `${to.name}: ${z.text}`, ref: z.name,
        });
      }
      if (access.level === 'high') {
        result.warnings.push({ severity: 'caution', text: `${to.name}: ${access.advice}`, ref: 'Final mile' });
      }
      for (const w of r.warnings) {
        if (w.severity === 'block' || w.severity === 'caution') {
          result.warnings.push(Object.assign({}, w, { text: `${w.ref}: ${w.text}` }));
        }
      }

      push('service', `${to.name} — offload${vehicle.craned ? ' (own crane)' : ''}`, serviceMin, { legIndex: i, placeName: to.name });
      result.totals.workMin += serviceMin;
      result.totals.km += r.km + accessKm;
      result.totals.tollEur += r.tollEur;
      leg.route.money = money(r, vehicle, rates);
      result.legs.push(leg);
    }

    // ------------------------------------------------------- compliance ---
    const dutyMin = clock - dayStart;
    result.totals.km = Math.round(result.totals.km * 10) / 10;
    result.totals.tollEur = Math.round(result.totals.tollEur * 100) / 100;
    result.totals.dutyMin = dutyMin;
    result.endMin = clock;

    const c = result.compliance;
    if (!vehicle.isHGV) {
      c.notes.push('Vehicle is 3.5t or under: EU drivers\' hours and tachograph rules do not apply. Working-time and road-safety limits still do.');
    } else {
      if (dailyDrive > HOS.dailyDriveExtendedMin) {
        c.violations.push(`Daily driving is ${minToHrs(dailyDrive)} — over the 10h absolute maximum. The day cannot be run as planned.`);
      } else if (dailyDrive > HOS.dailyDriveMin) {
        c.notes.push(`Daily driving is ${minToHrs(dailyDrive)}. Legal only as one of the two permitted 10h days in the fixed week — check the driver's card.`);
      }
      if (dutyMin > HOS.reducedDutyWindowMin) {
        c.violations.push(`Duty window is ${minToHrs(dutyMin)}. Even with a reduced 9h daily rest the maximum is 15h.`);
      } else if (dutyMin > HOS.normalDutyWindowMin) {
        c.notes.push(`Duty window is ${minToHrs(dutyMin)}, so this day needs a reduced (9h) daily rest — allowed three times between weekly rests.`);
      }
      if (result.totals.workMin >= 6 * HOUR && result.totals.breakMin === 0) {
        c.notes.push('Over 6 hours of work with no break scheduled — a 30 minute working-time break is due even though no 4h30 driving limit was reached.');
      }
      c.notes.push('Offload time is recorded as other work, not as a break: it does not reset the 4h30 driving clock.');
    }

    result.money = {
      fuelEur: round2(result.totals.km / 100 * vehicle.lPer100 * rates.dieselPerLitre),
      runningEur: round2(result.totals.km * rates.runningPerKm),
      driverEur: round2(dutyMin / 60 * rates.driverPerHour),
      tollEur: round2(result.totals.tollEur),
    };
    result.money.totalEur = round2(result.money.fuelEur + result.money.runningEur + result.money.driverEur + result.money.tollEur);
    result.money.perDrop = round2(result.money.totalEur / Math.max(1, stops.length - 1));

    result.verdict = result.blockers.length ? 'blocked'
      : (c.violations.length ? 'illegal'
        : (result.warnings.some(w => w.severity === 'caution') ? 'caution' : 'clear'));
    return result;
  }

  const round2 = n => Math.round(n * 100) / 100;

  /**
   * When a leg defeats the booked vehicle, the useful answer is not "no" but
   * "no, send this instead". Walks the fleet from biggest payload down and
   * returns the first profile that can actually make the journey.
   */
  function largestCodeThatCanRun(fromId, toId, ctx, exclude) {
    const candidates = VEH.PROFILES
      .map(p => VEH.resolve(p.code))
      .filter(v => !exclude || v.code !== exclude.code)
      .sort((x, y) => y.payloadT - x.payloadT);
    for (const v of candidates) {
      if (searchRoute(fromId, toId, v, 'balanced', ctx)) return v;
    }
    return null;
  }

  // ------------------------------------------------------- optimisation ---
  /**
   * Reorders the intermediate drops to cut driving time. Nearest-neighbour for
   * a starting tour, then 2-opt until it stops improving. The first stop is
   * always the depot; the last is held fixed when `fixedEnd` is set, which is
   * what you want when the vehicle has to return to the yard.
   */
  function optimiseOrder(stops, vehicle, opts) {
    opts = opts || {};
    if (stops.length < 4) return { stops: stops.slice(), improvedMin: 0 };
    const fixedEnd = !!opts.fixedEnd;
    const head = stops[0];
    const tail = fixedEnd ? stops[stops.length - 1] : null;
    const mid = stops.slice(1, fixedEnd ? stops.length - 1 : stops.length);
    if (mid.length < 2) return { stops: stops.slice(), improvedMin: 0 };

    const cache = new Map();
    const cost = (p, q) => {
      const key = `${p.lat},${p.lon}|${q.lat},${q.lon}`;
      if (cache.has(key)) return cache.get(key);
      const a = NET.nearestNodes(p.lat, p.lon, 1)[0].node.id;
      const b = NET.nearestNodes(q.lat, q.lon, 1)[0].node.id;
      let min;
      if (a === b) {
        min = NET.haversineKm(p.lat, p.lon, q.lat, q.lon) * 1.3 / 34 * 60;
      } else {
        const r = searchRoute(a, b, vehicle, 'balanced', opts.ctx);
        min = r ? r.driveMin : NET.haversineKm(p.lat, p.lon, q.lat, q.lon) * 1.4 / 40 * 60;
      }
      cache.set(key, min);
      return min;
    };
    const tourMin = seq => {
      const full = [head].concat(seq, tail ? [tail] : []);
      let t = 0;
      for (let i = 0; i < full.length - 1; i++) t += cost(full[i], full[i + 1]);
      return t;
    };

    const before = tourMin(mid);

    // Nearest neighbour from the depot.
    const pool = mid.slice();
    const nn = [];
    let cur = head;
    while (pool.length) {
      let bi = 0, bv = Infinity;
      for (let i = 0; i < pool.length; i++) { const v = cost(cur, pool[i]); if (v < bv) { bv = v; bi = i; } }
      cur = pool[bi]; nn.push(cur); pool.splice(bi, 1);
    }

    // 2-opt.
    let seq = tourMin(nn) < before ? nn : mid.slice();
    let best = tourMin(seq), improved = true, guard = 0;
    while (improved && guard++ < 60) {
      improved = false;
      for (let i = 0; i < seq.length - 1; i++) {
        for (let j = i + 1; j < seq.length; j++) {
          const cand = seq.slice(0, i).concat(seq.slice(i, j + 1).reverse(), seq.slice(j + 1));
          const v = tourMin(cand);
          if (v < best - 0.5) { seq = cand; best = v; improved = true; }
        }
      }
    }
    return {
      stops: [head].concat(seq, tail ? [tail] : []),
      improvedMin: Math.round(before - best),
      beforeMin: Math.round(before),
      afterMin: Math.round(best),
    };
  }


  // ================================================== day-plan building ====
  /**
   * Assigns an order book across the available vehicles, then routes each load.
   *
   * The constraints, in the order they bite:
   *   1. Can this vehicle legally reach the drop at all? (road suitability)
   *   2. Does the weight fit what the vehicle may be loaded to?
   *   3. Does the day still fit inside the driver's duty window and EU 561?
   *
   * Loads are grown one drop at a time: seed with the most urgent unassigned
   * order the vehicle can serve, then repeatedly add whichever remaining order
   * is cheapest to slot in, discounted by how overdue it is. That keeps loads
   * geographically tight without letting an old order sit forever because it
   * happens to be awkward.
   */

  /** Days since the epoch, for comparing order and due dates cheaply. */
  const dayNum = iso => {
    const t = Date.parse(String(iso || '') + 'T00:00:00Z');
    return Number.isFinite(t) ? Math.round(t / 86400000) : null;
  };

  /**
   * How hard to pull an order into today's loads, in "minutes of detour we
   * would accept to take it". Overdue work outranks convenient work.
   */
  function urgencyMin(d, todayNum) {
    const due = dayNum(d.dueBy);
    if (due != null) {
      const slack = due - todayNum;               // negative once overdue
      if (slack < 0) return 120 + Math.min(120, -slack * 30);
      if (slack === 0) return 90;
      if (slack === 1) return 45;
      if (slack <= 3) return 15;
      return 0;
    }
    const ordered = dayNum(d.orderedOn);
    if (ordered == null) return 0;
    return Math.min(90, Math.max(0, (todayNum - ordered - 2) * 12));
  }

  /** Most urgent first: overdue, then earliest due, then oldest order. */
  function priorityRank(d, todayNum) {
    return [-urgencyMin(d, todayNum), dayNum(d.dueBy) == null ? 1e6 : dayNum(d.dueBy),
      dayNum(d.orderedOn) == null ? 1e6 : dayNum(d.orderedOn)];
  }
  const cmpRank = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
    return 0;
  };

  function makeCosts(ctx) {
    const nodeOf = new Map();
    const nodeFor = p => {
      const k = p.lat + ',' + p.lon;
      if (!nodeOf.has(k)) nodeOf.set(k, NET.nearestNodes(p.lat, p.lon, 1)[0].node.id);
      return nodeOf.get(k);
    };
    const legCache = new Map();
    /** Routed driving minutes between two points for one vehicle, or null. */
    const legMin = (v, p, q) => {
      const a = nodeFor(p), b = nodeFor(q);
      const key = v.code + '|' + a + '|' + b;
      if (legCache.has(key)) return legCache.get(key);
      let val;
      if (a === b) {
        val = NET.haversineKm(p.lat, p.lon, q.lat, q.lon) * 1.3 / 34 * 60;
      } else {
        const r = searchRoute(a, b, v, 'balanced', ctx);
        val = r ? r.driveMin : null;
      }
      legCache.set(key, val);
      return val;
    };
    return { nodeFor, legMin };
  }

  /**
   * @param deliveries  drops from the order book: {lat, lon, weightT, dueBy, orderedOn, serviceMin, ...}
   * @param fleet       [{id, driver, transportCode, depot, startTime, maxDutyMin, capacityOverrideT}]
   * @param opts        {today, rates, defaultServiceMin, maxDropsPerLoad, returnToDepot, loadCaps, adr}
   */
  function buildDayPlan(deliveries, fleet, opts) {
    opts = opts || {};
    const ctx = { adr: !!opts.adr };
    const rates = Object.assign({}, DEFAULT_RATES, opts.rates || {});
    const todayNum = dayNum(opts.today) != null ? dayNum(opts.today)
      : Math.round(Date.now() / 86400000);
    const defaultServiceMin = opts.defaultServiceMin != null ? opts.defaultServiceMin : 40;
    const maxDrops = opts.maxDropsPerLoad || 12;
    const { legMin } = makeCosts(ctx);

    const vehicles = (fleet || []).map(f => {
      const v = VEH.resolve(f.transportCode, opts.loadCaps ? { loadCaps: opts.loadCaps } : null);
      if (!v) return null;
      const cap = f.capacityOverrideT != null ? +f.capacityOverrideT : v.capacityT;
      return Object.assign({}, f, {
        vehicle: v,
        capacityT: cap,
        maxDutyMin: f.maxDutyMin || HOS.normalDutyWindowMin,
        depot: f.depot,
      });
    }).filter(Boolean);

    const pool = (deliveries || []).filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lon));
    const assigned = new Set();
    const loads = [];
    const heaviestCap = vehicles.reduce((m, u) => Math.max(m, u.capacityT), 0);
    const allowReloads = opts.allowReloads !== false;
    const reloadMin = opts.reloadMin != null ? opts.reloadMin : 45;
    const maxTrips = allowReloads ? (opts.maxTripsPerVehicle || 3) : 1;
    const stopReasons = [];

    // Big trucks pick first, so the heavy orders are not stranded by a van
    // having already taken the easy work.
    const order = vehicles.slice().sort((a, b) => b.capacityT - a.capacityT);

    for (const unit of order) {
      const v = unit.vehicle;
      const depot = unit.depot;

      /**
       * A vehicle's day is one schedule: depot, drops, back to the depot to
       * reload, more drops. Modelling a reload as a service stop at the yard
       * means EU 561 breaks, the duty window and the running clock all come
       * out of the same calculation instead of being stitched together.
       */
      const stopsFor = trips => {
        const stops = [Object.assign({ serviceMin: 0 }, depot)];
        trips.forEach((trip, ti) => {
          if (ti > 0) stops.push(Object.assign({}, depot, {
            name: `${depot.name} — reload`, serviceMin: reloadMin, isReload: true,
          }));
          for (const d of trip) {
            stops.push({
              name: d.customer || d.ref || d.eircode, lat: d.lat, lon: d.lon,
              serviceMin: d.serviceMin != null ? d.serviceMin : defaultServiceMin,
              delivery: d,
            });
          }
        });
        if (opts.returnToDepot) {
          stops.push(Object.assign({}, depot, { name: depot.name + ' (return)', serviceMin: 0 }));
        }
        return stops;
      };

      const tryPlan = trips => {
        const p = planSchedule({
          driver: unit.driver, transportCode: v.code, vehicleOverrides: unit.vehicleOverrides,
          startTime: unit.startTime || '07:00', adr: opts.adr, defaultServiceMin,
          stops: stopsFor(trips),
        }, { rates });
        if (p.error || p.blockers.length) return null;
        if (p.compliance.violations.length) return null;
        if (p.totals.dutyMin > unit.maxDutyMin) return null;
        return p;
      };

      let trips = [];
      let plan = null;
      let stopped = 'no-candidates';

      while (true) {
        const dropCount = trips.reduce((a, t) => a + t.length, 0);
        if (dropCount >= maxDrops) { stopped = 'max-drops'; break; }

        // Not taken by another vehicle, and not already on one of this
        // vehicle's own earlier trips.
        const mine = new Set(trips.flat().map(d => d.id));
        const free = pool.filter(d => !assigned.has(d.id) && !mine.has(d.id));
        if (!free.length) { stopped = 'nothing-left'; break; }

        const current = trips.length ? trips[trips.length - 1] : null;
        const tripWeight = current ? current.reduce((a, d) => a + (d.weightT || 0), 0) : 0;
        const roomInTrip = unit.capacityT - tripWeight;

        let fits = current ? free.filter(d => (d.weightT || 0) <= roomInTrip + 1e-9) : [];
        let openingNewTrip = false;
        if (!current || !fits.length) {
          if (current && trips.length >= maxTrips) { stopped = 'max-trips'; break; }
          if (current && !current.length) { stopped = 'empty-trip'; break; }
          fits = free.filter(d => (d.weightT || 0) <= unit.capacityT + 1e-9);
          openingNewTrip = !!current;
          if (!fits.length) { stopped = current ? 'weight' : 'weight'; break; }
        }

        // Shortlist by proximity to where the vehicle currently is, plus the
        // most urgent orders wherever they are, so old work is not orphaned.
        const anchor = (!openingNewTrip && current && current.length)
          ? current[current.length - 1] : depot;
        const near = fits
          .map(d => ({ d, straight: NET.haversineKm(anchor.lat, anchor.lon, d.lat, d.lon) }))
          .sort((a, b) => a.straight - b.straight).slice(0, 14).map(x => x.d);
        const urgent = fits.slice()
          .sort((a, b) => cmpRank(priorityRank(a, todayNum), priorityRank(b, todayNum))).slice(0, 4);

        let best = null;
        for (const d of [...new Set(near.concat(urgent))]) {
          const add = legMin(v, anchor, d);
          if (add == null) continue;                       // vehicle cannot reach it
          const score = add - urgencyMin(d, todayNum);
          if (!best || score < best.score) best = { d, score };
        }
        if (!best) { stopped = 'unreachable'; break; }

        const trial = trips.map(t => t.slice());
        if (openingNewTrip || !current) trial.push([best.d]);
        else trial[trial.length - 1].push(best.d);

        // Resequence the trip we just touched.
        const ti = trial.length - 1;
        if (trial[ti].length > 2) {
          trial[ti] = optimiseOrder([depot].concat(trial[ti]), v, { fixedEnd: false, ctx })
            .stops.slice(1);
        }

        const p = tryPlan(trial);
        if (!p) { stopped = openingNewTrip ? 'hours-no-second-trip' : 'hours'; break; }

        trips = trial;
        plan = p;
      }

      trips = trips.filter(t => t.length);
      trips.forEach(t => t.forEach(d => assigned.add(d.id)));
      const carried = trips.flat();
      const weightT = carried.reduce((a, d) => a + (d.weightT || 0), 0);
      const peakTripT = trips.reduce((m, t) =>
        Math.max(m, t.reduce((a, d) => a + (d.weightT || 0), 0)), 0);
      stopReasons.push(stopped);

      loads.push({
        id: unit.id, driver: unit.driver, transportCode: v.code, vehicle: v,
        depot, startTime: unit.startTime || '07:00',
        trips, deliveries: carried,
        weightT: Math.round(weightT * 100) / 100,
        peakTripT: Math.round(peakTripT * 100) / 100,
        capacityT: unit.capacityT,
        utilPct: unit.capacityT ? Math.round(peakTripT / unit.capacityT * 100) : 0,
        plan: carried.length ? plan : null,
        stoppedBecause: stopped,
        replan: tryPlan,
      });
    }

    // ------------------------------------------------- second-chance pass ---
    // The first pass is greedy per vehicle, so an order can be left over
    // simply because of the order the trucks picked. Before giving up on
    // anything, try to slot each leftover into every load at every position
    // and keep the cheapest placement that stays legal.
    let budget = opts.replanBudget != null ? opts.replanBudget : 900;
    let placedMore = true;
    while (placedMore && budget > 0) {
      placedMore = false;
      const leftovers = pool.filter(d => !assigned.has(d.id))
        .sort((a, b) => cmpRank(priorityRank(a, todayNum), priorityRank(b, todayNum)));

      for (const d of leftovers) {
        let best = null;
        for (const load of loads) {
          if (!load.trips.length) continue;
          for (let ti = 0; ti < load.trips.length && budget > 0; ti++) {
            const tripT = load.trips[ti].reduce((a, x) => a + (x.weightT || 0), 0);
            if ((d.weightT || 0) > load.capacityT - tripT + 1e-9) continue;
            for (let pos = 0; pos <= load.trips[ti].length && budget > 0; pos++) {
              const trial = load.trips.map(t => t.slice());
              trial[ti].splice(pos, 0, d);
              budget--;
              const p = load.replan(trial);
              if (!p) continue;
              const delta = p.totals.driveMin - (load.plan ? load.plan.totals.driveMin : 0);
              if (!best || delta < best.delta) best = { load, trial, plan: p, delta };
            }
          }
        }
        if (best) {
          best.load.trips = best.trial;
          best.load.plan = best.plan;
          assigned.add(d.id);
          placedMore = true;
        }
      }
    }
    // ----------------------------------------------------- relocate pass ---
    // Greedy assignment strands work on the wrong truck: the big unit takes
    // the convenient drops first, and a small one is left crossing the country
    // twice. Try moving each drop to another vehicle and keep the move if the
    // fleet's total driving falls and both days stay legal.
    const driveOf = l => (l.plan ? l.plan.totals.driveMin : 0);
    let moved = true, rounds = 0;
    while (moved && rounds++ < 3 && budget > 0) {
      moved = false;
      for (const from of loads) {
        if (!from.trips.length) continue;
        for (const d of from.deliveries.slice()) {
          if (budget <= 0) break;
          const without = from.trips.map(t => t.filter(x => x.id !== d.id)).filter(t => t.length);
          budget--;
          const fromPlan = without.length ? from.replan(without) : null;
          if (without.length && !fromPlan) continue;
          const fromDrive = without.length ? fromPlan.totals.driveMin : 0;

          let best = null;
          for (const to of loads) {
            if (to === from || budget <= 0) continue;
            const targets = to.trips.length ? to.trips : [[]];
            for (let ti = 0; ti < targets.length && budget > 0; ti++) {
              const tripT = targets[ti].reduce((a, x) => a + (x.weightT || 0), 0);
              if ((d.weightT || 0) > to.capacityT - tripT + 1e-9) continue;
              for (let pos = 0; pos <= targets[ti].length && budget > 0; pos++) {
                const trial = targets.map(t => t.slice());
                trial[ti].splice(pos, 0, d);
                budget--;
                const p = to.replan(trial);
                if (!p) continue;
                const delta = (fromDrive + p.totals.driveMin) - (driveOf(from) + driveOf(to));
                if (delta < -2 && (!best || delta < best.delta)) {
                  best = { to, trial, plan: p, delta };
                }
              }
            }
          }
          if (best) {
            from.trips = without;
            from.plan = without.length ? fromPlan : null;
            best.to.trips = best.trial;
            best.to.plan = best.plan;
            moved = true;
          }
        }
      }
    }

    for (const load of loads) {
      load.deliveries = load.trips.flat();
      load.weightT = round2(load.deliveries.reduce((a, x) => a + (x.weightT || 0), 0));
      load.peakTripT = round2(load.trips.reduce((m, t) =>
        Math.max(m, t.reduce((a, x) => a + (x.weightT || 0), 0)), 0));
      load.utilPct = load.capacityT ? Math.round(load.peakTripT / load.capacityT * 100) : 0;
      delete load.replan;
    }

    // --------------------------------------------------------- leftovers ---
    const hoursBound = stopReasons.some(r => /hours|max-drops|max-trips/.test(r));
    const unassigned = [];
    for (const d of pool) {
      if (assigned.has(d.id)) continue;
      unassigned.push({ delivery: d, reason: whyNotLoaded(d, vehicles, heaviestCap, ctx, hoursBound) });
    }

    const totalT = pool.reduce((a, d) => a + (d.weightT || 0), 0);
    const loadedT = loads.reduce((a, l) => a + l.weightT, 0);
    const working = loads.filter(l => l.plan);
    return {
      loads, unassigned,
      summary: {
        deliveries: pool.length,
        loaded: pool.length - unassigned.length,
        unassigned: unassigned.length,
        vehiclesUsed: working.length,
        vehiclesIdle: loads.length - working.length,
        trips: working.reduce((a, l) => a + l.trips.length, 0),
        totalT: Math.round(totalT * 100) / 100,
        loadedT: Math.round(loadedT * 100) / 100,
        km: Math.round(working.reduce((a, l) => a + l.plan.totals.km, 0) * 10) / 10,
        driveMin: working.reduce((a, l) => a + l.plan.totals.driveMin, 0),
        costEur: round2(working.reduce((a, l) => a + (l.plan.money ? l.plan.money.totalEur : 0), 0)),
        costPerTonne: loadedT > 0
          ? round2(working.reduce((a, l) => a + (l.plan.money ? l.plan.money.totalEur : 0), 0) / loadedT)
          : 0,
      },
    };
  }

  /** Why an order did not make it onto a truck - specific, never just "no". */
  function whyNotLoaded(d, vehicles, heaviestCap, ctx, hoursBound) {
    if (d.weightT != null && heaviestCap > 0 && d.weightT > heaviestCap) {
      return { code: 'over-capacity',
        text: `${d.weightT}t is more than the heaviest available unit may carry (${heaviestCap}t). Split the order or plate a bigger vehicle.` };
    }
    const reachable = vehicles.filter(u =>
      searchRoute(NET.nearestNodes(u.depot.lat, u.depot.lon, 1)[0].node.id,
        NET.nearestNodes(d.lat, d.lon, 1)[0].node.id, u.vehicle, 'balanced', ctx));
    if (!reachable.length) {
      const alt = largestCodeThatCanRun(
        NET.nearestNodes(vehicles[0] ? vehicles[0].depot.lat : 53.3, vehicles[0] ? vehicles[0].depot.lon : -6.3, 1)[0].node.id,
        NET.nearestNodes(d.lat, d.lon, 1)[0].node.id, ctx, null);
      return { code: 'unreachable',
        text: alt
          ? `No vehicle on today's fleet can legally reach ${d.area || d.eircode}. A ${alt.code} could.`
          : `No road route for any vehicle to ${d.area || d.eircode}. Check the Eircode.` };
    }
    return hoursBound
      ? { code: 'hours',
          text: 'Every vehicle ran out of driving hours before this order. Add a unit, start earlier, or roll it to tomorrow.' }
      : { code: 'no-room',
          text: 'The fleet ran out of payload before this order. Add a vehicle or roll it to tomorrow.' };
  }

  // ------------------------------------------------- fleet-level advice ---
  /**
   * Given a set of stops, says which transport codes can actually serve them
   * all. This is the "can my artic do this run?" answer, in one table.
   */
  function fleetFit(stops, ctx, codes) {
    const list = (codes || VEH.PROFILES.map(p => p.code));
    return list.map(code => {
      const v = VEH.resolve(code);
      const plan = planSchedule({ transportCode: code, stops, startTime: '07:00', adr: ctx && ctx.adr }, {});
      const highRisk = plan.legs.filter(l => l.access && l.access.level === 'high').length;
      return {
        code, vehicle: v,
        verdict: plan.verdict,
        km: plan.totals.km, driveMin: plan.totals.driveMin,
        payloadT: v.payloadT,
        blockers: plan.blockers.length,
        cautions: plan.warnings.filter(w => w.severity === 'caution').length,
        highRiskDrops: highRisk,
        costEur: plan.money ? plan.money.totalEur : null,
      };
    });
  }

  return {
    DEFAULT_RATES, HOS, OBJECTIVES,
    searchRoute, routeOptions, itinerary, money,
    assessAccess, zoneCheck, planSchedule, optimiseOrder, fleetFit, largestCodeThatCanRun,
    buildDayPlan, urgencyMin, priorityRank, dayNum,
    hhmmToMin, minToHHMM, minToHrs, modDay,
  };
});
