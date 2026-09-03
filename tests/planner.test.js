const test = require('node:test');
const assert = require('node:assert');
const P = require('../assets/planner.js');
const VEH = require('../assets/vehicles.js');

const at = (name, lat, lon, serviceMin) => ({ name, lat, lon, serviceMin });
const DUBLIN_DEPOT = at('Dublin depot', 53.3251, -6.3805);   // Red Cow
const DUBLIN_2 = at('Dublin 2 site', 53.3400, -6.2550);      // inside the HGV cordon
const CORK_SITE = at('Cork site', 51.8985, -8.4756);
const GALWAY_SITE = at('Galway site', 53.2707, -9.0568);
const TRALEE_SITE = at('Tralee site', 52.2700, -9.7000);

test('a short local day is clear and needs no statutory break', () => {
  const plan = P.planSchedule({
    driver: 'A. Byrne', transportCode: 'RIG-26H', startTime: '07:00',
    stops: [DUBLIN_DEPOT, at('Naas site', 53.2200, -6.6590, 45), at('Newbridge site', 53.1800, -6.7980, 45)],
  });
  assert.strictEqual(plan.verdict, 'clear', JSON.stringify(plan.warnings));
  assert.strictEqual(plan.totals.breakMin, 0);
  assert.ok(plan.totals.driveMin < 4 * 60 + 30);
  assert.ok(plan.money.totalEur > 0);
});

test('a long day gets a 45 minute break inserted at the 4h30 driving limit', () => {
  const plan = P.planSchedule({
    driver: 'B. Nolan', transportCode: 'ART-44', startTime: '06:00',
    stops: [DUBLIN_DEPOT, CORK_SITE, TRALEE_SITE],
  });
  const breaks = plan.timeline.filter(t => t.type === 'break');
  assert.ok(breaks.length >= 1, 'expected at least one statutory break');
  assert.strictEqual(breaks[0].min, 45);

  // No stretch of continuous driving may exceed 4h30.
  let run = 0, worst = 0;
  for (const t of plan.timeline) {
    if (t.type === 'drive') { run += t.min; worst = Math.max(worst, run); }
    else if (t.type === 'break') run = 0;
  }
  assert.ok(worst <= 4 * 60 + 30, `continuous driving reached ${worst} min`);
});

test('offloading is other work, so it does not reset the driving clock', () => {
  const plan = P.planSchedule({
    transportCode: 'ART-44', startTime: '06:00',
    stops: [DUBLIN_DEPOT, at('Midway drop', 52.5150, -7.8850, 90), CORK_SITE, TRALEE_SITE],
  });
  // A 90 minute tip sits between the drives, yet a real break is still required.
  assert.ok(plan.timeline.some(t => t.type === 'break' && t.statutory));
  assert.ok(plan.compliance.notes.some(n => /other work/.test(n)));
});

test('an impossible day is reported as illegal rather than quietly planned', () => {
  const plan = P.planSchedule({
    driver: 'C. Walsh', transportCode: 'ART-44', startTime: '06:00',
    stops: [DUBLIN_DEPOT, TRALEE_SITE, at('Letterkenny site', 54.9500, -7.7340, 45), DUBLIN_DEPOT],
  });
  assert.strictEqual(plan.verdict, 'illegal');
  assert.ok(plan.compliance.violations.length > 0);
  assert.ok(plan.compliance.violations.some(v => /10h|15h/.test(v)));
});

test('a 3.5t van is outside EU drivers hours entirely', () => {
  const plan = P.planSchedule({
    transportCode: 'VAN-35', startTime: '06:00',
    stops: [DUBLIN_DEPOT, CORK_SITE, GALWAY_SITE],
  });
  assert.ok(plan.compliance.notes.some(n => /do not apply/.test(n)));
  assert.strictEqual(plan.compliance.violations.length, 0);
});

