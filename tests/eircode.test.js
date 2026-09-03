const test = require('node:test');
const assert = require('node:assert');
const EIR = require('../assets/eircode.js');

test('all 139 routing keys are present, unique and inside Ireland', () => {
  assert.strictEqual(EIR.KEYS.size, 139, 'An Post publishes 139 routing keys');
  const seen = new Set();
  for (const a of EIR.KEYS.values()) {
    assert.ok(!seen.has(a.key), `duplicate key ${a.key}`);
    seen.add(a.key);
    assert.match(a.key, /^[ACDEFHKNPRTVWXY]\d[\dW]$/, `${a.key} is not a valid routing key shape`);
    assert.ok(a.lat > 51.3 && a.lat < 55.5, `${a.key} latitude ${a.lat} is outside Ireland`);
    assert.ok(a.lon > -10.6 && a.lon < -5.9, `${a.key} longitude ${a.lon} is outside Ireland`);
    assert.ok(a.town && a.county, `${a.key} is missing a post town or county`);
  }
});

test('every routing key parses as its own bare code', () => {
  for (const key of EIR.KEYS.keys()) {
    const p = EIR.parse(key);
    assert.ok(p.ok && p.partial, `${key} should parse as a partial code`);
  }
});

test('full codes parse regardless of spacing and case', () => {
  for (const raw of ['D02AF30', 'd02 af30', 'D02-AF30', '  D02  AF30  ']) {
    const p = EIR.parse(raw);
    assert.ok(p.ok, `${raw} should parse`);
    assert.strictEqual(p.key, 'D02');
    assert.strictEqual(p.id, 'AF30');
    assert.strictEqual(p.normalised, 'D02 AF30');
  }
});

test('the restricted alphabet is enforced', () => {
  // B, I, O, Q, S, U and Z are never used in the unique identifier, so a code
  // containing one is a typo - most often a letter O typed for a zero.
  for (const bad of ['B', 'I', 'O', 'Q', 'S', 'U', 'Z']) {
    const p = EIR.parse('D02 A' + bad + '30');
    assert.strictEqual(p.ok, false, `D02 A${bad}30 should be rejected`);
    assert.strictEqual(p.reason, 'bad-character');
    assert.match(EIR.explain(p), /B, I, O, Q, S, U or Z/);
  }
  assert.ok(EIR.parse('D02 A030').ok, 'a zero in the same position is fine');
});

test('malformed codes are rejected with a specific reason', () => {
  const cases = [
    ['', 'empty'],
    ['XX1 2345', 'bad-routing-key'],
    ['B12 3456', 'bad-routing-key'],      // B is not a valid first character
    ['Z99 1234', 'bad-routing-key'],
    ['D99 1234', 'unknown-routing-key'],  // right shape, not a real key
    ['D02 AF3', 'bad-length'],
    ['D02 AF301', 'bad-length'],
  ];
  for (const [input, reason] of cases) {
    const p = EIR.parse(input);
    assert.strictEqual(p.ok, false, `${input} should fail`);
    assert.strictEqual(p.reason, reason, `${input}: expected ${reason}, got ${p.reason}`);
    assert.ok(EIR.explain(p).length > 10);
  }
});

test('supplied coordinates always beat the routing key', () => {
  const viaKey = EIR.locate('P75 KE29');
  assert.strictEqual(viaKey.precision, 'routing-key');
  assert.strictEqual(viaKey.lat, EIR.KEYS.get('P75').lat);
  assert.match(viaKey.note, /routing area/);

  const viaCoords = EIR.locate('P75 KE29', 51.6812, -9.4501);
  assert.strictEqual(viaCoords.precision, 'exact');
  assert.strictEqual(viaCoords.lat, 51.6812);
  assert.strictEqual(viaCoords.eircode, 'P75 KE29', 'the code is still carried through');
});

test('coordinates outside Ireland are not trusted over the Eircode', () => {
  const r = EIR.locate('D02 AF30', 40.7128, -74.0060);   // New York
  assert.strictEqual(r.precision, 'routing-key');
});

test('an unreadable Eircode with no coordinates fails rather than guessing', () => {
  const r = EIR.locate('not an eircode');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.precision, 'none');
  assert.ok(r.message);
});

test('search finds areas by key, town and county', () => {
  assert.ok(EIR.search('T12').some(a => a.key === 'T12'));
  assert.ok(EIR.search('bantry').some(a => a.key === 'P75'));
  assert.ok(EIR.search('kerry').some(a => a.county === 'Kerry'));
  assert.strictEqual(EIR.search('x').length, 0, 'one character is too short to search on');
});
