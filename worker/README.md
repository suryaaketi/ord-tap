# ORD Tap flight feed

The Cloudflare Worker loads the O’Hare schedule for the Chicago calendar day and shares it across Departures, Arrivals, and flight-number lookup. ORD Tap displays these flights in its own searchable cards.

## 1. Get an AeroDataBox key

Subscribe to [AeroDataBox Basic on RapidAPI](https://rapidapi.com/aedbx-aedbx/api/AeroDataBox/pricing) and copy the RapidAPI key. The full-day board uses the [airport flight schedule endpoint](https://doc.aerodatabox.com/) in two 12-hour windows on a normal day. Basic includes 400 units per month at the time of setup. Each window uses 2 units, allowing about 100 full-day refreshes per month.

## 2. Deploy the Worker

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages** and create a Worker named `ord-tap-flights`.
2. Open **Edit code**, replace the starter code with [flight-worker.js](flight-worker.js), and deploy.
3. Under **Settings → Variables and Secrets**, add a **Secret** called `AERODATABOX_KEY` and save your RapidAPI key there.
4. Copy the public `https://ord-tap-flights.YOUR-NAME.workers.dev` address. Only this address belongs in site configuration.

The Worker checks the provider on demand. The default snapshot interval is 30 minutes. Set `BOARD_MINUTES` as a plain-text variable to change it, with a minimum of 5 minutes. For an always-available class prototype on Basic, set it to `480` and bind a KV namespace named `FLIGHTS` to share snapshots across Worker instances. Use a shorter interval during a demo. Check your usage in RapidAPI, since concurrent cache misses can consume extra units.

## 3. Verify and connect

1. Open `/board` and `/board?direction=arrivals` at the Worker URL. Both should return a `data` array, today’s Chicago `date`, `source: "aerodatabox"` and a recent `fetchedAt`.
2. Compare a few flights from different parts of the day with O’Hare or the airline, including a late departure and any gates listed. Try a current departure in `/flight?number=UA1234` by replacing `UA1234` with its number.
3. Set `FLIGHT_API` in [ord/config.js](../ord/config.js) to the Worker base URL, bump the file version queries, and publish the site. Verify both flight tabs and search. The published board then opens with provider data. `?demo=1` remains available for classroom demonstrations.

The board shows the time of its last successful check. Gate and status availability depend on the provider. An existing `AVIATIONSTACK_KEY` still supports the older limited flight feed. Use `AERODATABOX_KEY` for the full-day board.
