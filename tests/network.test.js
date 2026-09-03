const test = require('node:test');
const assert = require('node:assert');
const NET = require('../assets/network.js');
const VEH = require('../assets/vehicles.js');
const P = require('../assets/planner.js');

const artic = VEH.resolve('ART-44');
const silo = VEH.resolve('ART-SILO');
const rigid = VEH.resolve('RIG-26H');
const van = VEH.resolve('VAN-35');

const kmBetween = (a, b, v) => {
  const r = P.searchRoute(a, b, v || artic, 'balanced');
  assert.ok(r, `no route ${a} -> ${b}`);
  return r.km;
};

test('graph is well formed and fully connected', () => {
  assert.ok(NET.NODES.size > 150);
  assert.ok(NET.EDGES.length > 200);
  for (const e of NET.EDGES) {
    assert.ok(e.km > 0, `${e.ref} has no length`);
    assert.ok(e.a !== e.b, `${e.ref} is a self-loop`);
  }
  const seen = new Set(['DUB_CITY']), q = ['DUB_CITY'];
  while (q.length) {
    for (const { to } of NET.ADJ.get(q.pop())) if (!seen.has(to)) { seen.add(to); q.push(to); }
  }
  assert.strictEqual(seen.size, NET.NODES.size, 'some nodes are unreachable');
});

test('no duplicate edges between the same pair', () => {
  const seen = new Set();
  for (const e of NET.EDGES) {
    const key = [e.a, e.b].sort().join('~');
    assert.ok(!seen.has(key), `duplicate edge ${key} (${e.ref})`);
    seen.add(key);
  }
});

// Published road distances for the normal HGV route. The network is built from
// great-circle lengths times a per-class factor, so this is the check that the
// factors stay honest. 12% either way is the tolerance.
const CORRIDORS = [
  ['DUB_CITY', 'CORK', 256], ['DUB_CITY', 'GALWAY', 208], ['DUB_CITY', 'LIMERICK', 198],
  ['DUB_CITY', 'WATERFORD', 163], ['DUB_CITY', 'BELFAST', 167], ['DUB_CITY', 'SLIGO', 214],
  ['DUB_CITY', 'WEXFORD', 141], ['DUB_CITY', 'ROSSLARE', 168], ['DUB_CITY', 'DONEGAL_TOWN', 233],
  ['DUB_CITY', 'TRALEE', 300], ['DUB_CITY', 'KILLARNEY', 304], ['DUB_CITY', 'LETTERKENNY', 236],
  ['CORK', 'LIMERICK', 105], ['CORK', 'GALWAY', 209], ['CORK', 'WATERFORD', 122],
  ['LIMERICK', 'GALWAY', 105], ['GALWAY', 'SLIGO', 137], ['BELFAST', 'DERRY', 114],
  ['CORK', 'KILLARNEY', 87], ['LIMERICK', 'TRALEE', 111], ['DUNDALK', 'BELFAST', 84],
];

for (const [a, b, expected] of CORRIDORS) {
  test(`${a} -> ${b} is within 12% of ${expected} km`, () => {
    const got = kmBetween(a, b);
    const drift = Math.abs(got - expected) / expected;
    assert.ok(drift <= 0.12, `expected ~${expected} km, modelled ${got} km (${(drift * 100).toFixed(1)}% out)`);
  });
}

test('an artic is barred from the roads that really do bar them', () => {
  const barred = [
    ['GLENGARRIFF', 'KENMARE'],   // N71 Caha Pass tunnels
    ['KILLORGLIN', 'CAHERSIVEEN'], // N70 Ring of Kerry
    ['WATERVILLE', 'SNEEM'],
    ['KENMARE', 'KILLARNEY'],      // Moll's Gap
    ['CLIFDEN', 'LEENANE'],        // N59 Connemara
    ['KILLYBEGS', 'DUNGLOE'],      // N56 west Donegal
    ['CLONMEL', 'DUNGARVAN'],      // R672 Knockmealdowns
  ];
  for (const [a, b] of barred) {
    const e = NET.EDGES.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a));
    assert.ok(e, `missing edge ${a}-${b}`);
    assert.ok(NET.assessEdge(e, artic).blocked, `${e.ref} ${a}-${b} should be blocked for a 16.5m artic`);
    assert.ok(!NET.assessEdge(e, van).blocked, `${e.ref} should still be open to a van`);
  }
});

