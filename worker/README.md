# ORD Tap flight feed

ORD Tap uses a Cloudflare Worker for its departures board and flight lookup. The Worker fetches ORD records from Aviationstack and returns the time of the last check. Until a Worker address is configured, ORD Tap displays the [Avionio O’Hare board](https://www.avionio.com/en/widgets/ord/departures/en) inside the app.

## 1. Get an Aviationstack API key

Get a key in the [Aviationstack dashboard](https://aviationstack.com/). The [free tier](https://aviationstack.com/product) includes 100 requests per month and works for a limited class demo. Frequent updates for a public board require a feed with a larger quota and adequate flight coverage.

## 2. Deploy the Worker

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages** and create a Worker from **Hello World** named `ord-tap-flights`.
2. Open **Edit code**, replace the starter code with [flight-worker.js](flight-worker.js), and deploy.
3. Under **Settings → Variables and Secrets**, add a **Secret** named `AVIATIONSTACK_KEY` and enter your key there.
4. Copy the public `https://ord-tap-flights.YOUR-NAME.workers.dev` address. Share the Worker address when connecting the site. Keep the key in Cloudflare.

The board checks Aviationstack when requested after `BOARD_MINUTES` elapses. The default is 480 minutes. The site checks for newer snapshots every minute while the board or flight result is open. Lookups cache each flight number for 10 minutes. A `FLIGHTS` KV namespace binding lets instances share snapshots. Concurrent requests from different Cloudflare locations can still use additional quota. For a supervised demo, set `BOARD_MINUTES` as a plain text variable to a shorter interval (minimum 5 minutes) and restore it after the demo.

## 3. Verify and connect

1. Open `/board` on the Worker URL. Confirm it returns ORD records and a recent `fetchedAt`.
2. Use a current flight number from those records in `/flight?number=UA1234`, replacing `UA1234` with that number. Compare the time and gate with the airline or O’Hare. Gate and status availability depend on the feed.
3. Set `FLIGHT_API` in [ord/config.js](../ord/config.js) to the public Worker base URL. Commit and deploy the site. Verify the board and the same flight lookup from the published site.

The board uses the first 100 returned records and filters them to upcoming departures. Use the official link for additional flights or current airline confirmation. The public Worker address can receive requests outside the app, so monitor the provider quota before enabling frequent checks.
