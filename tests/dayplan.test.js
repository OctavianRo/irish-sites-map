const test = require('node:test');
const assert = require('node:assert');
const P = require('../assets/planner.js');
const ORD = require('../assets/orders.js');
const VEH = require('../assets/vehicles.js');

const DEPOT = { name: 'Naas depot', lat: 53.2200, lon: -6.6590 };
const sample = () => ORD.importDeliveries(ORD.SAMPLE).deliveries;
const fleet = (...codes) => codes.map((c, i) => ({
  id: 'V' + (i + 1), driver: 'Driver ' + (i + 1), transportCode: c,
  depot: DEPOT, startTime: '06:00', maxDutyMin: 13 * 60,
}));
const TODAY = '2026-09-03';

/** Invariants that must hold for any plan, whatever the inputs. */
function checkInvariants(deliveries, plan, opts) {
  opts = opts || {};
  const seen = new Map();
  for (const l of plan.loads) {
    for (const d of l.deliveries) {
      assert.ok(!seen.has(d.id), `${d.ref} was loaded onto ${seen.get(d.id)} and ${l.id}`);
      seen.set(d.id, l.id);
    }
    // No single run may exceed what the vehicle is allowed to carry.
    for (const trip of l.trips) {
      const t = trip.reduce((a, d) => a + (d.weightT || 0), 0);
      assert.ok(t <= l.capacityT + 1e-6,
        `${l.id} run of ${t}t exceeds its ${l.capacityT}t capacity`);
    }
    if (l.plan) {
      assert.strictEqual(l.plan.compliance.violations.length, 0,
        `${l.id} was planned with a drivers' hours violation`);
      assert.strictEqual(l.plan.blockers.length, 0,
        `${l.id} was planned with an unroutable leg`);
      assert.ok(l.plan.totals.dutyMin <= (opts.maxDutyMin || 13 * 60) + 1e-6,
        `${l.id} duty of ${l.plan.totals.dutyMin} exceeds the window`);
    }
  }
  for (const u of plan.unassigned) {
    assert.ok(!seen.has(u.delivery.id), `${u.delivery.ref} is both loaded and unassigned`);
    assert.ok(u.reason && u.reason.code && u.reason.text, 'every leftover needs a stated reason');
  }
  assert.strictEqual(seen.size + plan.unassigned.length, deliveries.length,
    'every order must be either loaded or explained');
  assert.strictEqual(plan.summary.loaded, seen.size);
}

test('a normal order book is planned and every order is accounted for', () => {
  const deliveries = sample();
  const plan = P.buildDayPlan(deliveries, fleet('ART-44', 'RIG-32', 'RIG-26H'), { today: TODAY });
  checkInvariants(deliveries, plan);
  assert.ok(plan.summary.loaded >= 10, `only ${plan.summary.loaded} of 12 loaded`);
  assert.ok(plan.summary.km > 0 && plan.summary.costEur > 0);
});

test('capacity is the binding constraint when the fleet is small', () => {
  const deliveries = sample();
  const plan = P.buildDayPlan(deliveries, fleet('RIG-12'), { today: TODAY, allowReloads: false });
  checkInvariants(deliveries, plan);
  const cap = plan.loads[0].capacityT;
  for (const d of plan.loads[0].deliveries) assert.ok(d.weightT <= cap);
  assert.ok(plan.unassigned.length > 0);
  assert.ok(plan.unassigned.some(u => u.reason.code === 'over-capacity'),
    'orders heavier than the whole fleet should say so');
});

test('the body-type load cap is honoured and is visible in the load', () => {
  const deliveries = sample();
  const tight = P.buildDayPlan(deliveries, fleet('ART-44', 'RIG-32'), {
    today: TODAY, loadCaps: { artic: 29, rigid: 8, van: 1.5 },
  });
  checkInvariants(deliveries, tight);
  const rigid = tight.loads.find(l => l.transportCode === 'RIG-32');
  assert.strictEqual(rigid.capacityT, 8, 'the 8t rigid rule must beat the 20t plated payload');
  for (const trip of rigid.trips) {
    assert.ok(trip.reduce((a, d) => a + (d.weightT || 0), 0) <= 8 + 1e-6);
  }
});

test('a per-vehicle capacity override wins over the class default', () => {
  const deliveries = sample();
  const f = fleet('RIG-32');
  f[0].capacityOverrideT = 28;               // an operator's own 28t rigid rule
  const plan = P.buildDayPlan(deliveries, f, { today: TODAY });
  assert.strictEqual(plan.loads[0].capacityT, 28);
  checkInvariants(deliveries, plan);
  assert.ok(plan.loads[0].peakTripT > 20,
    'raising the cap should let it carry more than the default 20t payload');
});

test('reloading at the depot lets one vehicle run more than a load', () => {
  const local = ORD.importDeliveries([
    'Ref,Customer,Eircode,Weight (t),Due By',
    'A,One,W91 P6DF,11,2026-09-03',
    'B,Two,R51 XX12,11,2026-09-03',
    'C,Three,W12 YY34,11,2026-09-03',
  ].join('\n')).deliveries;

  const once = P.buildDayPlan(local, fleet('RIG-32'), { today: TODAY, allowReloads: false });
  const again = P.buildDayPlan(local, fleet('RIG-32'), { today: TODAY, allowReloads: true });
  checkInvariants(local, once);
  checkInvariants(local, again);
  assert.strictEqual(once.loads[0].trips.length, 1);
  assert.ok(again.loads[0].trips.length > 1, 'nearby work should justify a second run');
  assert.ok(again.summary.loaded > once.summary.loaded);
  assert.ok(again.loads[0].plan.timeline.some(e => /reload/i.test(e.label)),
    'the reload must appear in the driver\'s day');
});