test('the Dublin five-axle cordon ban blocks a daytime artic drop but not an early one', () => {
  const daytime = P.planSchedule({
    transportCode: 'ART-44', startTime: '08:00',
    stops: [DUBLIN_DEPOT, Object.assign({}, DUBLIN_2, { serviceMin: 45 })],
  });
  assert.strictEqual(daytime.verdict, 'blocked');
  assert.ok(daytime.blockers.some(b => /ban/.test(b.text) && /permit/i.test(b.text)));

  const early = P.planSchedule({
    transportCode: 'ART-44', startTime: '05:00',
    stops: [DUBLIN_DEPOT, Object.assign({}, DUBLIN_2, { serviceMin: 45 })],
  });
  assert.notStrictEqual(early.verdict, 'blocked');

  // A three-axle rigid is under the five-axle threshold at any hour.
  const rigid = P.planSchedule({
    transportCode: 'RIG-26H', startTime: '08:00',
    stops: [DUBLIN_DEPOT, Object.assign({}, DUBLIN_2, { serviceMin: 45 })],
  });
  assert.notStrictEqual(rigid.verdict, 'blocked');
});

test('the final mile is assessed and scales with vehicle size', () => {
  const remote = { name: 'Remote site', lat: 53.9000, lon: -9.9000 };  // west Mayo, well off the network
  const big = P.assessAccess(remote, VEH.resolve('ART-44'));
  const small = P.assessAccess(remote, VEH.resolve('RIG-18'));
  assert.ok(big.approachKm > 5);
  assert.strictEqual(big.level, 'high');
  assert.strictEqual(small.level, 'medium');

  const onRoad = P.assessAccess({ name: 'Naas', lat: 53.2200, lon: -6.6590 }, VEH.resolve('ART-44'));
  assert.strictEqual(onRoad.level, 'low');
});

test('route options are distinct, ranked, and carry a stated reason', () => {
  const v = VEH.resolve('ART-44');
  const { options, recommended, reason } = P.routeOptions('DUB_CITY', 'GALWAY', v, {});
  assert.ok(options.length >= 2);
  assert.ok(recommended);
  assert.ok(typeof reason === 'string' && reason.length > 10);
  assert.strictEqual(options.filter(o => o.recommended).length, 1);
  assert.strictEqual(options[0], recommended, 'the recommendation is listed first');
  for (const o of options) {
    assert.ok(o.itinerary.length > 0);
    assert.ok(o.money.totalEur > 0);
  }
});

test('drop-sequence optimisation never makes the day worse', () => {
  const v = VEH.resolve('RIG-26H');
  const stops = [
    DUBLIN_DEPOT,
    at('Wexford', 52.3340, -6.4630, 45),
    at('Naas', 53.2200, -6.6590, 45),
    at('Arklow', 52.7960, -6.1640, 45),
    at('Bray', 53.2010, -6.1100, 45),
  ];
  const out = P.optimiseOrder(stops, v, { fixedEnd: false });
  assert.ok(out.improvedMin >= 0, 'optimiser must not return a worse tour');
  assert.strictEqual(out.stops.length, stops.length);
  assert.strictEqual(out.stops[0], stops[0], 'the depot stays first');
  assert.deepStrictEqual(
    new Set(out.stops.map(s => s.name)), new Set(stops.map(s => s.name)),
    'every drop survives the reorder');
});

test('optimisation with a fixed return to the yard keeps both ends pinned', () => {
  const v = VEH.resolve('RIG-26H');
  const stops = [
    DUBLIN_DEPOT,
    at('Gorey', 52.6760, -6.2940, 30),
    at('Naas', 53.2200, -6.6590, 30),
    at('Arklow', 52.7960, -6.1640, 30),
    DUBLIN_DEPOT,
  ];
  const out = P.optimiseOrder(stops, v, { fixedEnd: true });
  assert.strictEqual(out.stops[0].name, 'Dublin depot');
  assert.strictEqual(out.stops[out.stops.length - 1].name, 'Dublin depot');
});