test('a van is never blocked anywhere on the network', () => {
  for (const e of NET.EDGES) {
    assert.ok(!NET.assessEdge(e, van).blocked, `van blocked on ${e.ref} (${e.a}-${e.b})`);
  }
});

test('motorways and national primaries stay open to a 44t artic', () => {
  for (const e of NET.EDGES) {
    if (e.cls === 'motorway' || e.cls === 'dual' || e.cls === 'primary') {
      assert.ok(!NET.assessEdge(e, artic).blocked, `artic blocked on ${e.cls} ${e.ref}`);
    }
  }
});

test('the tall silo trailer is stopped by the signed headroom the artic clears', () => {
  const caha = NET.EDGES.find(e => e.a === 'GLENGARRIFF' && e.b === 'KENMARE');
  const h = NET.assessEdge(caha, silo).reasons.find(r => r.kind === 'height');
  assert.ok(h, 'expected a height block for a 4.50m body under a 4.20m limit');

  const tunnel = NET.EDGES.find(e => e.tunnel && e.maxHeightM === 4.65);
  assert.ok(!NET.assessEdge(tunnel, silo).blocked, '4.50m clears 4.65m headroom');
});

test('Kenmare has no artic-suitable approach, and the planner says so', () => {
  // Every road into Kenmare is a mountain pass or the Ring of Kerry. That is a
  // real operational fact, and reporting it beats inventing a route: the answer
  // an operator needs is "send the rigid".
  assert.strictEqual(P.searchRoute('KILLARNEY', 'KENMARE', artic, 'balanced'), null);
  assert.strictEqual(P.searchRoute('GLENGARRIFF', 'KENMARE', artic, 'balanced'), null);

  const viaMollsGap = P.searchRoute('KILLARNEY', 'KENMARE', rigid, 'balanced');
  assert.ok(viaMollsGap, 'a 26t rigid can make it over the pass');
  assert.ok(viaMollsGap.warnings.some(w => w.severity === 'caution'),
    'and should be warned that it is tight');

  const plan = P.planSchedule({
    transportCode: 'ART-44', startTime: '07:00',
    stops: [
      { name: 'Killarney depot', lat: 52.059, lon: -9.507 },
      { name: 'Kenmare site', lat: 51.880, lon: -9.583 },
    ],
  });
  assert.strictEqual(plan.verdict, 'blocked');
  // And it names the unit to send instead, rather than just refusing.
  assert.match(plan.blockers[0].text, /largest unit that gets there is RIG-32/);
  assert.strictEqual(plan.legs[0].suggestion.code, 'RIG-32');
});

test('dangerous goods are turned out of the restricted tunnels', () => {
  const plain = P.searchRoute('DUB_PORT', 'M50_J9', artic, 'fastest');
  const adr = P.searchRoute('DUB_PORT', 'M50_J9', artic, 'fastest', { adr: true });
  assert.ok(plain.steps.some(s => /Tunnel/i.test(s.ref)), 'normal freight should use the Port Tunnel');
  assert.ok(!adr.steps.some(s => /Tunnel/i.test(s.ref)), 'ADR load must be routed out of the tunnel');
});

test('HGVs travel the Dublin Port Tunnel free while cars pay', () => {
  const t = NET.EDGES.find(e => e.toll === 'DUBLIN_PORT_TUNNEL');
  assert.strictEqual(NET.tollFor(t, artic), 0);
  assert.ok(NET.tollFor(t, van) > 0);
});

test('toll-light routing actually avoids plazas when asked', () => {
  const fast = P.searchRoute('DUB_CITY', 'GALWAY', artic, 'fastest');
  const cheap = P.searchRoute('DUB_CITY', 'GALWAY', artic, 'tollFree');
  assert.ok(cheap.tollEur < fast.tollEur, 'toll-light route should cost less in tolls');
  assert.ok(cheap.driveMin >= fast.driveMin, 'and it should not also be faster');
});

test('bigger vehicles are never faster than smaller ones on the same road', () => {
  for (const e of NET.EDGES) {
    assert.ok(NET.edgeSpeedKph(e, van) >= NET.edgeSpeedKph(e, artic),
      `artic faster than a van on ${e.ref}`);
  }
});
