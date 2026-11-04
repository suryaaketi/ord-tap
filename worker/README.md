# Flight lookup Worker

The site asks this Worker for a flight; the Worker asks Aviationstack using your key and sends back only the flight details. The key never appears on GitHub or in the page.

The Worker is free on Cloudflare's free plan. Aviationstack's free plan allows about 100 lookups a month, and the Worker reuses each answer for 10 minutes.

## 1. Get the Aviationstack key

1. Go to <https://aviationstack.com/product> and choose the **Free** plan.
2. Sign up. Your **API Access Key** is on the dashboard after you log in.
3. Do not paste the key into any file in this repository.

## 2. Create the Worker

1. Sign up at <https://dash.cloudflare.com/sign-up> (free).
2. Open **Workers & Pages**, choose **Create**, then start from the **Hello World** Worker.
3. Name it `ord-tap-flights` and deploy it.
4. Choose **Edit code**, delete everything in the editor, paste in the whole of `worker/flight-worker.js`, and deploy again.
5. Open the Worker's **Settings → Variables and Secrets**. Add a variable of type **Secret** named `AVIATIONSTACK_KEY` and paste your key as its value. Deploy if asked.
6. Copy the Worker's address, which looks like `https://ord-tap-flights.YOUR-NAME.workers.dev`.

Optional: create a KV namespace, then bind it to the Worker under the name `FLIGHTS`. Every Cloudflare server then shares one cache, which saves lookups.

## 3. Test it (uses one lookup)

Open this in a browser, with your address:

```
https://ord-tap-flights.YOUR-NAME.workers.dev/flight?number=UA1234
```

You should get `{"data":[...]}`. If you see `{"error":{"code":"invalid_access_key"...}}`, the secret is wrong.

## 4. Turn it on in the site

Edit `ord/config.js`:

```js
export const FLIGHT_API = 'https://ord-tap-flights.YOUR-NAME.workers.dev';
```

Commit and push. The site now looks up real flights; until then it uses the sample flights in `data/sample-flights.json`.

## Limits to know

- **The Worker address is public.** Anyone who reads the site's code can call it. Calls from other websites are refused, but a script can still spend your 100 lookups. If that happens, reset the key on the Aviationstack dashboard and update the secret.
- **Gates can be missing.** Aviationstack does not always have a gate. The site then names the terminal and tells the passenger to check the departure screens.
- **Check the times once.** The site reads Aviationstack's departure times as Chicago clock time. Compare the first real lookup with the airline's app; if it is 5 or 6 hours off, tell your teammates before the demo.
