/**
 * Eircode handling.
 *
 * What this can and cannot do
 * ---------------------------
 * A full Eircode is seven characters: a three-character routing key that names
 * a principal post town, then a four-character unique identifier that is
 * specific to one letterbox. The identifier is deliberately non-geographic -
 * there is no arithmetic that turns it into a coordinate. Address-level
 * resolution needs the licensed Eircode Address Database (ECAD), which is not
 * something a static page can carry.
 *
 * So this module resolves the part that IS public: the routing key. All 139 of
 * them are here with their post town and a coordinate. That puts a delivery in
 * the right town, which is the right resolution for strategic route planning -
 * and it is stated as such everywhere it is used, never dressed up as a
 * doorstep fix.
 *
 * If you have real coordinates (most order systems do), pass them: they always
 * win over the routing key.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Eircode = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [routing key, post town, county, lat, lon]
  const KEY_ROWS = [
    ['A41', 'Ballyboughal', 'Dublin', 53.5350, -6.2740],
    ['A42', 'Garristown', 'Dublin', 53.5680, -6.3810],
    ['A45', 'Oldtown', 'Dublin', 53.5310, -6.3300],
    ['A63', 'Greystones', 'Wicklow', 53.1440, -6.0700],
    ['A67', 'Wicklow', 'Wicklow', 52.9800, -6.0500],
    ['A75', 'Castleblayney', 'Monaghan', 54.1200, -6.7370],
    ['A81', 'Carrickmacross', 'Monaghan', 53.9770, -6.7180],
    ['A82', 'Kells', 'Meath', 53.7270, -6.8790],
    ['A83', 'Enfield', 'Meath', 53.4160, -6.8330],
    ['A84', 'Ashbourne', 'Meath', 53.5130, -6.3990],
    ['A85', 'Dunshaughlin', 'Meath', 53.5130, -6.5390],
    ['A86', 'Dunboyne', 'Meath', 53.4200, -6.4750],
    ['A91', 'Dundalk', 'Louth', 54.0000, -6.4050],
    ['A92', 'Drogheda', 'Louth', 53.7189, -6.3478],
    ['A94', 'Blackrock', 'Dublin', 53.3010, -6.1780],
    ['A96', 'Glenageary', 'Dublin', 53.2760, -6.1250],
    ['A98', 'Bray', 'Wicklow', 53.2010, -6.1100],

    ['C15', 'Navan', 'Meath', 53.6530, -6.6810],

    ['D01', 'Dublin 1 — north inner city', 'Dublin', 53.3540, -6.2560],
    ['D02', 'Dublin 2 — south inner city', 'Dublin', 53.3380, -6.2530],
    ['D03', 'Dublin 3 — Clontarf, Fairview', 'Dublin', 53.3660, -6.2130],
    ['D04', 'Dublin 4 — Ballsbridge, Donnybrook', 'Dublin', 53.3290, -6.2280],
    ['D05', 'Dublin 5 — Raheny, Artane', 'Dublin', 53.3830, -6.1770],
    ['D06', 'Dublin 6 — Rathmines, Ranelagh', 'Dublin', 53.3170, -6.2620],
    ['D6W', 'Dublin 6W — Templeogue', 'Dublin', 53.3070, -6.2900],
    ['D07', 'Dublin 7 — Cabra, Phibsborough', 'Dublin', 53.3630, -6.2870],
    ['D08', 'Dublin 8 — Kilmainham, Liberties', 'Dublin', 53.3390, -6.2900],
    ['D09', 'Dublin 9 — Beaumont, Santry', 'Dublin', 53.3860, -6.2400],
    ['D10', 'Dublin 10 — Ballyfermot', 'Dublin', 53.3430, -6.3620],
    ['D11', 'Dublin 11 — Finglas', 'Dublin', 53.3930, -6.2960],
    ['D12', 'Dublin 12 — Crumlin, Walkinstown', 'Dublin', 53.3220, -6.3120],
    ['D13', 'Dublin 13 — Baldoyle, Sutton', 'Dublin', 53.3930, -6.1300],
    ['D14', 'Dublin 14 — Dundrum, Churchtown', 'Dublin', 53.2960, -6.2470],
    ['D15', 'Dublin 15 — Blanchardstown', 'Dublin', 53.3900, -6.3900],
    ['D16', 'Dublin 16 — Ballinteer, Knocklyon', 'Dublin', 53.2790, -6.2760],
    ['D17', 'Dublin 17 — Coolock, Darndale', 'Dublin', 53.4000, -6.1930],
    ['D18', 'Dublin 18 — Sandyford, Foxrock', 'Dublin', 53.2660, -6.2010],
    ['D20', 'Dublin 20 — Palmerstown, Chapelizod', 'Dublin', 53.3510, -6.3720],
    ['D22', 'Dublin 22 — Clondalkin', 'Dublin', 53.3200, -6.3960],
    ['D24', 'Dublin 24 — Tallaght', 'Dublin', 53.2870, -6.3730],

    ['E21', 'Cahir', 'Tipperary', 52.3760, -7.9250],
    ['E25', 'Cashel', 'Tipperary', 52.5150, -7.8850],
    ['E32', 'Carrick-on-Suir', 'Tipperary', 52.3480, -7.4150],
    ['E34', 'Tipperary town', 'Tipperary', 52.4730, -8.1600],
    ['E41', 'Thurles', 'Tipperary', 52.6810, -7.8110],
    ['E45', 'Nenagh', 'Tipperary', 52.8640, -8.1960],
    ['E53', 'Roscrea', 'Tipperary', 52.9560, -7.7970],
    ['E91', 'Clonmel', 'Tipperary', 52.3550, -7.7040],

    ['F12', 'Claremorris', 'Mayo', 53.7220, -8.9950],
    ['F23', 'Castlebar', 'Mayo', 53.8560, -9.2980],
    ['F26', 'Ballina', 'Mayo', 54.1150, -9.1550],
    ['F28', 'Westport', 'Mayo', 53.8010, -9.5210],
    ['F31', 'Ballinrobe', 'Mayo', 53.6270, -9.2270],
    ['F35', 'Ballyhaunis', 'Mayo', 53.7620, -8.7660],
    ['F42', 'Roscommon', 'Roscommon', 53.6280, -8.1890],
    ['F45', 'Castlerea', 'Roscommon', 53.7680, -8.4930],
    ['F52', 'Boyle', 'Roscommon', 53.9740, -8.3000],
    ['F56', 'Ballymote', 'Sligo', 54.0900, -8.5170],
    ['F91', 'Sligo', 'Sligo', 54.2760, -8.4760],
    ['F92', 'Letterkenny', 'Donegal', 54.9500, -7.7340],
    ['F93', 'Lifford', 'Donegal', 54.8320, -7.4790],
    ['F94', 'Donegal town', 'Donegal', 54.6540, -8.1110],

    ['H12', 'Cavan', 'Cavan', 53.9900, -7.3600],
    ['H14', 'Belturbet', 'Cavan', 54.1000, -7.4500],
    ['H16', 'Cootehill', 'Cavan', 54.0740, -7.0810],
    ['H18', 'Monaghan', 'Monaghan', 54.2490, -6.9680],
    ['H23', 'Clones', 'Monaghan', 54.1800, -7.2320],
    ['H53', 'Ballinasloe', 'Galway', 53.3300, -8.2200],
    ['H54', 'Tuam', 'Galway', 53.5150, -8.8500],
    ['H62', 'Loughrea', 'Galway', 53.1970, -8.5680],
    ['H65', 'Athenry', 'Galway', 53.3000, -8.7450],
    ['H71', 'Clifden', 'Galway', 53.4890, -10.0210],
    ['H91', 'Galway city', 'Galway', 53.2707, -9.0568],

    ['K32', 'Balbriggan', 'Dublin', 53.6089, -6.1817],
    ['K34', 'Skerries', 'Dublin', 53.5820, -6.1080],
    ['K36', 'Malahide', 'Dublin', 53.4510, -6.1520],
    ['K45', 'Lusk', 'Dublin', 53.5270, -6.1670],
    ['K56', 'Rush', 'Dublin', 53.5240, -6.0940],
    ['K67', 'Swords', 'Dublin', 53.4597, -6.2181],
    ['K78', 'Lucan', 'Dublin', 53.3560, -6.4490],

    ['N37', 'Athlone', 'Westmeath', 53.4230, -7.9410],
    ['N39', 'Longford', 'Longford', 53.7270, -7.7930],
    ['N41', 'Carrick-on-Shannon', 'Leitrim', 53.9470, -8.0930],
    ['N91', 'Mullingar', 'Westmeath', 53.5260, -7.3390],

    ['P12', 'Macroom', 'Cork', 51.9040, -8.9640],
    ['P14', 'Crookstown', 'Cork', 51.8420, -8.8300],
    ['P17', 'Kinsale', 'Cork', 51.7060, -8.5220],
    ['P24', 'Cobh', 'Cork', 51.8510, -8.2940],
    ['P25', 'Midleton', 'Cork', 51.9130, -8.1740],
    ['P31', 'Ballincollig', 'Cork', 51.8880, -8.5900],
    ['P32', 'Donoughmore', 'Cork', 51.9800, -8.7300],
    ['P36', 'Youghal', 'Cork', 51.9540, -7.8480],
    ['P43', 'Carrigaline', 'Cork', 51.8140, -8.3990],
    ['P47', 'Dunmanway', 'Cork', 51.7220, -9.1120],
    ['P51', 'Kanturk', 'Cork', 52.1780, -8.9040],
    ['P56', 'Charleville', 'Cork', 52.3540, -8.6820],
    ['P61', 'Fermoy', 'Cork', 52.1390, -8.2770],
    ['P67', 'Mitchelstown', 'Cork', 52.2650, -8.2670],
    ['P72', 'Bandon', 'Cork', 51.7470, -8.7350],
    ['P75', 'Bantry', 'Cork', 51.6800, -9.4530],
    ['P81', 'Skibbereen', 'Cork', 51.5500, -9.2670],
    ['P85', 'Clonakilty', 'Cork', 51.6220, -8.8850],

    ['R14', 'Athy', 'Kildare', 52.9930, -6.9840],
    ['R21', 'Muine Bheag / Bagenalstown', 'Carlow', 52.7020, -6.9570],
    ['R32', 'Portlaoise', 'Laois', 53.0330, -7.3000],
    ['R35', 'Tullamore', 'Offaly', 53.2740, -7.4900],
    ['R42', 'Birr', 'Offaly', 53.0980, -7.9130],
    ['R45', 'Edenderry', 'Offaly', 53.3430, -7.0490],
    ['R51', 'Kildare town', 'Kildare', 53.1570, -6.9090],
    ['R56', 'The Curragh / Kilcullen', 'Kildare', 53.1450, -6.8300],
    ['R93', 'Carlow', 'Carlow', 52.8360, -6.9260],
    ['R95', 'Kilkenny', 'Kilkenny', 52.6540, -7.2520],

    ['T12', 'Cork city — centre and south', 'Cork', 51.8950, -8.4800],
    ['T23', 'Cork city — northside', 'Cork', 51.9100, -8.4600],
    ['T34', 'Whitechurch / Blarney', 'Cork', 51.9400, -8.5000],
    ['T45', 'Little Island', 'Cork', 51.9010, -8.3400],
    ['T56', 'Watergrasshill', 'Cork', 52.0200, -8.3500],

    ['V14', 'Shannon', 'Clare', 52.7100, -8.8650],
    ['V15', 'Kilrush', 'Clare', 52.6390, -9.4850],
    ['V23', 'Cahersiveen', 'Kerry', 51.9460, -10.2230],
    ['V31', 'Listowel', 'Kerry', 52.4470, -9.4850],
    ['V35', 'Kilmallock', 'Limerick', 52.4000, -8.5750],
    ['V42', 'Newcastle West', 'Limerick', 52.4490, -9.0570],
    ['V92', 'Tralee', 'Kerry', 52.2700, -9.7000],
    ['V93', 'Killarney', 'Kerry', 52.0590, -9.5070],
    ['V94', 'Limerick city', 'Limerick', 52.6640, -8.6230],
    ['V95', 'Ennis', 'Clare', 52.8470, -8.9860],

    ['W12', 'Newbridge', 'Kildare', 53.1800, -6.7980],
    ['W23', 'Maynooth', 'Kildare', 53.3810, -6.5910],
    ['W34', 'Monasterevin', 'Kildare', 53.1400, -7.0600],
    ['W91', 'Naas', 'Kildare', 53.2200, -6.6590],

    ['X35', 'Dungarvan', 'Waterford', 52.0900, -7.6200],
    ['X42', 'Kilmacthomas', 'Waterford', 52.2060, -7.4260],
    ['X91', 'Waterford city', 'Waterford', 52.2590, -7.1100],

    ['Y14', 'Arklow', 'Wicklow', 52.7960, -6.1640],
    ['Y21', 'Enniscorthy', 'Wexford', 52.5020, -6.5660],
    ['Y25', 'Gorey', 'Wexford', 52.6760, -6.2940],
    ['Y34', 'New Ross', 'Wexford', 52.3960, -6.9430],
    ['Y35', 'Wexford town', 'Wexford', 52.3340, -6.4630],
  ];

  const KEYS = new Map(KEY_ROWS.map(([key, town, county, lat, lon]) =>
    [key, { key, town, county, lat, lon }]));

  /**
   * Eircodes use a restricted alphabet - the letters that survive being
   * handwritten and scanned. B, I, O, Q, S, U and Z never appear in the
   * unique identifier, so a code containing them is a typo, not a real address.
   */
  const ID_ALPHABET = 'ACDEFHKNPRTVWXY0123456789';

  /** Strips spaces, dashes and case. "d02 af30" and "D02-AF30" are the same code. */
  const normalise = s => String(s == null ? '' : s).toUpperCase().replace(/[^0-9A-Z]/g, '');

  /**
   * Parses an Eircode into its routing key and unique identifier.
   * Accepts a bare routing key too - operators often only have that much.
   */
  function parse(input) {
    const raw = normalise(input);
    if (!raw) return { ok: false, reason: 'empty', input };

    const key = raw.slice(0, 3);
    if (!/^[ACDEFHKNPRTVWXY]\d[\dW]$/.test(key)) {
      return { ok: false, reason: 'bad-routing-key', input, key };
    }
    const known = KEYS.get(key);
    if (!known) return { ok: false, reason: 'unknown-routing-key', input, key };

    if (raw.length === 3) {
      return { ok: true, partial: true, key, id: '', area: known, normalised: key };
    }
    const id = raw.slice(3);
    if (id.length !== 4) {
      return { ok: false, reason: 'bad-length', input, key, area: known };
    }
    for (const ch of id) {
      if (!ID_ALPHABET.includes(ch)) {
        return { ok: false, reason: 'bad-character', input, key, area: known, badChar: ch };
      }
    }
    return { ok: true, partial: false, key, id, area: known, normalised: key + ' ' + id };
  }

  const REASONS = {
    'empty': 'No Eircode given.',
    'bad-routing-key': 'The first three characters are not a valid routing key (letter, digit, digit).',
    'unknown-routing-key': 'That routing key is not one of the 139 in use.',
    'bad-length': 'An Eircode is seven characters: a three-character routing key and a four-character identifier.',
    'bad-character': 'Eircodes never use B, I, O, Q, S, U or Z in the identifier - check for a mistyped letter.',
  };
  const explain = p => REASONS[p.reason] || 'Could not read this Eircode.';

  /**
   * Turns whatever the order line gave us into a point to route to.
   *
   * Precedence is deliberate: supplied coordinates beat the Eircode, because
   * they are the only thing here that is accurate to the gate. The returned
   * `precision` says which happened, and the UI shows it on every drop.
   */
  function locate(input, lat, lon) {
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lon) &&
      lat > 49 && lat < 56.5 && lon > -11.5 && lon < -5;
    const p = parse(input);

    if (hasCoords) {
      return {
        ok: true, lat, lon, precision: 'exact',
        eircode: p.ok ? p.normalised : (normalise(input) || ''),
        area: p.ok ? p.area : null,
        label: p.ok ? p.area.town : 'Supplied coordinates',
        note: 'Routed to the supplied coordinates.',
      };
    }
    if (!p.ok) return { ok: false, precision: 'none', reason: p.reason, message: explain(p), eircode: normalise(input) };

    return {
      ok: true, lat: p.area.lat, lon: p.area.lon, precision: 'routing-key',
      eircode: p.normalised, area: p.area, label: p.area.town,
      note: `Placed at the centre of the ${p.key} (${p.area.town}) routing area. ` +
        'The unique identifier is not public, so add coordinates if you need the exact gate.',
    };
  }

  /** Free-text lookup over routing keys and post towns, for the stop picker. */
  function search(q) {
    const needle = String(q || '').trim().toUpperCase();
    if (needle.length < 2) return [];
    const out = [];
    for (const a of KEYS.values()) {
      const hit = a.key.startsWith(needle) || a.town.toUpperCase().includes(needle) ||
        a.county.toUpperCase().includes(needle);
      if (hit) out.push(a);
    }
    return out.sort((x, y) =>
      (y.key.startsWith(needle) ? 1 : 0) - (x.key.startsWith(needle) ? 1 : 0) ||
      x.town.localeCompare(y.town));
  }

  return { KEYS, KEY_ROWS, normalise, parse, explain, locate, search, ID_ALPHABET };
});
