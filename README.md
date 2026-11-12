# ORD Tap

An ENGR 408 student prototype of NFC wayfinding at Chicago O'Hare. A passenger taps an NFC sign (or scans its QR code), the website opens with a fixed **You are here** marker, and the passenger can view current flights or search for a gate, restroom or food. With the flight API connected, the site can look up a flight’s gate and draw a route there with written directions. It needs no GPS, no location permission and no app.

Not an official Chicago Department of Aviation service.

## Links

- Map: `https://suryaaketi.github.io/ord-tap/`
- NFC tag for the demo sign near Gate B6: `https://suryaaketi.github.io/ord-tap/?start=t1-b6`
- Demo route to share: `https://suryaaketi.github.io/ord-tap/?start=t1-b6&to=t1-c17`
- Printable signs: `https://suryaaketi.github.io/ord-tap/sign.html?start=t1-b6`
- Flight demo: `https://suryaaketi.github.io/ord-tap/?start=t1-b6&flight=UA1234&demo=1`

Links work when opened directly or refreshed. `start` is the sign; `to` is the destination; `flight` is a flight number, checked again when you open the link; `steps=avoid` uses elevators instead of escalators.

## Flight lookup

- With no Worker address configured, the flight options open the labeled sample board and link to O’Hare’s official flight status.
- With the flight Worker connected, visible flight details check for a newer snapshot once a minute. Each result shows when the Worker checked the feed. **Check for updates** also requests the latest available snapshot. Gate changes are flagged on the route. Setup is in [worker/README.md](worker/README.md).
- Add `?demo=1` (or `&demo=1` on a sign link) to try labeled sample flights, including UA 1234 (Gate C17), UA 2210 (delayed, B14), UA 4567 (no gate), AA 2345 (Terminal 3), DL 3456 (Terminal 5, transfer bus) and UA 5678 (cancelled).

## Flight board

**Flight board** opens the ORD Tap list. Choose **Departures** or **Arrivals** and search by flight number, airport name or code, or airline. The terminal filter works in either direction. Departures with a mapped gate can open a walking route.

With the AeroDataBox Worker connected, these same cards show the full Chicago calendar day from the feed, with upcoming flights first. Search includes earlier flights from the same day. The board shows the last check time and keeps codeshare numbers searchable. Sample records are used when the Worker is unconfigured or when `?demo=1` is selected.

## Walking the route

- **Simulate walk:** an orange dot walks the route at walking pace (sped up 1×, 5× or 20×). The banner shows the current direction, the floor (Upper Level or tunnel), and minutes left. No location is used, so it works anywhere, including in class.
- **Live GPS:** the blue dot follows your phone's GPS along the route, with a circle showing how unsure it is. It only works inside the airport boundary. Indoors, GPS drifts and cannot tell the Upper Level from the tunnel, so the dot is matched to the route; if you are more than about 45 m off the route, or the GPS is worse than ±120 m, it asks you to tap the nearest sign. A sign tap always wins.
- **Use my location (GPS):** without a sign, picks the nearest Terminal 1 gate as your start.
- The site never asks for location until one of these buttons is tapped, so a sign tap still opens with no permission prompt.

## Updating the site

`index.html` and the imports at the top of `ord/app.js` add a version query such as `?v=20261112f` to file names. When you push a change to the code or styles, change that date in both places, so phones that opened an older version load the new files together.

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
- `ord/walk.js`: the simulated walk and live GPS following: route progress, snapping fixes to the route, the airport boundary check.
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

Checked November 4, 2026: the [O'Hare interactive map](https://maps.ord.flychicago.com/), the [official printable terminal maps](https://www.flychicago.com/ohare/map/Pages/printablemaps.aspx) including the [Terminal 1 map](https://www.flychicago.com/SiteCollectionDocuments/O%27Hare/ArchivedPDFs/Map/T1.pdf), [terminal accessibility and amenities](https://www.flychicago.com/ohare/servicesamenities/accessibility/Pages/Terminal-Accessibility.aspx), and [transportation between terminals](https://www.flychicago.com/ohare/servicesamenities/services/pages/tbt.aspx). Building outlines and runways © OpenStreetMap contributors (ODbL). Flight data from the configured Worker. See `sources.html`.

Locations were checked against the airport's map data for a non-commercial class prototype. Ask the Chicago Department of Aviation before using this data beyond that.
