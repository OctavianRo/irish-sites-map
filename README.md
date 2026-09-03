# Irish sites map + HGV route & driver planner

Two static pages, no build step and no server:

| Page | What it is |
| --- | --- |
| [`index.html`](index.html) | Map of 3,735 live Irish planning permissions with substantial blockwork or render — the mortar-silo prospect list. |
| [`fleet.html`](fleet.html) | Haulage planner: driver schedules by transport code, artic-vs-rigid road suitability, EU drivers' hours, and a recommended route. |

---

## The planner

Built for the question a logistics operator actually asks: *I have this driver,
this truck and these drops — can it be done, and which way should they go?*

**Enter a schedule.** Driver, date, transport code, start time, and a list of
stops. Stops come from the 3,735 construction sites, from any town on the
network, from raw coordinates, or from a click on the map. Runs are kept in
`localStorage`, so several drivers' days sit side by side.

**Get a verdict.** Every leg is routed for *that specific vehicle*. Roads it
cannot use are removed from the graph rather than warned about, so a route that
comes back is a route that can be driven.

- **Cleared to run** — roads suit the vehicle and the day is inside drivers' hours.
- **Runnable, with cautions** — passable, but with sections that are tight for
  this combination.
- **Breaches drivers' hours** — roads fine, day illegal.
- **Not drivable as booked** — and it names the largest unit that *can* do it,
  with one click to reassign.

**Compare routes.** Four objectives are searched — fastest, toll-light,
trunk-road, and balanced — deduplicated and ranked on all-in cost plus a
penalty for tight sections. The recommendation states its trade-off in words:
*"saves €20.41 for 1 min more driving."*

**Optimise the drop order.** Nearest-neighbour then 2-opt over real routed
times, not straight-line distance. The depot stays first, and the yard stays
last if the day returns to it.

**Cost the day.** Diesel at your l/100km and pump price, running cost per km,
driver hours, and tolls by axle class — total and per drop.

### What it knows about the roads

| | |
| --- | --- |
| Network | 174 junctions and towns, 238 sections of motorway, national, and the regional roads that matter, across Ireland and Northern Ireland. |
| Physical limits | Signed headroom, weight and length limits; running-lane width and bend severity per section. |
| Legal limits | The Dublin City five-axle HGV cordon (07:00–19:00), dangerous-goods restrictions in the Dublin Port, Jack Lynch and Limerick tunnels, and cross-border notes. |
| Money | Toll plazas priced by axle class — including the fact that HGVs use the Dublin Port Tunnel free. |
| Hours | EU 561/2006: 4h30 continuous driving, 45-minute break, 9h/10h daily driving, 13h/15h duty windows. |

Suitability is decided by a geometry score, not by road number: how far the
running lane falls short of what the vehicle needs, plus how badly its length is
punished by the bends. A 16.5m artic is barred from the Caha Pass, the Ring of
Kerry, the Connemara N59 and the west Donegal N56 — the roads hauliers really do
avoid — while a 26t rigid gets a caution and a van passes freely.

Loading and unloading is recorded as **other work**, not as a break. A
45-minute tip does not reset the 4h30 driving clock, and this planner will not
pretend otherwise.

### What it does not know

The network stops at the trunk roads. The last few kilometres to a gate are
**measured and risk-rated, not routed** — the planner tells you how much
unmodelled local road stands between the truck and the site, and says plainly
when the honest answer is "survey it or send a smaller unit". It also has no
knowledge of individual bridge weight plates, roadworks, live traffic, or
site hardstanding and overhead lines.

Distances come from great-circle lengths scaled per road class, pinned by tests
against published inter-city figures. Expect planning accuracy of roughly ±10%,
not satnav precision. Toll rates are indicative — check them against your eFlow
account.

---

## Layout

```
index.html                map of planning permissions (self-contained)
fleet.html                planner UI
assets/
  network.js              road graph, restrictions, zones, tolls
  vehicles.js             transport codes and vehicle profiles
  planner.js              routing, drivers' hours, costing, optimiser
  ui.js                   planner front end
  planner.css
  sites-index.js          generated destination index
tools/build-sites-index.js  regenerates sites-index.js from index.html
tests/                    47 tests over the network and the planner
```

`network.js`, `vehicles.js` and `planner.js` have no DOM dependencies and run
unchanged under node, which is how they are tested.

## Development

```sh
npm test              # 47 tests: geometry, suitability, hours, costing, optimiser
npm run build:sites   # regenerate assets/sites-index.js after index.html changes
npm run serve         # http://localhost:8080
```

The corridor tests pin the modelled network against published road distances
(Dublin–Cork 256 km, Dublin–Galway 208 km, Belfast–Derry 114 km and eighteen
more) at a 12% tolerance. Adding or retuning a road that pushes a corridor out
of range fails the build, which is the point.

Leaflet is loaded from a CDN. If it cannot load, the map switches itself off and
every route, warning and timing still works.

## Adding your own fleet

Edit `assets/vehicles.js` — one object per transport code, with the dimensions,
weights and fuel burn your kit actually has. Everything downstream (suitability,
tolls, drivers' hours, cost) keys off those numbers. A one-off vehicle can also
be passed as `vehicleOverrides` on a schedule without touching the file.
