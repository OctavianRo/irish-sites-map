/**
 * Strategic road network for the island of Ireland, tagged for HGV suitability.
 *
 * Scope and honesty note
 * ----------------------
 * This is a *strategic* network: motorways, national primary and secondary
 * roads, plus the regional roads that matter to a haulier because they are
 * either the only way through or a well-known trap. It is not a full OSM
 * extract, so it routes trunk-to-trunk and then reports the final mile off the
 * network as an assessed risk rather than a turn list. Every restriction below
 * is a real, signed or published one; the width and bend ratings are operator
 * judgement calls, and are shown to the user as such.
 *
 * Distances are derived from great-circle length times a per-class sinuosity
 * factor rather than measured centrelines; tests/network.test.js pins the
 * resulting corridor totals against published inter-city distances.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RoadNetwork = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------- nodes ---
  // [id, name, lat, lon, county]
  const NODE_ROWS = [
    // Dublin and the M50 orbital
    ['DUB_CITY', 'Dublin city centre', 53.3498, -6.2603, 'Dublin'],
    ['DUB_PORT', 'Dublin Port', 53.3480, -6.2050, 'Dublin'],
    ['DUB_AIR', 'Dublin Airport', 53.4264, -6.2499, 'Dublin'],
    ['M50_J3', 'M50 J3 (M1 / Airport)', 53.4090, -6.2290, 'Dublin'],
    ['M50_J5', 'M50 J5 (N2 Finglas)', 53.3960, -6.3080, 'Dublin'],
    ['M50_J6', 'M50 J6 (N3 Blanchardstown)', 53.3800, -6.3740, 'Dublin'],
    ['M50_J7', 'M50 J7 (N4 Lucan)', 53.3520, -6.4030, 'Dublin'],
    ['M50_J9', 'M50 J9 (N7 Red Cow)', 53.3251, -6.3805, 'Dublin'],
    ['M50_J11', 'M50 J11 (N81 Tallaght)', 53.2870, -6.3620, 'Dublin'],
    ['M50_J13', 'M50 J13 (Sandyford)', 53.2760, -6.2480, 'Dublin'],
    ['M50_J17', 'M50 J17 (M11 Shankill)', 53.2320, -6.1560, 'Dublin'],
    ['TALLAGHT', 'Tallaght', 53.2860, -6.3730, 'Dublin'],
    ['SWORDS', 'Swords', 53.4597, -6.2181, 'Dublin'],

    // M1 / A1 corridor north
    ['BALBRIGGAN', 'Balbriggan', 53.6089, -6.1817, 'Dublin'],
    ['DROGHEDA', 'Drogheda', 53.7189, -6.3478, 'Louth'],
    ['DUNLEER', 'Dunleer', 53.8300, -6.3960, 'Louth'],
    ['DUNDALK', 'Dundalk', 54.0000, -6.4050, 'Louth'],
    ['NEWRY', 'Newry', 54.1758, -6.3372, 'Down'],
    ['BANBRIDGE', 'Banbridge', 54.3489, -6.2700, 'Down'],
    ['LISBURN', 'Lisburn', 54.5100, -6.0400, 'Antrim'],
    ['BELFAST', 'Belfast', 54.5973, -5.9301, 'Antrim'],
    ['LARNE', 'Larne', 54.8500, -5.8200, 'Antrim'],
    ['ANTRIM', 'Antrim', 54.7200, -6.2100, 'Antrim'],
    ['BALLYMENA', 'Ballymena', 54.8640, -6.2760, 'Antrim'],
    ['COLERAINE', 'Coleraine', 55.1320, -6.6680, 'Derry'],
    ['DERRY', 'Derry / Londonderry', 54.9970, -7.3090, 'Derry'],
    ['DUNGIVEN', 'Dungiven', 54.9200, -6.9200, 'Derry'],
    ['DUNGANNON', 'Dungannon', 54.5090, -6.7660, 'Tyrone'],
    ['OMAGH', 'Omagh', 54.5980, -7.3080, 'Tyrone'],
    ['STRABANE', 'Strabane', 54.8280, -7.4630, 'Tyrone'],
    ['AUGHNACLOY', 'Aughnacloy', 54.4200, -6.9800, 'Tyrone'],
    ['ENNISKILLEN', 'Enniskillen', 54.3440, -7.6320, 'Fermanagh'],
    ['ARMAGH', 'Armagh', 54.3500, -6.6500, 'Armagh'],
    ['PORTADOWN', 'Portadown / Craigavon', 54.4200, -6.4500, 'Armagh'],

    // M2 / N2 corridor
    ['ASHBOURNE', 'Ashbourne', 53.5130, -6.3990, 'Meath'],
    ['SLANE', 'Slane', 53.7100, -6.5430, 'Meath'],
    ['ARDEE', 'Ardee', 53.8580, -6.5390, 'Louth'],
    ['CARRICKMACROSS', 'Carrickmacross', 53.9770, -6.7180, 'Monaghan'],
    ['CASTLEBLAYNEY', 'Castleblayney', 54.1200, -6.7370, 'Monaghan'],
    ['MONAGHAN', 'Monaghan', 54.2490, -6.9680, 'Monaghan'],

    // M3 / N3 corridor
    ['CLONEE', 'Clonee', 53.4180, -6.4400, 'Meath'],
    ['DUNSHAUGHLIN', 'Dunshaughlin', 53.5130, -6.5390, 'Meath'],
    ['NAVAN', 'Navan', 53.6530, -6.6810, 'Meath'],
    ['KELLS', 'Kells', 53.7270, -6.8790, 'Meath'],
    ['VIRGINIA', 'Virginia', 53.8340, -7.0790, 'Cavan'],
    ['CAVAN', 'Cavan', 53.9900, -7.3600, 'Cavan'],
    ['BELTURBET', 'Belturbet', 54.1000, -7.4500, 'Cavan'],

    // M4 / N4 corridor
    ['MAYNOOTH', 'Maynooth', 53.3810, -6.5910, 'Kildare'],
    ['KILCOCK', 'Kilcock', 53.4030, -6.6690, 'Kildare'],
    ['ENFIELD', 'Enfield', 53.4160, -6.8330, 'Meath'],
    ['KINNEGAD', 'Kinnegad', 53.4550, -7.1000, 'Westmeath'],
    ['MULLINGAR', 'Mullingar', 53.5260, -7.3390, 'Westmeath'],
    ['EDGEWORTHSTOWN', 'Edgeworthstown', 53.7040, -7.6110, 'Longford'],
    ['LONGFORD', 'Longford', 53.7270, -7.7930, 'Longford'],
    ['ROOSKEY', 'Rooskey', 53.8330, -7.9200, 'Roscommon'],
    ['CARRICK_SHANNON', 'Carrick-on-Shannon', 53.9470, -8.0930, 'Leitrim'],
    ['BOYLE', 'Boyle', 53.9740, -8.3000, 'Roscommon'],
    ['COLLOONEY', 'Collooney', 54.1870, -8.4900, 'Sligo'],
    ['SLIGO', 'Sligo', 54.2760, -8.4760, 'Sligo'],

    // M6 corridor
    ['ATHLONE', 'Athlone', 53.4230, -7.9410, 'Westmeath'],
    ['BALLINASLOE', 'Ballinasloe', 53.3300, -8.2200, 'Galway'],
    ['LOUGHREA', 'Loughrea', 53.1970, -8.5680, 'Galway'],
    ['ORANMORE', 'Oranmore', 53.2680, -8.9200, 'Galway'],
    ['GALWAY', 'Galway city', 53.2707, -9.0568, 'Galway'],

    // M7 / N7 corridor
    ['NAAS', 'Naas', 53.2200, -6.6590, 'Kildare'],
    ['NEWBRIDGE', 'Newbridge', 53.1800, -6.7980, 'Kildare'],
    ['KILDARE', 'Kildare town', 53.1570, -6.9090, 'Kildare'],
    ['MONASTEREVIN', 'Monasterevin', 53.1400, -7.0600, 'Kildare'],
    ['PORTLAOISE', 'Portlaoise', 53.0330, -7.3000, 'Laois'],
    ['BORRIS_OSSORY', 'Borris-in-Ossory', 52.9370, -7.6280, 'Laois'],
    ['ROSCREA', 'Roscrea', 52.9560, -7.7970, 'Tipperary'],
    ['NENAGH', 'Nenagh', 52.8640, -8.1960, 'Tipperary'],
    ['BIRDHILL', 'Birdhill', 52.7500, -8.4500, 'Tipperary'],
    ['LIMERICK', 'Limerick city', 52.6640, -8.6230, 'Limerick'],

    // M8 corridor
    ['DURROW', 'Durrow', 52.8420, -7.3960, 'Laois'],
    ['URLINGFORD', 'Urlingford', 52.7200, -7.5800, 'Kilkenny'],
    ['CASHEL', 'Cashel', 52.5150, -7.8850, 'Tipperary'],
    ['CAHIR', 'Cahir', 52.3760, -7.9250, 'Tipperary'],
    ['MITCHELSTOWN', 'Mitchelstown', 52.2650, -8.2670, 'Cork'],
    ['FERMOY', 'Fermoy', 52.1390, -8.2770, 'Cork'],
    ['WATERGRASSHILL', 'Watergrasshill', 52.0200, -8.3500, 'Cork'],
    ['DUNKETTLE', 'Dunkettle interchange', 51.9040, -8.3800, 'Cork'],
    ['CORK', 'Cork city', 51.8985, -8.4756, 'Cork'],
    ['BALLINCOLLIG', 'Ballincollig', 51.8880, -8.5900, 'Cork'],
    ['RINGASKIDDY', 'Ringaskiddy port', 51.8280, -8.3220, 'Cork'],

    // M9 corridor
    ['KILCULLEN', 'Kilcullen', 53.1300, -6.7480, 'Kildare'],
    ['CASTLEDERMOT', 'Castledermot', 52.9100, -6.8350, 'Kildare'],
    ['CARLOW', 'Carlow', 52.8360, -6.9260, 'Carlow'],
    ['GOWRAN', 'Gowran', 52.6300, -7.0700, 'Kilkenny'],
    ['KILKENNY', 'Kilkenny', 52.6540, -7.2520, 'Kilkenny'],
    ['MULLINAVAT', 'Mullinavat', 52.3800, -7.1700, 'Kilkenny'],
    ['WATERFORD', 'Waterford city', 52.2590, -7.1100, 'Waterford'],

    // M11 / N11 corridor
    ['BRAY', 'Bray', 53.2010, -6.1100, 'Wicklow'],
    ['KILMACANOGUE', 'Kilmacanogue', 53.1800, -6.1200, 'Wicklow'],
    ['WICKLOW', 'Wicklow town', 52.9800, -6.0500, 'Wicklow'],
    ['ARKLOW', 'Arklow', 52.7960, -6.1640, 'Wicklow'],
    ['GOREY', 'Gorey', 52.6760, -6.2940, 'Wexford'],
    ['ENNISCORTHY', 'Enniscorthy', 52.5020, -6.5660, 'Wexford'],
    ['WEXFORD', 'Wexford town', 52.3340, -6.4630, 'Wexford'],
    ['ROSSLARE', 'Rosslare Europort', 52.2470, -6.3390, 'Wexford'],
    ['NEW_ROSS', 'New Ross', 52.3960, -6.9430, 'Wexford'],

    // N25 / N24 south
    ['MIDLETON', 'Midleton', 51.9130, -8.1740, 'Cork'],
    ['YOUGHAL', 'Youghal', 51.9540, -7.8480, 'Cork'],
    ['DUNGARVAN', 'Dungarvan', 52.0900, -7.6200, 'Waterford'],
    ['TIPPERARY', 'Tipperary town', 52.4730, -8.1600, 'Tipperary'],
    ['CLONMEL', 'Clonmel', 52.3550, -7.7040, 'Tipperary'],
    ['CARRICK_SUIR', 'Carrick-on-Suir', 52.3480, -7.4150, 'Tipperary'],

    // M18 / N18 west
    ['SHANNON', 'Shannon', 52.7100, -8.8650, 'Clare'],
    ['ENNIS', 'Ennis', 52.8470, -8.9860, 'Clare'],
    ['GORT', 'Gort', 53.0660, -8.8210, 'Galway'],
    ['ENNISTYMON', 'Ennistymon', 52.9420, -9.2920, 'Clare'],

    // M17 / N17 north-west
    ['TUAM', 'Tuam', 53.5150, -8.8500, 'Galway'],
    ['CLAREMORRIS', 'Claremorris', 53.7220, -8.9950, 'Mayo'],
    ['KNOCK', 'Knock / Ireland West Airport', 53.7900, -8.9200, 'Mayo'],
    ['CHARLESTOWN', 'Charlestown', 53.9600, -8.7900, 'Mayo'],

    // N20 Cork - Limerick
    ['CHARLEVILLE', 'Charleville', 52.3540, -8.6820, 'Cork'],
    ['BUTTEVANT', 'Buttevant', 52.2300, -8.6700, 'Cork'],
    ['MALLOW', 'Mallow', 52.1390, -8.6390, 'Cork'],
    ['BLARNEY', 'Blarney', 51.9330, -8.5700, 'Cork'],

    // N21 / N69 / Kerry
    ['ADARE', 'Adare', 52.5640, -8.7890, 'Limerick'],
    ['NEWCASTLE_WEST', 'Newcastle West', 52.4490, -9.0570, 'Limerick'],
    ['ABBEYFEALE', 'Abbeyfeale', 52.3830, -9.3020, 'Limerick'],
    ['CASTLEISLAND', 'Castleisland', 52.2320, -9.4670, 'Kerry'],
    ['TRALEE', 'Tralee', 52.2700, -9.7000, 'Kerry'],
    ['FOYNES', 'Foynes port', 52.6100, -9.1100, 'Limerick'],
    ['TARBERT', 'Tarbert', 52.5730, -9.3720, 'Kerry'],
    ['LISTOWEL', 'Listowel', 52.4470, -9.4850, 'Kerry'],
    ['KILLARNEY', 'Killarney', 52.0590, -9.5070, 'Kerry'],
    ['KILLORGLIN', 'Killorglin', 52.1050, -9.7820, 'Kerry'],
    ['CAHERSIVEEN', 'Cahersiveen', 51.9460, -10.2230, 'Kerry'],
    ['WATERVILLE', 'Waterville', 51.8300, -10.1700, 'Kerry'],
    ['SNEEM', 'Sneem', 51.8380, -9.8960, 'Kerry'],
    ['DINGLE', 'Dingle', 52.1400, -10.2670, 'Kerry'],

    // N22 / N71 west Cork
    ['MACROOM', 'Macroom', 51.9040, -8.9640, 'Cork'],
    ['BALLYVOURNEY', 'Ballyvourney', 51.9400, -9.1600, 'Cork'],
    ['BANDON', 'Bandon', 51.7470, -8.7350, 'Cork'],
    ['CLONAKILTY', 'Clonakilty', 51.6220, -8.8850, 'Cork'],
    ['SKIBBEREEN', 'Skibbereen', 51.5500, -9.2670, 'Cork'],
    ['BANTRY', 'Bantry', 51.6800, -9.4530, 'Cork'],
    ['GLENGARRIFF', 'Glengarriff', 51.7500, -9.5500, 'Cork'],
    ['KENMARE', 'Kenmare', 51.8800, -9.5830, 'Kerry'],

    // N5 / N59 / N26 Mayo and Connemara
    ['STROKESTOWN', 'Strokestown', 53.7750, -8.1000, 'Roscommon'],
    ['TULSK', 'Tulsk', 53.7800, -8.2500, 'Roscommon'],
    ['BALLAGHADERREEN', 'Ballaghaderreen', 53.9000, -8.5800, 'Roscommon'],
    ['SWINFORD', 'Swinford', 53.9440, -8.9500, 'Mayo'],
    ['CASTLEBAR', 'Castlebar', 53.8560, -9.2980, 'Mayo'],
    ['WESTPORT', 'Westport', 53.8010, -9.5210, 'Mayo'],
    ['BALLINA', 'Ballina', 54.1150, -9.1550, 'Mayo'],
    ['FOXFORD', 'Foxford', 53.9800, -9.1200, 'Mayo'],
    ['BALLINROBE', 'Ballinrobe', 53.6270, -9.2270, 'Mayo'],
    ['HEADFORD', 'Headford', 53.4700, -9.1000, 'Galway'],
    ['OUGHTERARD', 'Oughterard', 53.4290, -9.3200, 'Galway'],
    ['LEENANE', 'Leenane', 53.5900, -9.7100, 'Galway'],
    ['CLIFDEN', 'Clifden', 53.4890, -10.0210, 'Galway'],

    // N15 / N56 Donegal
    ['BUNDORAN', 'Bundoran', 54.4780, -8.2800, 'Donegal'],
    ['BALLYSHANNON', 'Ballyshannon', 54.5010, -8.1900, 'Donegal'],
    ['DONEGAL_TOWN', 'Donegal town', 54.6540, -8.1110, 'Donegal'],
    ['KILLYBEGS', 'Killybegs', 54.6320, -8.4470, 'Donegal'],
    ['DUNGLOE', 'Dungloe', 54.9500, -8.3600, 'Donegal'],
    ['STRANORLAR', 'Stranorlar', 54.8000, -7.7700, 'Donegal'],
    ['LETTERKENNY', 'Letterkenny', 54.9500, -7.7340, 'Donegal'],
    ['LIFFORD', 'Lifford', 54.8320, -7.4790, 'Donegal'],
    ['BUNCRANA', 'Buncrana', 55.1350, -7.4600, 'Donegal'],

    // Midlands secondary
    ['TULLAMORE', 'Tullamore', 53.2740, -7.4900, 'Offaly'],
    ['BIRR', 'Birr', 53.0980, -7.9130, 'Offaly'],
    ['EDENDERRY', 'Edenderry', 53.3430, -7.0490, 'Offaly'],
    ['PORTARLINGTON', 'Portarlington', 53.1620, -7.1900, 'Laois'],
    ['ATHY', 'Athy', 52.9930, -6.9840, 'Kildare'],
    ['BALTINGLASS', 'Baltinglass', 52.9400, -6.7100, 'Wicklow'],
    ['BLESSINGTON', 'Blessington', 53.1690, -6.5330, 'Wicklow'],
    ['TULLOW', 'Tullow', 52.8010, -6.7370, 'Carlow'],
    ['THURLES', 'Thurles', 52.6810, -7.8110, 'Tipperary'],
    ['ROSCOMMON', 'Roscommon', 53.6280, -8.1890, 'Roscommon'],
    ['PORTUMNA', 'Portumna', 53.0900, -8.2200, 'Galway'],
  ];

  // ------------------------------------------------------------- classes ---
  /**
   * Per-class defaults. `laneM` is the usable running-lane width in one
   * direction, `kph` the realistic planning speed for a laden 44t artic
   * (junctions, villages and roundabouts already netted off - Irish goods
   * vehicles over 3.5t are limited to 80 km/h on every road class), and
   * `turn` a 0-3 bend-severity rating where 3 means hairpins or a mountain
   * pass. Individual edges override any of these.
   */
  const CLASSES = {
    motorway:  { label: 'Motorway',            laneM: 3.65, kph: 78, turn: 0 },
    dual:      { label: 'Dual carriageway',    laneM: 3.50, kph: 74, turn: 0 },
    primary:   { label: 'National primary',    laneM: 3.40, kph: 66, turn: 1 },
    secondary: { label: 'National secondary',  laneM: 3.00, kph: 56, turn: 1 },
    regional:  { label: 'Regional road',       laneM: 2.90, kph: 46, turn: 1 },
    local:     { label: 'Local road',          laneM: 2.50, kph: 34, turn: 2 },
    urban:     { label: 'Urban street',        laneM: 3.00, kph: 24, turn: 2 },
  };

  // --------------------------------------------------------------- tolls ---
  /**
   * Indicative single-passage toll rates in euro by axle class.
   * VERIFY against your eFlow / operator account before quoting a customer -
   * these move, and tag accounts are cheaper than video or unregistered rates.
   */
  const TOLLS = {
    ratesAsOf: '2025',
    plazas: {
      M50_WESTLINK: { name: 'M50 West-Link (barrier-free, eFlow)', car: 2.10, hgv2: 4.40, hgv3: 5.30, hgv4: 6.20,
        note: 'Barrier-free. Unregistered passages must be paid by 20:00 the next day or a penalty applies.' },
      M1_DROGHEDA:  { name: 'M1 Drogheda', car: 2.10, hgv2: 3.40, hgv3: 4.60, hgv4: 5.70 },
      M3:           { name: 'M3 (Clonee-Kells plazas)', car: 1.60, hgv2: 2.60, hgv3: 3.40, hgv4: 4.20 },
      M4:           { name: 'M4 Kilcock-Enfield', car: 3.00, hgv2: 4.10, hgv3: 5.10, hgv4: 6.10 },
      M6:           { name: 'M6 Galway-Ballinasloe', car: 2.30, hgv2: 3.60, hgv3: 4.50, hgv4: 5.30 },
      M7M8:         { name: 'M7 / M8 Portlaoise', car: 2.20, hgv2: 3.10, hgv3: 3.90, hgv4: 4.60 },
      N25_WATERFORD:{ name: 'N25 Waterford City Bypass', car: 1.90, hgv2: 3.10, hgv3: 3.90, hgv4: 4.60 },
      LIMERICK_TUNNEL:{ name: 'Limerick Tunnel', car: 2.20, hgv2: 4.10, hgv3: 5.10, hgv4: 6.00 },
      DUBLIN_PORT_TUNNEL: { name: 'Dublin Port Tunnel', car: 12.00, hgv2: 0, hgv3: 0, hgv4: 0,
        note: 'Goods vehicles over 3.5t travel free - the tunnel exists to keep them out of the city. Cars pay a peak-hour deterrent rate.' },
    },
  };

  // --------------------------------------------------------------- edges ---
  // E(from, to, road ref, class, overrides)
  const EDGE_ROWS = [];
  const E = (a, b, ref, cls, o) => { EDGE_ROWS.push(Object.assign({ a, b, ref, cls }, o || {})); };

  // --- Dublin: port, tunnel and the M50 orbital ---
  E('DUB_PORT', 'M50_J3', 'Dublin Port Tunnel (M50/M1)', 'motorway', {
    maxHeightM: 4.65, toll: 'DUBLIN_PORT_TUNNEL', tunnel: true, adrRestricted: true,
    note: 'Built for freight: HGVs over 3.5t travel free. Hard 4.65m height limit and restrictions on some ADR classes.' });
  E('DUB_PORT', 'DUB_CITY', 'R131 / East Wall Rd', 'urban', { cordon: 'DUBLIN_HGV', laneM: 3.2 });
  E('DUB_CITY', 'M50_J3', 'N1 / Drumcondra Rd', 'urban', { cordon: 'DUBLIN_HGV' });
  E('DUB_CITY', 'M50_J6', 'N3 / Navan Rd', 'urban', { cordon: 'DUBLIN_HGV' });
  E('DUB_CITY', 'M50_J9', 'N7 / Naas Rd', 'urban', { cordon: 'DUBLIN_HGV' });
  E('DUB_CITY', 'M50_J13', 'N11 / Stillorgan Rd', 'urban', { cordon: 'DUBLIN_HGV' });
  E('M50_J3', 'M50_J5', 'M50', 'motorway');
  E('M50_J5', 'M50_J6', 'M50', 'motorway');
  E('M50_J6', 'M50_J7', 'M50 West-Link', 'motorway', { toll: 'M50_WESTLINK' });
  E('M50_J7', 'M50_J9', 'M50', 'motorway');
  E('M50_J9', 'M50_J11', 'M50', 'motorway');
  E('M50_J11', 'M50_J13', 'M50', 'motorway');
  E('M50_J13', 'M50_J17', 'M50', 'motorway');
  E('M50_J11', 'TALLAGHT', 'R113', 'urban', { laneM: 3.2 });
  E('M50_J3', 'DUB_AIR', 'M1', 'motorway');

  // --- M1 / A1 to Belfast and the north ---
  E('DUB_AIR', 'SWORDS', 'M1', 'motorway');
  E('SWORDS', 'BALBRIGGAN', 'M1', 'motorway');
  E('BALBRIGGAN', 'DROGHEDA', 'M1', 'motorway', { toll: 'M1_DROGHEDA' });
  E('DROGHEDA', 'DUNLEER', 'M1', 'motorway');
  E('DUNLEER', 'DUNDALK', 'M1', 'motorway');
  E('DUNDALK', 'NEWRY', 'N1 / A1', 'dual', { border: true, note: 'Cross-border. NI runs mph; Irish and UK weight limits both allow 44t on six axles.' });
  E('NEWRY', 'BANBRIDGE', 'A1', 'dual');
  E('BANBRIDGE', 'LISBURN', 'A1', 'dual');
  E('LISBURN', 'BELFAST', 'M1', 'motorway');
  E('LISBURN', 'PORTADOWN', 'M1', 'motorway');
  E('PORTADOWN', 'DUNGANNON', 'M1', 'motorway');
  E('PORTADOWN', 'ARMAGH', 'A3', 'primary');
  E('ARMAGH', 'MONAGHAN', 'N12 / A3', 'primary', { border: true });
  E('BELFAST', 'ANTRIM', 'M2', 'motorway');
  E('BELFAST', 'LARNE', 'A8', 'dual');
  E('ANTRIM', 'BALLYMENA', 'M2 / A26', 'dual');
  E('BALLYMENA', 'COLERAINE', 'A26', 'primary');
  E('COLERAINE', 'DERRY', 'A37 / A2', 'primary');
  E('DUNGANNON', 'OMAGH', 'A4 / A5', 'primary');
  E('OMAGH', 'STRABANE', 'A5', 'primary');
  E('STRABANE', 'DERRY', 'A5', 'dual');
  E('STRABANE', 'LIFFORD', 'A38 / N14', 'regional', { border: true, laneM: 3.0 });
  E('DUNGANNON', 'ENNISKILLEN', 'A4', 'primary');
  E('AUGHNACLOY', 'OMAGH', 'A5', 'primary');
  E('ANTRIM', 'DUNGIVEN', 'A6', 'dual', { note: 'Upgraded A6 - the normal Belfast to Derry run.' });
  E('DUNGIVEN', 'DERRY', 'A6', 'dual');
  E('DUNGANNON', 'AUGHNACLOY', 'A5', 'primary');
  E('AUGHNACLOY', 'MONAGHAN', 'N2 / A5', 'primary', { border: true });
  E('ENNISKILLEN', 'BELTURBET', 'A509 / N3', 'secondary', { border: true });
  E('ENNISKILLEN', 'SLIGO', 'A4 / N16', 'secondary', { border: true, laneM: 2.95 });
  E('ENNISKILLEN', 'BALLYSHANNON', 'A46 / N3', 'secondary', { border: true, laneM: 2.90,
    note: 'Lakeside road along Lower Lough Erne - narrow in places but the shortest way into south Donegal from the midlands.' });

  // --- M2 / N2 ---
  E('M50_J5', 'ASHBOURNE', 'M2', 'motorway');
  E('ASHBOURNE', 'SLANE', 'M2 / N2', 'dual');
  E('SLANE', 'ARDEE', 'N2', 'primary');
  E('ARDEE', 'CARRICKMACROSS', 'N2', 'primary');
  E('CARRICKMACROSS', 'CASTLEBLAYNEY', 'N2', 'primary');
  E('CASTLEBLAYNEY', 'MONAGHAN', 'N2', 'primary');
  E('DROGHEDA', 'SLANE', 'N51', 'regional');
  E('SLANE', 'NAVAN', 'N51', 'regional');
  E('DUNDALK', 'CARRICKMACROSS', 'N53', 'secondary', { laneM: 2.9 });
  E('DUNDALK', 'ARDEE', 'N52', 'secondary');

  // --- M3 / N3 ---
  E('M50_J6', 'CLONEE', 'M3', 'motorway');
  E('CLONEE', 'DUNSHAUGHLIN', 'M3', 'motorway', { toll: 'M3' });
  E('DUNSHAUGHLIN', 'NAVAN', 'M3', 'motorway');
  E('NAVAN', 'KELLS', 'M3', 'motorway', { toll: 'M3' });
  E('KELLS', 'VIRGINIA', 'N3', 'primary');
  E('VIRGINIA', 'CAVAN', 'N3', 'primary');
  E('CAVAN', 'BELTURBET', 'N3', 'primary');
  E('CAVAN', 'MONAGHAN', 'N54', 'secondary', { laneM: 2.9 });
  E('KELLS', 'ARDEE', 'N52', 'secondary');
  E('KELLS', 'MULLINGAR', 'N52', 'secondary');

  // --- M4 / N4 to Sligo ---
  E('M50_J7', 'MAYNOOTH', 'M4', 'motorway');
  E('MAYNOOTH', 'KILCOCK', 'M4', 'motorway');
  E('KILCOCK', 'ENFIELD', 'M4', 'motorway', { toll: 'M4' });
  E('ENFIELD', 'KINNEGAD', 'M4', 'motorway');
  E('KINNEGAD', 'MULLINGAR', 'N4', 'dual');
  E('MULLINGAR', 'EDGEWORTHSTOWN', 'N4', 'dual');
  E('EDGEWORTHSTOWN', 'LONGFORD', 'N4', 'primary');
  E('LONGFORD', 'ROOSKEY', 'N4', 'primary');
  E('ROOSKEY', 'CARRICK_SHANNON', 'N4', 'primary');
  E('CARRICK_SHANNON', 'BOYLE', 'N4', 'primary');
  E('BOYLE', 'COLLOONEY', 'N4', 'primary');
  E('COLLOONEY', 'SLIGO', 'N4', 'dual');

  // --- M6 to Galway ---
  E('KINNEGAD', 'ATHLONE', 'M6', 'motorway');
  E('ATHLONE', 'BALLINASLOE', 'M6', 'motorway');
  E('BALLINASLOE', 'LOUGHREA', 'M6', 'motorway', { toll: 'M6' });
  E('LOUGHREA', 'ORANMORE', 'M6', 'motorway');
  E('ORANMORE', 'GALWAY', 'N6', 'dual');

  // --- M7 to Limerick ---
  E('M50_J9', 'NAAS', 'M7', 'motorway');
  E('NAAS', 'NEWBRIDGE', 'M7', 'motorway');
  E('NEWBRIDGE', 'KILDARE', 'M7', 'motorway');
  E('KILDARE', 'MONASTEREVIN', 'M7', 'motorway');
  E('MONASTEREVIN', 'PORTLAOISE', 'M7', 'motorway');
  E('PORTLAOISE', 'BORRIS_OSSORY', 'M7', 'motorway', { toll: 'M7M8' });
  E('BORRIS_OSSORY', 'ROSCREA', 'M7', 'motorway');
  E('ROSCREA', 'NENAGH', 'M7', 'motorway');
  E('NENAGH', 'BIRDHILL', 'M7', 'motorway');
  E('BIRDHILL', 'LIMERICK', 'M7 / N7', 'dual');

  // --- M8 to Cork ---
  E('PORTLAOISE', 'DURROW', 'M8', 'motorway', { toll: 'M7M8' });
  E('DURROW', 'URLINGFORD', 'M8', 'motorway');
  E('URLINGFORD', 'CASHEL', 'M8', 'motorway');
  E('CASHEL', 'CAHIR', 'M8', 'motorway');
  E('CAHIR', 'MITCHELSTOWN', 'M8', 'motorway');
  E('MITCHELSTOWN', 'FERMOY', 'M8', 'motorway');
  E('FERMOY', 'WATERGRASSHILL', 'M8', 'motorway');
  E('WATERGRASSHILL', 'DUNKETTLE', 'M8', 'motorway');
  E('DUNKETTLE', 'CORK', 'N8 / N40', 'dual');
  E('DUNKETTLE', 'RINGASKIDDY', 'N40 / N28', 'dual', {
    maxHeightM: 4.65, tunnel: true, adrRestricted: true,
    note: 'Jack Lynch Tunnel: 4.65m headroom and dangerous-goods restrictions. LPG and some ADR loads must use the signed surface diversion.' });
  E('CORK', 'BALLINCOLLIG', 'N22 / N40', 'dual');

  // --- M9 / N10 to Waterford ---
  E('NAAS', 'KILCULLEN', 'M9 / N7', 'motorway');
  E('KILCULLEN', 'CASTLEDERMOT', 'M9', 'motorway');
  E('CASTLEDERMOT', 'CARLOW', 'M9', 'motorway');
  E('CARLOW', 'GOWRAN', 'M9', 'motorway');
  E('GOWRAN', 'MULLINAVAT', 'M9', 'motorway');
  E('MULLINAVAT', 'WATERFORD', 'M9', 'motorway');
  E('GOWRAN', 'KILKENNY', 'N10', 'dual');
  E('KILKENNY', 'DURROW', 'N77', 'secondary');
  E('KILKENNY', 'CLONMEL', 'N76', 'secondary', { laneM: 2.9 });
  E('CARLOW', 'ATHY', 'R417', 'regional');
  E('ATHY', 'KILCULLEN', 'N78', 'secondary');
  E('CARLOW', 'TULLOW', 'N80', 'secondary');
  E('TULLOW', 'BALTINGLASS', 'N81', 'secondary', { laneM: 2.9 });
  E('BALTINGLASS', 'BLESSINGTON', 'N81', 'secondary', { laneM: 2.9, turn: 2 });
  E('BLESSINGTON', 'M50_J11', 'N81', 'regional', { turn: 2 });

  // --- M11 / N11 to Wexford and Rosslare ---
  E('M50_J17', 'BRAY', 'M11', 'motorway');
  E('BRAY', 'KILMACANOGUE', 'M11', 'motorway');
  E('KILMACANOGUE', 'WICKLOW', 'M11', 'motorway');
  E('WICKLOW', 'ARKLOW', 'M11', 'motorway');
  E('ARKLOW', 'GOREY', 'M11', 'motorway');
  E('GOREY', 'ENNISCORTHY', 'M11', 'motorway');
  E('ENNISCORTHY', 'WEXFORD', 'N11', 'dual');
  E('WEXFORD', 'ROSSLARE', 'N25', 'primary');
  E('ENNISCORTHY', 'NEW_ROSS', 'N30', 'secondary');

  // --- N25 / N24 south coast ---
  E('DUNKETTLE', 'MIDLETON', 'N25', 'dual');
  E('MIDLETON', 'YOUGHAL', 'N25', 'dual');
  E('YOUGHAL', 'DUNGARVAN', 'N25', 'primary');
  E('DUNGARVAN', 'WATERFORD', 'N25', 'primary', { toll: 'N25_WATERFORD',
    note: 'Toll is on the N25 Waterford City Bypass river crossing.' });
  E('WATERFORD', 'NEW_ROSS', 'N25', 'dual');
  E('NEW_ROSS', 'WEXFORD', 'N25', 'primary');
  E('LIMERICK', 'TIPPERARY', 'N24', 'primary');
  E('TIPPERARY', 'CAHIR', 'N24', 'primary');
  E('CAHIR', 'CLONMEL', 'N24', 'primary');
  E('CLONMEL', 'CARRICK_SUIR', 'N24', 'primary');
  E('CARRICK_SUIR', 'WATERFORD', 'N24', 'primary');
  E('CLONMEL', 'DUNGARVAN', 'R672', 'local', { laneM: 2.55, turn: 3, gradient: 3,
    note: 'Crosses the Knockmealdowns. Steep, narrow and unsuitable for long vehicles - use the N24/N25 instead.' });

  // --- M18 / N18 / N85 Shannon corridor ---
  E('LIMERICK', 'SHANNON', 'N18 Limerick Tunnel', 'dual', {
    maxHeightM: 4.65, tunnel: true, toll: 'LIMERICK_TUNNEL', adrRestricted: true,
    note: 'Limerick Tunnel: 4.65m headroom, tolled, and restricted for some ADR classes.' });
  E('SHANNON', 'ENNIS', 'M18', 'motorway');
  E('ENNIS', 'GORT', 'M18', 'motorway');
  E('GORT', 'ORANMORE', 'M18', 'motorway');
  E('ENNIS', 'ENNISTYMON', 'N85', 'secondary', { laneM: 2.9 });

  // --- M17 / N17 Galway to Sligo ---
  E('GALWAY', 'TUAM', 'M17', 'motorway');
  E('TUAM', 'CLAREMORRIS', 'N17', 'primary');
  E('CLAREMORRIS', 'KNOCK', 'N17', 'primary');
  E('KNOCK', 'CHARLESTOWN', 'N17', 'primary');
  E('CHARLESTOWN', 'COLLOONEY', 'N17', 'primary');

  // --- N20 Cork to Limerick ---
  E('LIMERICK', 'CHARLEVILLE', 'N20', 'primary');
  E('CHARLEVILLE', 'BUTTEVANT', 'N20', 'primary');
  E('BUTTEVANT', 'MALLOW', 'N20', 'primary');
  E('MALLOW', 'BLARNEY', 'N20', 'primary');
  E('BLARNEY', 'CORK', 'N20', 'dual');

  // --- N21 / N69 Limerick to Kerry ---
  E('LIMERICK', 'ADARE', 'N21', 'primary');
  E('ADARE', 'NEWCASTLE_WEST', 'N21', 'primary');
  E('NEWCASTLE_WEST', 'ABBEYFEALE', 'N21', 'primary');
  E('ABBEYFEALE', 'CASTLEISLAND', 'N21', 'primary');
  E('CASTLEISLAND', 'TRALEE', 'N21', 'dual');
  E('LIMERICK', 'FOYNES', 'N69', 'secondary', { laneM: 3.0 });
  E('FOYNES', 'TARBERT', 'N69', 'secondary', { laneM: 2.9 });
  E('TARBERT', 'LISTOWEL', 'N69', 'secondary', { laneM: 2.9 });
  E('LISTOWEL', 'TRALEE', 'N69', 'secondary');
  E('LISTOWEL', 'ABBEYFEALE', 'N21 link / R555', 'regional');

  // --- N22 / N72 Cork to Kerry ---
  E('BALLINCOLLIG', 'MACROOM', 'N22', 'dual');
  E('MACROOM', 'BALLYVOURNEY', 'N22', 'primary');
  E('BALLYVOURNEY', 'KILLARNEY', 'N22', 'primary', { turn: 2, gradient: 2,
    note: 'Derrynasaggart pass section - long climb, exposed in winter.' });
  E('KILLARNEY', 'TRALEE', 'N22', 'dual');
  E('KILLARNEY', 'MALLOW', 'N72', 'secondary', { laneM: 2.95 });
  E('MALLOW', 'FERMOY', 'N72', 'secondary');
  E('FERMOY', 'DUNGARVAN', 'N72', 'secondary', { laneM: 2.9, turn: 2 });

  // --- N71 west Cork and the Caha Pass ---
  E('CORK', 'BANDON', 'N71', 'primary');
  E('BANDON', 'CLONAKILTY', 'N71', 'primary');
  E('CLONAKILTY', 'SKIBBEREEN', 'N71', 'secondary', { laneM: 2.95 });
  E('SKIBBEREEN', 'BANTRY', 'N71', 'secondary', { laneM: 2.9, turn: 2 });
  E('BANTRY', 'GLENGARRIFF', 'N71', 'secondary', { laneM: 2.85, turn: 2 });
  E('GLENGARRIFF', 'KENMARE', 'N71', 'local', { laneM: 2.55, turn: 3, gradient: 3, maxHeightM: 4.20,
    note: 'Caha Pass: single-bore rock tunnels with restricted width and headroom, plus hairpins. Artics and high bodies must go round via Kenmare-Killarney or the N22.' });
  E('KENMARE', 'KILLARNEY', 'N71', 'local', { laneM: 2.60, turn: 3, gradient: 3,
    note: "Moll's Gap and Ladies View - continuous hairpins through the national park. Not a route for a 16.5m combination." });
  E('MACROOM', 'BANDON', 'R585', 'regional', { laneM: 2.8 });
  E('BANTRY', 'MACROOM', 'R584', 'local', { laneM: 2.6, turn: 3, gradient: 2,
    note: 'Keimaneigh pass. Narrow with rock cuttings.' });

  // --- N70 Ring of Kerry and the Dingle peninsula ---
  E('TRALEE', 'KILLORGLIN', 'N70', 'secondary', { laneM: 2.9 });
  E('KILLARNEY', 'KILLORGLIN', 'N72', 'secondary', { laneM: 2.95 });
  E('KILLORGLIN', 'CAHERSIVEEN', 'N70', 'local', { laneM: 2.60, turn: 3,
    note: 'Ring of Kerry. Narrow, walled and busy with tour coaches running anti-clockwise. Long vehicles strongly discouraged.' });
  E('CAHERSIVEEN', 'WATERVILLE', 'N70', 'local', { laneM: 2.55, turn: 3, note: 'Ring of Kerry - coastal, narrow, blind bends.' });
  E('WATERVILLE', 'SNEEM', 'N70', 'local', { laneM: 2.55, turn: 3, gradient: 2, note: 'Coomakista pass. Steep and very narrow.' });
  E('SNEEM', 'KENMARE', 'N70', 'local', { laneM: 2.60, turn: 3, note: 'Ring of Kerry - narrow with stone walls to the verge.' });
  E('TRALEE', 'DINGLE', 'N86', 'local', { laneM: 2.65, turn: 3, gradient: 2,
    note: 'The only sensible way into Dingle for a lorry, and it is still narrow. The Conor Pass (R560) is weight-restricted - do not send a truck over it.' });

  // --- N5 / N26 / N58 Mayo ---
  E('LONGFORD', 'STROKESTOWN', 'N5', 'primary');
  E('STROKESTOWN', 'TULSK', 'N5', 'primary');
  E('TULSK', 'BALLAGHADERREEN', 'N5', 'primary');
  E('BALLAGHADERREEN', 'CHARLESTOWN', 'N5', 'primary');
  E('CHARLESTOWN', 'SWINFORD', 'N5', 'primary');
  E('SWINFORD', 'CASTLEBAR', 'N5', 'primary');
  E('CASTLEBAR', 'WESTPORT', 'N5', 'primary');
  E('BALLINA', 'FOXFORD', 'N26', 'secondary');
  E('FOXFORD', 'SWINFORD', 'N26', 'secondary');
  E('CASTLEBAR', 'BALLINA', 'N58 / N59', 'secondary', { laneM: 2.9 });
  E('CASTLEBAR', 'CLAREMORRIS', 'N60', 'secondary');
  E('CLAREMORRIS', 'ROSCOMMON', 'N60', 'secondary', { laneM: 2.95 });
  E('CASTLEBAR', 'BALLINROBE', 'N84', 'secondary', { laneM: 2.9 });
  E('BALLINROBE', 'HEADFORD', 'N84', 'secondary', { laneM: 2.9 });
  E('HEADFORD', 'GALWAY', 'N84', 'secondary');

  // --- N59 Connemara ---
  E('GALWAY', 'OUGHTERARD', 'N59', 'secondary', { laneM: 2.9 });
  E('OUGHTERARD', 'CLIFDEN', 'N59', 'local', { laneM: 2.70, turn: 2,
    note: 'Connemara. Narrow with soft verges and bog on both sides - nowhere to pull in for an oncoming artic.' });
  E('CLIFDEN', 'LEENANE', 'N59', 'local', { laneM: 2.60, turn: 3, gradient: 2,
    note: 'Very narrow coastal and mountain section.' });
  E('LEENANE', 'WESTPORT', 'N59', 'local', { laneM: 2.70, turn: 2, gradient: 2 });

  // --- N15 / N56 / N13 Donegal ---
  E('SLIGO', 'BUNDORAN', 'N15', 'primary');
  E('BUNDORAN', 'BALLYSHANNON', 'N15', 'primary');
  E('BALLYSHANNON', 'DONEGAL_TOWN', 'N15', 'primary');
  E('DONEGAL_TOWN', 'STRANORLAR', 'N15', 'primary', { turn: 1, gradient: 2, note: 'Barnesmore Gap - exposed, first road to close in snow.' });
  E('STRANORLAR', 'LETTERKENNY', 'N13 / N15', 'dual');
  E('LETTERKENNY', 'LIFFORD', 'N14', 'primary');
  E('LETTERKENNY', 'DERRY', 'N13 / A2', 'primary', { border: true });
  E('LETTERKENNY', 'BUNCRANA', 'N13 / R238', 'regional');
  E('DONEGAL_TOWN', 'KILLYBEGS', 'N56', 'secondary', { laneM: 3.0 });
  E('KILLYBEGS', 'DUNGLOE', 'N56', 'local', { laneM: 2.60, turn: 3, gradient: 2,
    note: 'West Donegal coastal N56 - national number, local-road geometry.' });
  E('DUNGLOE', 'LETTERKENNY', 'N56', 'secondary', { laneM: 2.80, turn: 2 });

  // --- Midlands secondary web ---
  E('MULLINGAR', 'TULLAMORE', 'N52', 'secondary');
  E('TULLAMORE', 'BIRR', 'N52', 'secondary');
  E('BIRR', 'NENAGH', 'N52', 'secondary', { laneM: 2.9 });
  E('ATHLONE', 'BIRR', 'N62', 'secondary', { laneM: 2.9 });
  E('BIRR', 'ROSCREA', 'N62', 'secondary', { laneM: 2.9 });
  E('ATHLONE', 'ROSCOMMON', 'N61', 'secondary');
  E('ROSCOMMON', 'BOYLE', 'N61', 'secondary', { laneM: 2.9 });
  E('ROSCOMMON', 'LONGFORD', 'N63', 'secondary', { laneM: 2.9 });
  E('ATHLONE', 'LONGFORD', 'N55', 'secondary', { laneM: 2.9 });
  E('LONGFORD', 'CAVAN', 'N55', 'secondary', { laneM: 2.85 });
  E('PORTUMNA', 'LOUGHREA', 'N65', 'secondary', { laneM: 2.9 });
  E('PORTUMNA', 'BIRR', 'N52 / N65', 'secondary', { laneM: 2.9 });
  E('ENFIELD', 'EDENDERRY', 'R402', 'regional');
  E('EDENDERRY', 'TULLAMORE', 'R402', 'regional');
  E('PORTARLINGTON', 'PORTLAOISE', 'R419', 'regional');
  E('PORTARLINGTON', 'TULLAMORE', 'R420', 'regional');
  E('PORTLAOISE', 'ATHY', 'R426', 'regional');
  E('THURLES', 'CASHEL', 'R660', 'regional');
  E('THURLES', 'URLINGFORD', 'R689', 'regional');
  E('NENAGH', 'THURLES', 'R498', 'regional', { laneM: 2.85 });

  // --------------------------------------------------------------- zones ---
  /**
   * Time- and vehicle-restricted areas. These are published local-authority
   * schemes, not modelled guesses, and each is the kind of thing that turns a
   * planned 08:30 drop into a fine.
   */
  const ZONES = {
    DUBLIN_HGV: {
      name: 'Dublin City HGV Management Strategy cordon',
      rule: 'Goods vehicles with five or more axles are prohibited inside the canal cordon between 07:00 and 19:00, every day, without a permit.',
      minAxles: 5,
      banFrom: '07:00', banTo: '19:00',
      permit: 'Dublin City Council HGV permit (single-day or annual). Port-bound traffic uses the Dublin Port Tunnel instead.',
      // Approximate cordon: Royal Canal north, Grand Canal south, port to the east.
      bbox: { south: 53.3300, north: 53.3640, west: -6.3080, east: -6.2180 },
      severity: 'block',
    },
    CORK_CITY: {
      name: 'Cork city centre',
      rule: 'St Patrick\'s Street and the central spine have bus-gate and access-only restrictions; long combinations should stay on the N40 South Ring.',
      severity: 'advise',
    },
    GALWAY_CITY: {
      name: 'Galway city centre',
      rule: 'Severe congestion and medieval street widths inside the Bóthar na dTreabh ring. Time deliveries outside 07:30-09:30 and 16:00-18:30.',
      severity: 'advise',
    },
  };

  /**
   * Roads a lorry should simply never be sent down, kept as a reference card
   * rather than graph edges because no sane route uses them. All carry real
   * signed restrictions or are well known to the emergency services for
   * recovering stuck HGVs.
   */
  const KNOWN_TRAPS = [
    { road: 'R560 Conor Pass, Co. Kerry', why: 'Signed weight and width restriction, single track with a sheer drop. Cars and small vans only.' },
    { road: 'N71 Caha Pass tunnels, Glengarriff-Kenmare', why: 'Unlit single-bore rock tunnels with restricted width and headroom.' },
    { road: 'R574 Healy Pass, Beara', why: 'Hairpins with no turning space. Recovery means a crane.' },
    { road: 'R115 Sally Gap / Military Road, Co. Wicklow', why: 'Unfenced bog road, no width, no turning, closes in snow.' },
    { road: 'R563 / Gap of Dunloe, Killarney', why: 'Effectively a laneway with jaunting-car traffic.' },
    { road: 'Killarney and Kenmare town centres', why: 'Tight one-way systems built before articulated lorries existed.' },
    { road: 'Dublin quays inside the canals, 07:00-19:00', why: 'Five-axle HGV ban - use the Port Tunnel.' },
  ];

  // ----------------------------------------------------------- geometry ---
  const R_EARTH_KM = 6371.0088;
  const rad = d => d * Math.PI / 180;

  function haversineKm(aLat, aLon, bLat, bLon) {
    const dLat = rad(bLat - aLat), dLon = rad(bLon - aLon);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /**
   * Great-circle distance understates road length. These multipliers convert
   * one to the other and are calibrated in tests/network.test.js against
   * published inter-city road distances.
   */
  const SINUOSITY = {
    motorway: 1.07, dual: 1.09, primary: 1.13,
    secondary: 1.18, regional: 1.24, local: 1.34, urban: 1.30,
  };

  // ------------------------------------------------------------- build ---
  const NODES = new Map();
  for (const [id, name, lat, lon, county] of NODE_ROWS) {
    NODES.set(id, { id, name, lat, lon, county });
  }

  const EDGES = EDGE_ROWS.map((row, i) => {
    const from = NODES.get(row.a), to = NODES.get(row.b);
    if (!from) throw new Error(`edge ${i} (${row.ref}) references unknown node ${row.a}`);
    if (!to) throw new Error(`edge ${i} (${row.ref}) references unknown node ${row.b}`);
    const base = CLASSES[row.cls];
    if (!base) throw new Error(`edge ${i} (${row.ref}) has unknown class ${row.cls}`);
    const straight = haversineKm(from.lat, from.lon, to.lat, to.lon);
    const sinuosity = row.sinuosity || SINUOSITY[row.cls];
    return {
      id: i,
      a: row.a, b: row.b, ref: row.ref, cls: row.cls, clsLabel: base.label,
      km: Math.round(straight * sinuosity * 10) / 10,
      laneM: row.laneM != null ? row.laneM : base.laneM,
      baseKph: row.kph != null ? row.kph : base.kph,
      turn: row.turn != null ? row.turn : base.turn,
      gradient: row.gradient || 0,
      maxHeightM: row.maxHeightM || null,
      maxWeightT: row.maxWeightT || null,
      maxLengthM: row.maxLengthM || null,
      toll: row.toll || null,
      tunnel: !!row.tunnel,
      adrRestricted: !!row.adrRestricted,
      border: !!row.border,
      cordon: row.cordon || null,
      note: row.note || '',
    };
  });

  /** id -> [{edge, to}] in both directions. */
  const ADJ = new Map();
  for (const id of NODES.keys()) ADJ.set(id, []);
  for (const e of EDGES) {
    ADJ.get(e.a).push({ edge: e, to: e.b });
    ADJ.get(e.b).push({ edge: e, to: e.a });
  }

  // ------------------------------------------------------- suitability ---
  /** Lane width a vehicle wants: its own width plus mirrors and passing room. */
  const widthNeedM = v => v.widthM + 0.35;

  /**
   * Can this vehicle use this edge, and how comfortably?
   *
   * Hard blocks come from signed limits (headroom, weight, length) and from
   * statutory bans. Everything else is a geometry score: how far the lane is
   * below what the vehicle wants, plus how badly its length is punished by the
   * bends. A score of 5 is where experienced operators stop sending artics.
   */
  function assessEdge(edge, v, ctx) {
    ctx = ctx || {};
    const reasons = [];
    let blocked = false;

    if (edge.maxHeightM != null && v.heightM > edge.maxHeightM) {
      blocked = true;
      reasons.push({ kind: 'height', severity: 'block',
        text: `${v.heightM.toFixed(2)}m travelling height exceeds the ${edge.maxHeightM.toFixed(2)}m limit on ${edge.ref}.` });
    }
    if (edge.maxWeightT != null && v.gvwT > edge.maxWeightT) {
      blocked = true;
      reasons.push({ kind: 'weight', severity: 'block',
        text: `${v.gvwT}t exceeds the ${edge.maxWeightT}t limit on ${edge.ref}.` });
    }
    if (edge.maxLengthM != null && v.lengthM > edge.maxLengthM) {
      blocked = true;
      reasons.push({ kind: 'length', severity: 'block',
        text: `${v.lengthM}m exceeds the ${edge.maxLengthM}m limit on ${edge.ref}.` });
    }

    let score = 0;
    const need = widthNeedM(v);
    if (edge.laneM < need) score += (need - edge.laneM) * 10;
    if (edge.turn >= 2 && v.lengthM > 10) score += (edge.turn - 1) * (v.lengthM - 10) * 0.5;
    if (edge.gradient >= 3 && v.gvwT > 26) score += 2;

    if (score >= 5) {
      blocked = true;
      reasons.push({ kind: 'geometry', severity: 'block',
        text: `${edge.ref} is too tight for a ${v.lengthM}m ${v.form === 'artic' ? 'articulated combination' : 'vehicle'} ` +
          `(${edge.laneM.toFixed(2)}m running lane${edge.turn >= 2 ? ', severe bends' : ''}).` });
    } else if (score >= 2) {
      reasons.push({ kind: 'geometry', severity: 'caution',
        text: `${edge.ref} is passable but tight: ${edge.laneM.toFixed(2)}m lane${edge.turn >= 2 ? ' with tight bends' : ''}. Expect slow running and oncoming-traffic delays.` });
    }

    if (edge.gradient >= 2 && v.gvwT >= 26) {
      reasons.push({ kind: 'gradient', severity: 'note',
        text: `Sustained climb on ${edge.ref} - allow for a laden loss of speed and check winter conditions.` });
    }
    if (edge.adrRestricted && ctx.adr) {
      blocked = true;
      reasons.push({ kind: 'adr', severity: 'block',
        text: `${edge.ref} restricts dangerous goods. Take the signed surface diversion.` });
    }
    if (edge.tunnel && !ctx.adr) {
      reasons.push({ kind: 'tunnel', severity: 'note',
        text: `${edge.ref} is a tunnel - ${edge.maxHeightM ? edge.maxHeightM.toFixed(2) + 'm headroom, ' : ''}restricted for some ADR classes.` });
    }
    if (edge.border) {
      reasons.push({ kind: 'border', severity: 'note',
        text: 'Crosses the border. Speed limits change units and customs paperwork may apply to the load.' });
    }
    if (edge.note) reasons.push({ kind: 'local', severity: 'note', text: edge.note });

    return { blocked, score: Math.round(score * 10) / 10, reasons };
  }

  /** Planning speed for this vehicle on this edge, in km/h. */
  function edgeSpeedKph(edge, v) {
    let kph = edge.baseKph;
    if (!v.isHGV) {
      // A van is not held to the 80 km/h goods-vehicle limit.
      kph *= (edge.cls === 'motorway' || edge.cls === 'dual') ? 1.22 : 1.10;
    }
    kph *= 1 - 0.08 * edge.turn;
    kph *= 1 - 0.05 * edge.gradient;
    const need = widthNeedM(v);
    if (edge.laneM < need) kph *= 1 - Math.min(0.35, (need - edge.laneM) * 0.5);
    if (v.lengthM > 12 && edge.turn >= 2) kph *= 0.88;
    return Math.max(18, Math.round(kph));
  }

  function tollFor(edge, v) {
    if (!edge.toll) return 0;
    const plaza = TOLLS.plazas[edge.toll];
    if (!plaza) return 0;
    const rate = plaza[v.tollClass];
    return typeof rate === 'number' ? rate : 0;
  }

  function inZone(zone, lat, lon) {
    const b = zone.bbox;
    return !!b && lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
  }

  /** The k network nodes closest to a point, nearest first. */
  function nearestNodes(lat, lon, k) {
    const out = [];
    for (const n of NODES.values()) out.push({ node: n, km: haversineKm(lat, lon, n.lat, n.lon) });
    out.sort((x, y) => x.km - y.km);
    return out.slice(0, k || 1);
  }

  return {
    NODES, EDGES, ADJ, CLASSES, TOLLS, ZONES, KNOWN_TRAPS, SINUOSITY,
    haversineKm, assessEdge, edgeSpeedKph, tollFor, nearestNodes, inZone, widthNeedM,
    node: id => NODES.get(id) || null,
  };
});
