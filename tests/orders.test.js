const test = require('node:test');
const assert = require('node:assert');
const ORD = require('../assets/orders.js');

test('the sample order book imports cleanly', () => {
  const r = ORD.importDeliveries(ORD.SAMPLE);
  assert.strictEqual(r.problems.length, 0);
  assert.strictEqual(r.deliveries.length, 12);
  assert.strictEqual(r.summary.weightUnit, 'kg');
  assert.strictEqual(r.summary.totalT, 120);
  assert.ok(r.deliveries.every(d => d.weightT > 0 && d.weightT < 30));
});

test('weights in kilos are converted, and the reason is reported', () => {
  const kg = ORD.importDeliveries('Ref,Eircode,Weight (kg)\nA,W91 P6DF,8400');
  assert.strictEqual(kg.deliveries[0].weightT, 8.4);
  assert.match(kg.summary.weightWhy, /header says kg/);

  const t = ORD.importDeliveries('Ref,Eircode,Weight (tonnes)\nA,W91 P6DF,8.4');
  assert.strictEqual(t.deliveries[0].weightT, 8.4);
  assert.match(t.summary.weightWhy, /header says tonnes/);
});

test('an unlabelled weight column is judged by magnitude', () => {
  const big = ORD.importDeliveries('Ref,Eircode,Weight\nA,W91 P6DF,8400\nB,R95 XH27,12600');
  assert.strictEqual(big.summary.weightUnit, 'kg');
  assert.strictEqual(big.deliveries[0].weightT, 8.4);

  const small = ORD.importDeliveries('Ref,Eircode,Weight\nA,W91 P6DF,8.4\nB,R95 XH27,12.6');
  assert.strictEqual(small.summary.weightUnit, 't');
  assert.strictEqual(small.deliveries[0].weightT, 8.4);
});

test('tab, semicolon and pipe separated files all import', () => {
  for (const d of ['\t', ';', '|']) {
    const text = ['Ref', 'Eircode', 'Weight (kg)'].join(d) + '\n' +
      ['A', 'W91 P6DF', '8400'].join(d);
    const r = ORD.importDeliveries(text);
    assert.strictEqual(r.deliveries.length, 1, `${JSON.stringify(d)} failed`);
    assert.strictEqual(r.deliveries[0].weightT, 8.4);
  }
});

test('a headerless paste still finds the Eircode and weight columns', () => {
  const r = ORD.importDeliveries('SO-1,Kelly Builders,W91 P6DF,8400\nSO-2,Murphy,R95 XH27,12600');
  assert.strictEqual(r.deliveries.length, 2);
  assert.strictEqual(r.summary.hasHeader, false);
  assert.strictEqual(r.deliveries[0].area, 'Naas');
  assert.strictEqual(r.deliveries[0].weightT, 8.4);
});

test('quoted fields containing commas survive', () => {
  const r = ORD.importDeliveries(
    'Ref,Customer,Eircode,Weight (kg)\nA,"Kelly, Murphy & Sons",W91 P6DF,8400');
  assert.strictEqual(r.deliveries[0].customer, 'Kelly, Murphy & Sons');
});

test('dates are read day-first, as Ireland writes them', () => {
  assert.strictEqual(ORD.parseDate('03/09/2026'), '2026-09-03');
  assert.strictEqual(ORD.parseDate('2026-09-03'), '2026-09-03');
  assert.strictEqual(ORD.parseDate('3-9-26'), '2026-09-03');
  assert.strictEqual(ORD.parseDate('13/09/2026'), '2026-09-13');
  assert.strictEqual(ORD.parseDate(''), '');
});

test('bad lines are reported with a line number, never dropped silently', () => {
  const r = ORD.importDeliveries([
    'Ref,Eircode,Weight (kg)',
    'A,D02 AF30,4000',
    'B,ZZ9 QQQQ,3000',
    'C,D02 AB1O,2000',
    'D,V94 T2R8,5000',
  ].join('\n'));
  assert.strictEqual(r.deliveries.length, 2);
  assert.strictEqual(r.problems.length, 2);
  assert.deepStrictEqual(r.problems.map(p => p.line), [3, 4]);
  assert.match(r.problems[0].reason, /routing key/);
  assert.match(r.problems[1].reason, /B, I, O, Q, S, U or Z/);
  // Every input row is accounted for one way or the other.
  assert.strictEqual(r.deliveries.length + r.problems.length, 4);
});

test('coordinates in the file override the Eircode', () => {
  const r = ORD.importDeliveries(
    'Ref,Eircode,Weight (t),Latitude,Longitude\nA,P75 KE29,6,51.6812,-9.4501');
  assert.strictEqual(r.deliveries[0].precision, 'exact');
  assert.strictEqual(r.deliveries[0].lat, 51.6812);
  assert.strictEqual(r.summary.exact, 1);
  assert.strictEqual(r.summary.routingKeyOnly, 0);
});

test('a file with no Eircode and no coordinates fails loudly', () => {
  const r = ORD.importDeliveries('Ref,Customer,Weight\nA,Kelly,8400');
  assert.strictEqual(r.deliveries.length, 0);
  assert.strictEqual(r.problems.length, 1);
  assert.match(r.problems[0].reason, /No Eircode column/);
});

test('missing weights are counted rather than assumed', () => {
  const r = ORD.importDeliveries('Ref,Eircode,Weight (kg)\nA,W91 P6DF,\nB,R95 XH27,12600');
  assert.strictEqual(r.deliveries.length, 2);
  assert.strictEqual(r.deliveries[0].weightT, null);
  assert.strictEqual(r.summary.missingWeight, 1);
});

test('blank lines and trailing whitespace do not become deliveries', () => {
  const r = ORD.importDeliveries('Ref,Eircode,Weight (kg)\nA,W91 P6DF,8400\n\n   \n');
  assert.strictEqual(r.deliveries.length, 1);
  assert.strictEqual(r.problems.length, 0);
});