test('fleet fit answers "which of my trucks can actually do this run"', () => {
  const stops = [
    at('Killarney depot', 52.0590, -9.5070),
    at('Kenmare site', 51.8800, -9.5830, 60),
  ];
  const rows = P.fleetFit(stops, {});
  const byCode = Object.fromEntries(rows.map(r => [r.code, r]));
  assert.strictEqual(byCode['ART-44'].verdict, 'blocked');
  assert.notStrictEqual(byCode['RIG-26H'].verdict, 'blocked');
  assert.ok(byCode['ART-44'].payloadT > byCode['RIG-26H'].payloadT,
    'the artic still carries more - the trade-off the operator is making');
});

test('an unknown transport code fails loudly instead of guessing', () => {
  const plan = P.planSchedule({ transportCode: 'NOPE-1', stops: [DUBLIN_DEPOT, CORK_SITE] });
  assert.match(plan.error, /Unknown transport code/);
});

test('a custom transport code can override any dimension', () => {
  const tall = VEH.resolve('ART-44', { heightM: 4.90, code: 'ART-HIGH' });
  assert.strictEqual(tall.heightM, 4.90);
  const plan = P.planSchedule({
    transportCode: 'ART-HIGH', vehicleOverrides: { heightM: 4.90 },
    startTime: '06:00',
    stops: [at('Dublin Port', 53.3480, -6.2050), at('Naas', 53.2200, -6.6590, 30)],
  });
  // 4.90m cannot use the 4.65m Port Tunnel, so the route must go round.
  const usedTunnel = plan.legs[0].route.steps.some(s => /Port Tunnel/.test(s.ref));
  assert.strictEqual(usedTunnel, false, 'an over-height body must be kept out of the tunnel');
});

test('timeline is contiguous and ends where the totals say it does', () => {
  const plan = P.planSchedule({
    transportCode: 'ART-44', startTime: '07:00',
    stops: [DUBLIN_DEPOT, CORK_SITE, at('Limerick site', 52.6640, -8.6230, 45)],
  });
  for (let i = 1; i < plan.timeline.length; i++) {
    assert.strictEqual(plan.timeline[i].startMin, plan.timeline[i - 1].endMin,
      'timeline has a gap or overlap');
  }
  assert.strictEqual(plan.endMin, plan.timeline[plan.timeline.length - 1].endMin);
  assert.strictEqual(plan.totals.dutyMin, plan.endMin - P.hhmmToMin('07:00'));
});

test('time formatting rolls past midnight instead of wrapping silently', () => {
  assert.strictEqual(P.minToHHMM(6 * 60), '06:00');
  assert.strictEqual(P.minToHHMM(25 * 60), '01:00 +1d');
  assert.strictEqual(P.minToHrs(285), '4h 45m');
});

test('a five-axle unit is also blocked leaving a yard inside the Dublin cordon', () => {
  const yard = { name: 'Dublin 2 yard', lat: 53.3400, lon: -6.2550 };
  const plan = P.planSchedule({
    transportCode: 'ART-44', startTime: '08:00',
    stops: [yard, at('Naas site', 53.2200, -6.6590, 45)],
  });
  assert.ok(plan.blockers.some(b => /Departing/.test(b.text)),
    'the outbound leg breaches the ban just as an inbound one would');

  const early = P.planSchedule({
    transportCode: 'ART-44', startTime: '05:30',
    stops: [yard, at('Naas site', 53.2200, -6.6590, 45)],
  });
  assert.ok(!early.blockers.some(b => /Departing/.test(b.text)));
});

test('local road knowledge reaches the driver on national roads too', () => {
  // The Barnesmore Gap note lives on an N15 section - a "primary" class edge.
  const r = P.searchRoute('DONEGAL_TOWN', 'STRANORLAR', VEH.resolve('ART-44'), 'balanced');
  assert.ok(r.warnings.some(w => /Barnesmore/.test(w.text)),
    'notes attached to national roads must not be filtered out');
});
