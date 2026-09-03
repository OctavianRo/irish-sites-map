# Delivery route planner (Ireland) + construction-site map

Two static pages, no build step and no server:

| Page | What it is |
| --- | --- |
| [`fleet.html`](fleet.html) | **Delivery route planner.** Load an order book of Eircode deliveries, respect vehicle weight limits and road suitability, and get an optimised, legal route plan per driver. |
| [`index.html`](index.html) | Map of 3,735 live Irish planning permissions with substantial blockwork or render — one source of delivery destinations. |

---

## The planner

The question it answers: *here is today's order book and here is my fleet — who
carries what, in what order, by which roads, and what falls off the end?*

### 1. Load the orders

Paste, drop or upload a CSV. Headers are matched loosely so most order-system
exports import as they are:

```
Order Ref,Customer,Eircode,Weight (kg),Order Date,Due By,Notes
SO-10412,Kelly Builders Providers,W91 P6DF,8400,2026-08-28,2026-09-04,Forklift on site
```

Comma, tab, semicolon and pipe files all work, with or without a header row.
Weights are read in kilos or tonnes — from the header where it says, otherwise
from the size of the numbers — and the assumption is reported back rather than
buried. Dates are read day-first. **Every input line comes back either as a
delivery or as a rejected line with its number and the reason.** Nothing is
silently dropped.

Recognised columns: Eircode · weight · order reference · customer · order date ·
due by · offload minutes · latitude/longitude · notes.

### 2. Where an Eircode actually puts a drop

An Eircode is a three-character **routing key** naming a post town, then a
four-character **unique identifier** for one letterbox. The identifier is
deliberately non-geographic — no arithmetic turns it into a coordinate, and
address-level lookup needs the licensed Eircode Address Database.

So this planner resolves the part that is public: **all 139 routing keys** are
built in with their post town, county and coordinates. A drop given only as an
Eircode is placed at the centre of its routing area — the right town, not the
right gate — which is the correct resolution for strategic routing, and is
labelled as such on every drop (amber dot) and in the import summary.

**If your export carries latitude and longitude, include them.** They override
the Eircode and are shown with a green dot.

Codes are validated on import: the identifier never contains B, I, O, Q, S, U or
Z, so a mistyped letter is rejected rather than silently mislocated.

### 3. Weight limits

Two ceilings, and the lower one binds:

- **Per vehicle** — plated payload, gross weight less tare.
- **Per body type** — a fleet rule such as *nothing over 28 t on a rigid*,
  editable on the Fleet tab, plus a per-vehicle override.

Irish gross limits (2-axle rigid 18 t, 3-axle 26 t, 4-axle 32 t, 6-axle artic
44 t) mean a 4-axle rigid's payload lands near 20 t, so a 28 t rigid rule is not
usually the binding constraint — but it is applied, and if you raise a vehicle's
own capacity past what its axle count can legally be plated for, the Fleet tab
says so instead of quietly accepting it.

### 4. The plan

Loads are grown one drop at a time: seed with the most urgent order the vehicle
can serve, then repeatedly add whichever remaining order is cheapest to slot in,
discounted by how overdue it is. Then a second pass tries every leftover in
every load at every position, and a third relocates drops between trucks where
that cuts total driving.

Constraints, in the order they bite:

1. **Can this vehicle legally reach the drop?** Roads it cannot use are removed
   from the graph, not warned about — so a route that comes back is drivable.
2. **Does the weight fit?** Per run, not per day.
3. **Does the day still fit?** EU 561/2006 drivers' hours and the duty window.

A vehicle can return to the depot, reload and run again; the reload is modelled
as a stop in the same schedule, so breaks, the duty window and the running clock
all come out of one calculation.

Orders are prioritised overdue first, then by due date, then oldest order date —
converted into "minutes of detour we would accept to take it today", so an
overdue drop can pull a load off the most efficient line.

Anything not loaded is listed with a specific reason: heavier than the whole
fleet, unreachable by any vehicle (naming one that could), out of payload, or
out of hours.

### 5. What comes out

