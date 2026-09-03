/**
 * Transport codes: the vehicle profiles a schedule row can be booked against.
 *
 * Dimensions and weights follow the Irish construction & use limits
 * (SI 5/2003 as amended) and normal operator practice. Every figure a route
 * decision depends on lives here, so a fleet with different kit only has to
 * edit this file (or add a custom code in the UI).
 *
 * Weight limits used below:
 *   2-axle rigid 18t · 3-axle rigid 26t · 4-axle rigid 32t
 *   5-axle artic 40t · 6-axle artic 44t
 * Length: rigid 12.0m · artic 16.5m · drawbar 18.75m. Width 2.55m (2.60m fridge).
 * Ireland sets no general height limit, but 4.65m is the standard structure
 * clearance and anything over ~4.2m starts meeting signed bridges.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Vehicles = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * body      what it is, in yard language
   * form      'artic' | 'rigid' | 'van' - drives swept-path and manoeuvring rules
   * axles     total axles on the combination; 5+ triggers the Dublin HGV cordon ban
   * lengthM   overall length when travelling
   * widthM    overall width excluding mirrors
   * heightM   travelling height (silo bodies travel laid down)
   * gvwT      gross vehicle/combination weight when fully freighted, tonnes
   * tareT     unladen weight - payload = gvwT - tareT
   * turnM     kerb-to-kerb turning radius; the number that decides tight estates
   * minLaneM  carriageway width below which the vehicle cannot pass safely
   * lPer100   diesel burn, litres per 100 km, laden
   * tachograph EU 561/2006 drivers' hours apply (goods vehicles over 3.5t)
   * craned    carries its own offload crane, so no site telehandler needed
   */
  const PROFILES = [
    {
      code: 'ART-44', name: 'Artic 44t curtainsider',
      body: '3-axle tractor + tri-axle curtainsider', form: 'artic',
      axles: 6, lengthM: 16.5, widthM: 2.55, heightM: 4.20, gvwT: 44, tareT: 15.5,
      turnM: 12.5, minLaneM: 3.0, lPer100: 32, tachograph: true, craned: false,
      notes: 'Trunking unit. Needs a turning circle and firm hardstanding at the drop.',
    },
    {
      code: 'ART-SILO', name: 'Artic silo carrier (crane)',
      body: 'Tractor + extendable silo trailer, mounted crane', form: 'artic',
      axles: 6, lengthM: 16.5, widthM: 2.55, heightM: 4.50, gvwT: 44, tareT: 19.0,
      turnM: 13.5, minLaneM: 3.2, lPer100: 36, tachograph: true, craned: true,
      notes: 'Silo travels laid down at 4.50m. Erecting needs level ground and ~8m overhead clear of lines.',
    },
    {
      code: 'ART-TIP', name: 'Artic bulk tipper / blower',
      body: 'Tractor + tipping bulk trailer', form: 'artic',
      axles: 6, lengthM: 16.5, widthM: 2.55, heightM: 3.95, gvwT: 44, tareT: 15.0,
      turnM: 12.5, minLaneM: 3.0, lPer100: 34, tachograph: true, craned: false,
      notes: 'Tipping needs overhead clearance and a level, stable discharge point.',
    },
    {
      code: 'RIG-32', name: 'Rigid 32t 8x4',
      body: '4-axle rigid flatbed / tipper', form: 'rigid',
      axles: 4, lengthM: 10.0, widthM: 2.55, heightM: 4.00, gvwT: 32, tareT: 12.0,
      turnM: 9.5, minLaneM: 2.9, lPer100: 28, tachograph: true, craned: false,
      notes: 'Good compromise: near-artic payload, gets into most regional-road sites.',
    },
    {
      code: 'RIG-26H', name: 'Rigid 26t + HIAB',
      body: '3-axle rigid flatbed with lorry-mounted crane', form: 'rigid',
      axles: 3, lengthM: 9.6, widthM: 2.55, heightM: 4.00, gvwT: 26, tareT: 12.5,
      turnM: 8.8, minLaneM: 2.8, lPer100: 25, tachograph: true, craned: true,
      notes: 'Self-offloading site unit, and under the 5-axle Dublin cordon threshold.',
    },
    {
      code: 'RIG-18', name: 'Rigid 18t 2-axle',
      body: '2-axle rigid curtainsider', form: 'rigid',
      axles: 2, lengthM: 8.5, widthM: 2.50, heightM: 3.90, gvwT: 18, tareT: 7.5,
      turnM: 7.6, minLaneM: 2.7, lPer100: 21, tachograph: true, craned: false,
      notes: 'Reaches sites an artic cannot. Watch the payload before promising a full load.',
    },
    {
      code: 'RIG-12', name: 'Rigid 12t',
      body: '2-axle rigid box / dropside', form: 'rigid',
      axles: 2, lengthM: 7.5, widthM: 2.40, heightM: 3.60, gvwT: 12, tareT: 5.5,
      turnM: 7.0, minLaneM: 2.6, lPer100: 18, tachograph: true, craned: false,
      notes: 'Town-centre and tight-estate work.',
    },
    {
      code: 'VAN-35', name: 'Van 3.5t',
      body: 'LCV panel van / dropside', form: 'van',
      axles: 2, lengthM: 6.0, widthM: 2.10, heightM: 2.80, gvwT: 3.5, tareT: 2.2,
      turnM: 6.2, minLaneM: 2.3, lPer100: 11, tachograph: false, craned: false,
      notes: 'Not an HGV: no tachograph, no HGV bans, normal speed limits.',
    },
  ];

  const BY_CODE = new Map(PROFILES.map(p => [p.code, p]));

  /** Goods vehicles over 3.5t are limited to 80 km/h on every Irish road class. */
  const HGV_SPEED_CAP_KPH = 80;

  /** Tolls in Ireland are priced by axle count; these are the operator classes. */
  function tollClass(v) {
    if (v.gvwT <= 3.5) return 'car';
    if (v.axles <= 2) return 'hgv2';
    if (v.axles === 3) return 'hgv3';
    return 'hgv4';           // 4 or more axles - the artic rate
  }

  /** Payload in tonnes once the vehicle's own weight is off the bridge. */
  const payloadT = v => Math.round((v.gvwT - v.tareT) * 10) / 10;

  function get(code) {
    return BY_CODE.get(String(code || '').trim().toUpperCase()) || null;
  }

  /**
   * Builds a usable profile from a code, tolerating a custom one-off vehicle.
   * `overrides` lets a planner row say "same as ART-44 but 4.9m high today".
   */
  function resolve(code, overrides) {
    const base = get(code);
    if (!base && !overrides) return null;
    const merged = Object.assign({}, base || PROFILES[0], overrides || {});
    if (!base) merged.code = String(code || 'CUSTOM').toUpperCase();
    merged.tollClass = tollClass(merged);
    merged.payloadT = payloadT(merged);
    merged.isHGV = merged.gvwT > 3.5;
    return merged;
  }

  return { PROFILES, HGV_SPEED_CAP_KPH, get, resolve, tollClass, payloadT };
});
