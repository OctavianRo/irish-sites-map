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
    if (fromId === toId) return { nodes: [fromId], legs: [], km: 0, driveMin: 0, tollEur: 0, cost: 0 };

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
    hhmmToMin, minToHHMM, minToHrs, modDay,
  };
});