test('an order no vehicle can reach is reported, not silently dropped', () => {
  // Kenmare: every approach is a mountain pass or the Ring of Kerry.
  const deliveries = ORD.importDeliveries([
    'Ref,Customer,Eircode,Weight (t)',
    'K1,Kenmare Builders,V93 KN01,10',
  ].join('\n')).deliveries;
  deliveries[0].lat = 51.8800; deliveries[0].lon = -9.5830;   // pin it on Kenmare itself

  const plan = P.buildDayPlan(deliveries, fleet('ART-44'), { today: TODAY });
  checkInvariants(deliveries, plan);
  assert.strictEqual(plan.summary.loaded, 0);
  assert.strictEqual(plan.unassigned[0].reason.code, 'unreachable');
  assert.match(plan.unassigned[0].reason.text, /RIG-32|could/);
});

test('urgency pulls an overdue order ahead of a convenient one', () => {
  const overdue = { dueBy: '2026-08-25', orderedOn: '2026-08-01' };
  const relaxed = { dueBy: '2026-09-30', orderedOn: '2026-09-02' };
  const today = P.dayNum(TODAY);
  assert.ok(P.urgencyMin(overdue, today) > P.urgencyMin(relaxed, today));
  assert.strictEqual(P.urgencyMin(relaxed, today), 0, 'work with plenty of slack gets no boost');
  assert.ok(P.urgencyMin({ dueBy: TODAY }, today) >= 90, 'due today should pull hard');
});

test('an overdue order is loaded ahead of a nearer one when only one fits', () => {
  const deliveries = ORD.importDeliveries([
    'Ref,Customer,Eircode,Weight (t),Order Date,Due By',
    'NEAR,Next door,W91 AA11,10,2026-09-02,2026-09-30',
    'LATE,Overdue in Cork,T12 CC22,10,2026-08-01,2026-08-25',
  ].join('\n')).deliveries;
  const f = fleet('RIG-32');
  f[0].capacityOverrideT = 10;                 // room for exactly one
  const plan = P.buildDayPlan(deliveries, f, { today: TODAY, allowReloads: false });
  checkInvariants(deliveries, plan);
  assert.strictEqual(plan.loads[0].deliveries.length, 1);
  assert.strictEqual(plan.loads[0].deliveries[0].ref, 'LATE',
    'the overdue Cork order should beat the convenient local one');
});

test('an empty fleet or an empty order book is handled without throwing', () => {
  assert.doesNotThrow(() => P.buildDayPlan([], fleet('ART-44'), { today: TODAY }));
  assert.doesNotThrow(() => P.buildDayPlan(sample(), [], { today: TODAY }));
  const none = P.buildDayPlan(sample(), [], { today: TODAY });
  assert.strictEqual(none.summary.loaded, 0);
  assert.strictEqual(none.unassigned.length, 12);
});

test('orders with no weight are still planned', () => {
  const deliveries = ORD.importDeliveries([
    'Ref,Customer,Eircode',
    'A,One,W91 P6DF', 'B,Two,R51 XX12',
  ].join('\n')).deliveries;
  assert.ok(deliveries.every(d => d.weightT === null));
  const plan = P.buildDayPlan(deliveries, fleet('RIG-26H'), { today: TODAY });
  checkInvariants(deliveries, plan);
  assert.strictEqual(plan.summary.loaded, 2);
});

test('a shorter shift loads less, and says hours were the reason', () => {
  const deliveries = sample();
  const short = fleet('ART-44', 'RIG-32', 'RIG-26H').map(f =>
    Object.assign({}, f, { maxDutyMin: 6 * 60 }));
  const plan = P.buildDayPlan(deliveries, short, { today: TODAY });
  checkInvariants(deliveries, plan, { maxDutyMin: 6 * 60 });
  const full = P.buildDayPlan(deliveries, fleet('ART-44', 'RIG-32', 'RIG-26H'), { today: TODAY });
  assert.ok(plan.summary.loaded < full.summary.loaded);
  assert.ok(plan.unassigned.some(u => u.reason.code === 'hours'));
});

test('planning a large book stays fast enough to feel instant', () => {
  const keys = [...require('../assets/eircode.js').KEYS.keys()];
  const rows = ['Ref,Customer,Eircode,Weight (t),Order Date,Due By'];
  for (let i = 0; i < 120; i++) {
    rows.push(`R${i},Customer ${i},${keys[i % keys.length]} AA11,${1 + (i % 9)},2026-08-30,2026-09-0${1 + (i % 5)}`);
  }
  const deliveries = ORD.importDeliveries(rows.join('\n')).deliveries;
  assert.strictEqual(deliveries.length, 120);
  const t0 = Date.now();
  const plan = P.buildDayPlan(deliveries, fleet('ART-44', 'ART-44', 'RIG-32', 'RIG-26H', 'RIG-18'),
    { today: TODAY });
  const ms = Date.now() - t0;
  checkInvariants(deliveries, plan);
  assert.ok(ms < 8000, `planning 120 orders took ${ms} ms`);
});
