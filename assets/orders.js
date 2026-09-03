/**
 * Order-book intake: turns a pasted or uploaded delivery list into routable
 * drops.
 *
 * Real order exports are messy - different column names per system, weights in
 * kilos or tonnes, dates in three formats, the odd blank line. This parses what
 * it can, says exactly what it assumed, and reports every line it could not
 * use rather than quietly dropping it.
 */
(function (root, factory) {
  const deps = (typeof module === 'object' && module.exports)
    ? require('./eircode.js') : root.Eircode;
  const api = factory(deps);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Orders = api;
})(typeof self !== 'undefined' ? self : this, function (EIR) {
  'use strict';

  // ----------------------------------------------------------- delimited ---
  /** Picks the delimiter by which one gives the most consistent column count. */
  function sniffDelimiter(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 12);
    if (!lines.length) return ',';
    let best = ',', bestScore = -1;
    for (const d of [',', '\t', ';', '|']) {
      const counts = lines.map(l => splitLine(l, d).length);
      const max = Math.max(...counts);
      if (max < 2) continue;
      const consistent = counts.filter(c => c === max).length;
      const score = consistent * 10 + max;
      if (score > bestScore) { bestScore = score; best = d; }
    }
    return best;
  }

  /** RFC4180-ish: honours double quotes and doubled quotes inside them. */
  function splitLine(line, delim) {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (inQ) {
        if (c === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += c;
      } else if (c === '"') inQ = true;
      else if (c === delim) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  function parseTable(text) {
    const delim = sniffDelimiter(text);
    const rows = text.split(/\r?\n/).filter(l => l.trim()).map(l => splitLine(l, delim));
    return { delim, rows };
  }

  // ------------------------------------------------------------- columns ---
  /**
   * Header synonyms seen across the order systems hauliers actually run.
   * Order matters: the first pattern that matches a header wins the column.
   */
  const FIELDS = [
    ['ref', [/^(order|job|docket|consignment|delivery)?\s*(no|num|number|ref|reference|id)$/, /^ref/, /^order/, /^docket/, /^id$/]],
    ['eircode', [/eircode/, /^post\s*code$/, /^postcode$/, /^zip/]],
    ['customer', [/customer/, /consignee/, /client/, /account/, /deliver\s*to/, /^name$/, /^site$/]],
    ['address', [/address/, /^street/, /^town$/, /^location$/]],
    ['weight', [/weight/, /^kgs?$/, /^tonnes?$/, /^tons?$/, /^t$/, /^mass$/, /payload/, /^qty.*kg/]],
    ['orderedOn', [/order(ed)?\s*(date|on)/, /date\s*(placed|ordered)/, /^placed/, /^order\s*date/]],
    ['dueBy', [/due/, /required/, /^deliver\s*(by|date)/, /^delivery\s*date/, /^promise/, /^eta$/]],
    ['serviceMin', [/service/, /unload/, /offload/, /dwell/, /^mins?$/, /^minutes$/]],
    ['lat', [/^lat/, /latitude/]],
    ['lon', [/^lon/, /^lng/, /longitude/]],
    ['notes', [/note/, /comment/, /instruction/, /remark/]],
  ];

  function detectColumns(header) {
    const map = {};
    const used = new Set();
    for (const [field, patterns] of FIELDS) {
      for (let i = 0; i < header.length; i++) {
        if (used.has(i)) continue;
        const h = header[i].toLowerCase().replace(/[_.]/g, ' ').trim();
        if (patterns.some(p => p.test(h))) { map[field] = i; used.add(i); break; }
      }
    }
    return map;
  }

  /** A header row is one where nothing looks like an Eircode or a number. */
  function looksLikeHeader(row) {
    const joined = row.join(' ').toLowerCase();
    if (/eircode|weight|customer|order|postcode|ref/.test(joined)) return true;
    const eircodey = row.some(c => EIR.parse(c).ok);
    const numeric = row.filter(c => /^-?\d+(\.\d+)?$/.test(c)).length;
    return !eircodey && numeric === 0;
  }

  // --------------------------------------------------------------- values ---
  const num = v => {
    const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  /**
   * Weights arrive in kilos or tonnes and the header does not always say.
   * Use the header when it does; otherwise judge by magnitude across the whole
   * column, and report the call so it can be overridden.
   */
  function decideWeightUnit(headerText, values) {
    const h = String(headerText || '').toLowerCase();
    if (/\bkgs?\b|kilo/.test(h)) return { unit: 'kg', why: 'the column header says kg' };
    if (/\btonnes?\b|\btons?\b|\(t\)|\bt\b/.test(h)) return { unit: 't', why: 'the column header says tonnes' };
    const nums = values.map(num).filter(n => n != null && n > 0).sort((a, b) => a - b);
    if (!nums.length) return { unit: 't', why: 'no usable weights found' };
    const median = nums[Math.floor(nums.length / 2)];
    return median > 200
      ? { unit: 'kg', why: `values look like kilos (median ${Math.round(median)})` }
      : { unit: 't', why: `values look like tonnes (median ${median})` };
  }

  /** Handles ISO, d/m/y and m/d/y, preferring day-first as Ireland writes it. */
  function parseDate(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return '';
    let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return iso(+m[1], +m[2], +m[3]);
    m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/.exec(s);
    if (m) {
      let [, a, b, y] = m;
      a = +a; b = +b; y = +y;
      if (y < 100) y += 2000;
      // Day-first unless that is impossible.
      return a > 12 || b <= 12 ? iso(y, b, a) : iso(y, a, b);
    }
    const d = new Date(s);
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  const iso = (y, m, d) =>
    `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  // -------------------------------------------------------------- import ---
  /**
   * @returns {{deliveries: Array, problems: Array, summary: Object}}
   * Every input line comes back either as a delivery or as a problem with a
   * line number and a reason. Nothing disappears.
   */
  function importDeliveries(text, opts) {
    opts = opts || {};
    const out = { deliveries: [], problems: [], summary: {} };
    if (!String(text || '').trim()) {
      out.summary.note = 'Nothing to import.';
      return out;
    }

    const { delim, rows } = parseTable(text);
    if (!rows.length) return out;

    const hasHeader = looksLikeHeader(rows[0]);
    const header = hasHeader ? rows[0] : [];
    const body = hasHeader ? rows.slice(1) : rows;
    let cols = hasHeader ? detectColumns(header) : {};

    // Headerless paste: find the Eircode column by looking at the data, and
    // take the first numeric column as the weight.
    if (!hasHeader || cols.eircode == null) {
      const width = Math.max(...body.map(r => r.length));
      for (let i = 0; i < width; i++) {
        const hits = body.filter(r => r[i] && EIR.parse(r[i]).ok).length;
        if (hits >= Math.max(1, body.length * 0.5)) { cols.eircode = i; break; }
      }
      if (cols.weight == null) {
        for (let i = 0; i < width; i++) {
          if (i === cols.eircode) continue;
          const hits = body.filter(r => num(r[i]) != null && num(r[i]) > 0).length;
          if (hits >= Math.max(1, body.length * 0.6)) { cols.weight = i; break; }
        }
      }
      if (cols.customer == null) {
        for (let i = 0; i < width; i++) {
          if (i === cols.eircode || i === cols.weight) continue;
          if (body.some(r => r[i] && /[a-z]{3}/i.test(r[i]))) { cols.customer = i; break; }
        }
      }
    }

    if (cols.eircode == null && (cols.lat == null || cols.lon == null)) {
      out.problems.push({ line: 1, reason: 'No Eircode column found, and no latitude/longitude columns either.', raw: (header.join(delim) || rows[0].join(delim)) });
      out.summary = { delim, hasHeader, columns: cols, rowsSeen: body.length };
      return out;
    }

    const weightCol = cols.weight;
    const unit = weightCol == null
      ? { unit: 't', why: 'no weight column - every drop treated as unweighed' }
      : decideWeightUnit(hasHeader ? header[weightCol] : '', body.map(r => r[weightCol]));

    const get = (row, field) => cols[field] != null ? (row[cols[field]] || '') : '';

    body.forEach((row, i) => {
      const line = i + (hasHeader ? 2 : 1);
      const raw = row.join(delim);
      if (!row.some(c => c !== '')) return;

      const lat = num(get(row, 'lat')), lon = num(get(row, 'lon'));
      const codeText = get(row, 'eircode');
      const loc = EIR.locate(codeText, lat, lon);
      if (!loc.ok) {
        out.problems.push({
          line, raw,
          reason: `${loc.message} (read as "${codeText || '—'}")`,
          eircode: codeText, fixable: true,
        });
        return;
      }

      let weightT = null;
      if (weightCol != null) {
        const w = num(row[weightCol]);
        if (w != null && w > 0) weightT = unit.unit === 'kg' ? w / 1000 : w;
      }

      const svc = num(get(row, 'serviceMin'));
      out.deliveries.push({
        id: 'd' + line + '-' + Math.random().toString(36).slice(2, 6),
        ref: get(row, 'ref') || `L${line}`,
        customer: get(row, 'customer') || get(row, 'address') || loc.label,
        address: get(row, 'address') || '',
        eircode: loc.eircode,
        lat: loc.lat, lon: loc.lon,
        precision: loc.precision,
        area: loc.area ? loc.area.town : '',
        county: loc.area ? loc.area.county : '',
        weightT: weightT == null ? null : Math.round(weightT * 1000) / 1000,
        orderedOn: parseDate(get(row, 'orderedOn')),
        dueBy: parseDate(get(row, 'dueBy')),
        serviceMin: svc != null && svc >= 0 ? svc : null,
        notes: get(row, 'notes') || '',
        line,
      });
    });

    const missingWeight = out.deliveries.filter(d => d.weightT == null).length;
    out.summary = {
      delim: delim === '\t' ? 'tab' : delim,
      hasHeader, columns: cols, rowsSeen: body.length,
      imported: out.deliveries.length, rejected: out.problems.length,
      weightUnit: unit.unit, weightWhy: unit.why,
      totalT: Math.round(out.deliveries.reduce((a, d) => a + (d.weightT || 0), 0) * 100) / 100,
      missingWeight,
      exact: out.deliveries.filter(d => d.precision === 'exact').length,
      routingKeyOnly: out.deliveries.filter(d => d.precision === 'routing-key').length,
    };
    return out;
  }

  /** A worked example that shows the accepted shape without being prescriptive. */
  const SAMPLE = [
    'Order Ref,Customer,Eircode,Weight (kg),Order Date,Due By,Notes',
    'SO-10412,Kelly Builders Providers,W91 P6DF,8400,2026-08-28,2026-09-04,Forklift on site',
    'SO-10418,Murphy Concrete,R95 XH27,12600,2026-08-28,2026-09-03,',
    'SO-10423,Southside Plant Hire,T12 KD41,6200,2026-08-29,2026-09-04,Call ahead',
    'SO-10430,Riverside Homes,X91 PW32,15800,2026-08-29,2026-09-03,Tail lift not suitable',
    'SO-10441,Glenview Developments,V94 T2R8,9700,2026-08-31,2026-09-05,',
    'SO-10447,Harbour Steel,P25 FN63,18400,2026-08-31,2026-09-03,Crane offload',
    'SO-10455,Oakfield Joinery,Y21 RC08,4300,2026-09-01,2026-09-05,',
    'SO-10461,Castle Timber,N91 DA77,11200,2026-09-01,2026-09-04,',
    'SO-10468,Lakeside Roofing,H12 VW51,7600,2026-09-01,2026-09-08,',
    'SO-10474,Bantry Hardware,P75 KE29,5100,2026-09-02,2026-09-09,Narrow approach',
    'SO-10480,Shannon Fabrication,V14 YT36,13900,2026-09-02,2026-09-04,',
    'SO-10488,Nore Valley Supplies,R21 HH14,6800,2026-09-02,2026-09-08,',
  ].join('\n');

  return { importDeliveries, parseTable, detectColumns, parseDate, sniffDelimiter, SAMPLE };
});
