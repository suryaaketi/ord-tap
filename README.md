# ORD Tap

An ENGR 408 student prototype of NFC wayfinding at Chicago O'Hare. A passenger taps an NFC sign (or scans its QR code), the website opens with a fixed **You are here** marker, and two questions follow: *Are you catching a flight?* and *What's your flight number?* The site looks up the gate and draws a highlighted route there with written directions. Anyone can also search for a gate, restroom or food. It needs no GPS, no location permission and no app.

Not an official Chicago Department of Aviation service.

## Links

- Map: `https://suryaaketi.github.io/ord-tap/`
- NFC tag for the demo sign near Gate B6: `https://suryaaketi.github.io/ord-tap/?start=t1-b6`
- Demo route to share: `https://suryaaketi.github.io/ord-tap/?start=t1-b6&to=t1-c17`
- Printable signs: `https://suryaaketi.github.io/ord-tap/sign.html?start=t1-b6`
- Flight demo: `https://suryaaketi.github.io/ord-tap/?start=t1-b6&flight=UA1234`

Links work when opened directly or refreshed. `start` is the sign; `to` is the destination; `flight` is a flight number, looked up again on every refresh so gate changes show up; `steps=avoid` uses elevators instead of escalators.

## Flight lookup

- **Sample mode (now):** `ord/config.js` has no Worker address, so the site uses `data/sample-flights.json` and labels every result "Sample flight, not live data". Try UA 1234 (Gate C17), UA 2210 (delayed, B14), UA 4567 (no gate yet), AA 2345 (Terminal 3), DL 3456 (Terminal 5, transfer bus) and UA 5678 (cancelled).
- **Live mode:** sign up for Aviationstack's free plan, deploy `worker/flight-worker.js` on Cloudflare with the key as a secret, and paste the Worker address into `ord/config.js`. Step-by-step: `worker/README.md`.
- The free plan allows about 100 lookups a month. The Worker reuses each answer for 10 minutes. The key never goes in this repository.

## Coverage

| Area | Status |
|---|---|
| Terminal 1, Concourses B and C, B/C pedestrian tunnel | Routes, with level changes |
| Terminals 2, 3 and 5 | Map preview: gates and amenities placed, no routes yet |
| Whole airport | Boundary, runways and building outlines from OpenStreetMap; all 213 gates shown as dots when zoomed out |
| Terminal 5 from Terminal 1 | Walking route to the Terminal Transfer Bus at Gate C18B, plus the bus hours and the ATS rule |

Terminal 1 routes were compared with the official interactive map's own walking routes from Gate B6 to ten destinations and agree within 3% (B6 to C17: 490 m here, 491 m official). The test suite checks this.

## How it works

- `data/network.json`: the hand-drawn corridor lines for Terminal 1, the escalators and elevators between the Upper Level and the Pedestrian Tunnel Level, the schematic shapes, the transfer rules and the signs. Every item names its source.
- `data/places.json`: 433 gates, restrooms, food places, amenities and transfer points, each with terminal, concourse, level, security side and source.
- `data/outline.json`: airport boundary, building outlines and runways from OpenStreetMap (ODbL).
- `ord/flights.js`: reads flight numbers, picks the right departure, and matches the gate to the map. `ord/config.js` holds the Worker address.
- `worker/flight-worker.js`: the Cloudflare Worker that hides the Aviationstack key.
- `ord/core.js`: builds the walking network, plans trips, writes directions, searches and applies the transfer-bus hours. No page code, so it runs under `npm test`.
- `router.js`, `sheet.js`, `signs.js` and `prototype.js` come from Campus Tap. `router.js` adds `routeNodes` so indoor routes start and end on the right level.

## Develop

```
npm test
python3 -m http.server 8000
```

Then open `http://localhost:8000/?start=t1-b6&to=t1-c17`.

## Sources

Checked November 4, 2026: the [O'Hare interactive map](https://maps.ord.flychicago.com/), the [official printable terminal maps](https://www.flychicago.com/ohare/map/Pages/printablemaps.aspx) including the [Terminal 1 map](https://www.flychicago.com/SiteCollectionDocuments/O%27Hare/ArchivedPDFs/Map/T1.pdf), [terminal accessibility and amenities](https://www.flychicago.com/ohare/servicesamenities/accessibility/Pages/Terminal-Accessibility.aspx), and [transportation between terminals](https://www.flychicago.com/ohare/servicesamenities/services/pages/tbt.aspx). Building outlines and runways © OpenStreetMap contributors (ODbL). Flight data from Aviationstack. See `sources.html`.

Locations were checked against the airport's map data for a non-commercial class prototype. Ask the Chicago Department of Aviation before using this data beyond that.
