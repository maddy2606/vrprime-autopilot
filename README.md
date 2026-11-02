# VRPRIME Autopilot

Runs on GitHub every 30 minutes from **8:00 AM to 11:00 PM** India time, so your computer can be off. **Paused 11:00 PM – 8:00 AM**: no listings activated, no page update, no emails. It does three things for Flipkart Seller Hub:

1. **Activates Ready for Activation listings automatically.** Only SKUs that Seller Hub shows in *Inactive > Ready for Activation* are activated, with no approval step. Other inactive listings and archived listings are never touched.
2. **Keeps a Flipkart Ads budget page**: [`BUDGET.md`](BUDGET.md). It shows the ad wallet, 7-day spend, days of spend left, and every campaign that is out of budget or running out. It refreshes every 30 minutes.
3. **Emails you on Gmail** when a campaign goes out of budget. It also emails when the ad wallet gets low, when ads stop being read, and when listings were activated.

## Overnight pause (11:00 PM – 8:00 AM)

- **Schedule:** the first run is about 8:12 AM and the last about 10:42 PM IST (`.github/workflows/autopilot.yml`).
- **Night pushes:** `run.mjs` and `ads-push.mjs` also check `pausedHours` in `config.json`, so a push from the Mac at night does nothing either.
- **Manual runs:** **Actions > Autopilot > Run workflow** still works at night if you need it.
- **Changing the hours:** edit `"pausedHours": { "from": "23:00", "to": "08:00" }` in `config.json` *and* the two cron lines in the workflow. Cron is in UTC, which is IST − 5:30.
- **Morning email:** anything that happened overnight (a campaign out of budget, a listing ready for activation) is handled and emailed in the first run after 8 AM.
- **No false morning alert:** the "ads not being checked" check only counts time since 8:00 AM.

## How it works

| Part | Where it runs | How |
|---|---|---|
| Ready for Activation list | Chrome on your Mac, then GitHub | Flipkart's API can't tell that tab apart from other inactive listings. So the Mac reads the tab in Chrome and runs `ready-push.mjs`, which pushes the SKUs to `listings/ready.json`. |
| Listing activation | GitHub Actions | Flipkart Seller API: sets `listing_status` to `ACTIVE` for **only the SKUs in `listings/ready.json`**, after checking with Flipkart that each one is really inactive and not archived. It then reads each one back to confirm. |
| Ads budget | Chrome on your Mac, then GitHub | Flipkart Ads has **no API** for sellers. So `ads/read-ads.js` reads Seller Hub > Ads > Campaign Manager in Chrome, and `ads-push.mjs` pushes the result to `ads/latest.json`. |
| Budget page + email | GitHub Actions | `run.mjs` turns `ads/latest.json` into `BUDGET.md` and `docs/index.html`, and sends the Gmail alert. |

### Listing activation rules

- **Activated:** only SKUs in the latest Ready for Activation list from the Mac. The list must be under 90 minutes old (`readyMaxAgeMinutes`). With no list, or an old one, **nothing is activated**.
- **Never touched:** any inactive listing that isn't in that tab, archived listings (even if listed), and SKUs in `activation.ignoreSkus`.
- **Refused SKUs:** if Flipkart refuses one, the reason is emailed once, and it's retried every 6 hours only while it's still in the tab.
- **Limit:** at most 50 listings per run (`maxPerRun`).
- **To stop activation completely:** set `"enabled": false` under `activation` in `config.json`.

### When you get an email

| Email | When |
|---|---|
| 🔴 Out of budget: *campaign* | A campaign appears in Flipkart's out-of-budget list. Once per episode. If it comes back in budget and runs out again within 6 hours, it's shown on the page but not re-emailed. Daily budgets that run out again the next day are emailed again. |
| 🔴 Ad wallet low | Less than 3 days of spend left (`ads.walletMinDays`). |
| ⚠️ Ads not being checked | No new ads reading for 75 minutes (`ads.staleMinutes`): the Mac is off, Chrome is closed, or Seller Hub signed out. |
| ⚠️ Ads check failed | Chrome is signed out of Seller Hub, or the page didn't load. |
| ✅ Listings activated | The SKUs that were just activated (turn off with `activation.emailWhenActivated: false`). |
| ⚠️ Couldn't be activated | Flipkart refused a SKU from the Ready for Activation tab, with Flipkart's reason. Sent once per SKU. |

## Setup

### 1. Secrets

In **Settings > Secrets and variables > Actions > New repository secret**:

| Secret | What |
|---|---|
| `FLIPKART_APP_ID` | The same Flipkart Seller API app ID that `business-watch` uses |
| `FLIPKART_APP_SECRET` | Its secret |
| `GMAIL_USER` | The Gmail address that sends the alerts, e.g. `you@gmail.com` |
| `GMAIL_APP_PASSWORD` | A Gmail **app password** for that address (not your normal password). Create one at <https://myaccount.google.com/apppasswords>. 2-Step Verification must be on. |
| `ALERT_EMAIL_TO` | *(optional)* Where alerts go, comma-separated. Defaults to `GMAIL_USER`. |

### 2. Mac: read the ads and the Ready for Activation tab

Clone this repo on the Mac next to `business-watch`. Then edit the Claude scheduled task **Flipkart ads check (every 30 min)** and add these steps after its existing ones:

> Then also run `node ads-push.mjs '<the same ads JSON line>'` in the `vrprime-autopilot` folder.
>
> Then open Seller Hub > Listings > Inactive and select the **Ready for Activation** tab. Collect the seller SKU ID of every listing in that tab, on every page. Then run in the `vrprime-autopilot` folder:
> `node ready-push.mjs '{"ok":1,"skus":["SKU1","SKU2"]}'` (use `"skus":[]` when the tab is empty).
> If Seller Hub is signed out, run `node ready-push.mjs '{"ok":0,"e":"signed_out"}'`. If the tab didn't load, use `"e":"page_not_loaded"` instead.
> Don't click Activate or change anything in Seller Hub.

### 3. Test

- **Actions > Autopilot > Run workflow**, then read the log. It lists every SKU it activated or couldn't activate.
- **Dry run first?** Set `"dryRun": true` under `activation` in `config.json`. The log and page then say what *would* be activated, without changing anything.
- **Locally:** `node run.mjs --preview` writes the page and the email to `preview/` and changes nothing. It uses `.env` here or one folder up.
- `npm test` runs the tests. They use a fake Flipkart and a fake Gmail server.

## The budget page

- **In this private repo:** [`BUDGET.md`](BUDGET.md) is the page. It reads well in the GitHub mobile app too.
- **As a web page:** `docs/index.html` is the same page as a phone-friendly website. Turn it on in **Settings > Pages > Deploy from branch > main > /docs**. GitHub Pages on a *private* repo needs a paid GitHub plan, and the site is public, so anyone with the link can see your ad budgets. Then set a repository **variable** `PAGE_URL` to its address, so alert emails link to it.

## Cost and limits

- **Actions minutes:** each run takes under a minute, but GitHub rounds every run up to a whole minute. With the overnight pause that's 30 runs a day, about **900 minutes a month**. `business-watch` already uses about 1,440. Together that's ~2,350 minutes. A free GitHub plan includes **2,000 minutes a month for private repos**. To stay inside that, do one of these:
  - upgrade to GitHub Pro (3,000 minutes);
  - run hourly instead: delete the second cron line (`12 3-17 * * *`) in `.github/workflows/autopilot.yml`; ads alerts would still arrive within a minute or two, because a push from the Mac starts a run;
  - turn off one of the two repos' schedules.
- **Ads need the Mac.** Ads readings only happen while your Mac is on, Chrome is open, and Chrome is signed in to Seller Hub. When readings stop, you get the "Ads not being checked" email.
- **Ads coverage:** the reader reads Flipkart's **Budget Exhausting** list: campaigns out of budget or close to it. Campaigns with plenty of budget left aren't listed.
- GitHub sometimes starts scheduled runs 5–15 minutes late.

## Files

| File | Purpose |
|---|---|
| `run.mjs` | One run: activate listings, evaluate ads, email, write the page |
| `lib/activate.mjs` | Which listings to activate, back-off for refused SKUs |
| `lib/flipkart.mjs` | Flipkart Seller API calls (token, search, read, update) |
| `lib/ads.mjs` | Ads problems and which ones are new enough to email |
| `lib/page.mjs` | `BUDGET.md`, `docs/index.html`, and the alert email |
| `lib/mail.mjs` | Sends mail through Gmail SMTP. No packages. |
| `ads/read-ads.js`, `ads-push.mjs` | Run on the Mac: read Seller Hub Ads in Chrome and push to `ads/latest.json` |
| `ready-push.mjs` | Runs on the Mac: pushes the Ready for Activation SKUs to `listings/ready.json` |
| `config.json` | Ignore list, dry run, retry interval, alert thresholds |
| `state/state.json` | What's been activated, refused, and alerted. Written by the workflow. |