Per load: the runs and their drop order, weight against capacity, the timeline
with statutory breaks inserted at the 4h30 mark, the roads used with a
suited/tight verdict for that vehicle, the final-mile risk at each drop, and the
cost — diesel, running, driver, tolls, and cost per tonne. Export the whole plan
as CSV, including the not-loaded lines.

### What it knows about the roads

| | |
| --- | --- |
| Network | 174 junctions and towns, 238 sections of motorway, national, and the regional roads that matter, across Ireland and Northern Ireland. |
| Physical limits | Signed headroom, weight and length limits; running-lane width and bend severity per section. |
| Legal limits | The Dublin City five-axle HGV cordon (07:00–19:00, checked on departure as well as arrival), dangerous-goods restrictions in the Dublin Port, Jack Lynch and Limerick tunnels, and cross-border notes. |
| Money | Toll plazas priced by axle class — including HGVs using the Dublin Port Tunnel free. |
| Hours | EU 561/2006: 4h30 continuous driving, 45-minute break, 9h/10h daily driving, 13h/15h duty windows. |

Suitability is decided by a geometry score, not by road number: how far the
running lane falls short of what the vehicle needs, plus how badly its length is
punished by the bends. A 16.5 m artic is barred from the Caha Pass, the Ring of
Kerry, the Connemara N59 and the west Donegal N56 — the roads hauliers really do
avoid — while a 26 t rigid gets a caution and a van passes freely.

Loading and unloading is recorded as **other work**, not as a break. A
45-minute tip does not reset the 4h30 driving clock, and this planner will not
pretend otherwise.

### What it does not know

The network stops at the trunk roads. The last few kilometres to a gate are
**measured and risk-rated, not routed** — the planner says how much unmodelled
local road stands between the truck and the site, and says plainly when the
honest answer is "survey it or send a smaller unit". It also has no knowledge of
individual bridge weight plates, roadworks, live traffic, delivery time windows,
or site hardstanding.

Distances come from great-circle lengths scaled per road class, pinned by tests
against published inter-city figures. Expect planning accuracy of roughly ±10%,
not satnav precision. Toll rates are indicative — check them against your eFlow
account.

---

## Layout

```
fleet.html                planner UI
index.html                map of planning permissions (self-contained)
assets/
  eircode.js              all 139 routing keys, Eircode parsing and location
  orders.js               CSV intake, column detection, unit and date handling
  network.js              road graph, restrictions, zones, tolls
  vehicles.js             transport codes, payload and load caps
  planner.js              routing, drivers' hours, costing, load building
  ui.js                   planner front end
  planner.css
  sites-index.js          generated destination index
tools/build-sites-index.js  regenerates sites-index.js from index.html
tests/                    83 tests
```

`eircode.js`, `orders.js`, `network.js`, `vehicles.js` and `planner.js` have no
DOM dependencies and run unchanged under node, which is how they are tested.

## Development

```sh
npm test              # 83 tests
npm run build:sites   # regenerate assets/sites-index.js after index.html changes
npm run serve         # http://localhost:8080
```

The suite covers: all 139 routing keys and the Eircode alphabet; CSV intake
across delimiters, units and date formats; road suitability per vehicle; EU
drivers' hours; and the day-plan invariants — no order loaded twice, no run over
capacity, no day over its duty window, and every order either loaded or
explained. Corridor tests pin the modelled network against 21 published
inter-city distances (Dublin–Cork 256 km, Dublin–Galway 208 km, Belfast–Derry
114 km …) at a 12% tolerance, so a road change that distorts the map fails the
build.

Leaflet is loaded from a CDN. If it cannot load, the map switches itself off and
every load, route and warning still works.

## Adapting it to your operation

- **Fleet** — edit `assets/vehicles.js`, one object per transport code, with the
  dimensions, weights and fuel burn your kit actually has. Everything downstream
  keys off those numbers.
- **Load rules** — the body-type ceilings live on the Fleet tab and persist in
  the browser.
- **Roads** — `assets/network.js` holds the graph; adding a section means one
  line, and the corridor tests will tell you if it distorts anything.
