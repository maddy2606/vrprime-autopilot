# VRPRIME Autopilot

Runs on GitHub every 30 minutes, so your computer can be off. It does three things for Flipkart Seller Hub:

1. **Activates listings automatically.** Any listing in Seller Hub's *Inactive > Ready for Activation* tab is set to Active, with no approval step.
2. **Keeps a Flipkart Ads budget page**: [`BUDGET.md`](BUDGET.md). It shows the ad wallet, 7-day spend, days of spend left, and every campaign that is out of budget or running out. It refreshes every 30 minutes.
3. **Emails you on Gmail** when a campaign goes out of budget. It also emails when the ad wallet gets low, when ads stop being read, and when listings were activated.

## How it works

| Part | Where it runs | How |
|---|---|---|
| Listing activation | GitHub Actions | Flipkart Seller API: finds every `INACTIVE` listing that isn't archived, sets `listing_status` to `ACTIVE`, then reads it back to confirm. |
| Ads budget | Chrome on your Mac, then GitHub | Flipkart Ads has **no API** for sellers. So `ads/read-ads.js` reads Seller Hub > Ads > Campaign Manager in Chrome, and `ads-push.mjs` pushes the result to `ads/latest.json`. |
| Budget page + email | GitHub Actions | `run.mjs` turns `ads/latest.json` into `BUDGET.md` and `docs/index.html`, and sends the Gmail alert. |

### Listing activation rules

- **Activated:** inactive and not archived. That is Seller Hub's *Ready for Activation* tab.
- **Never touched:** archived listings, and SKUs in `activation.ignoreSkus` in `config.json`.
- **Blocked listings:** the API also reports these as inactive. Flipkart refuses to activate them. The refusal reason is emailed once and shown on the budget page. That SKU is retried every 6 hours (`retryAfterFailureHours`), not every run.
- ⚠️ **If you switch a listing off on purpose, it gets switched back on within 30 minutes.** To keep one off, add its SKU to `ignoreSkus`, or archive it in Seller Hub.
- **The update call:** it sends Flipkart the listing exactly as Flipkart returned it, with only `listing_status` changed. Price, stock, packages, etc. are unchanged.

### When you get an email

| Email | When |
|---|---|
| 🔴 Out of budget: *campaign* | A campaign appears in Flipkart's out-of-budget list. Once per episode. If it comes back in budget and runs out again within 6 hours, it's shown on the page but not re-emailed. Daily budgets that run out again the next day are emailed again. |
| 🔴 Ad wallet low | Less than 3 days of spend left (`ads.walletMinDays`). |
| ⚠️ Ads not being checked | No new ads reading for 75 minutes (`ads.staleMinutes`): the Mac is off, Chrome is closed, or Seller Hub signed out. |
| ⚠️ Ads check failed | Chrome is signed out of Seller Hub, or the page didn't load. |
| ✅ Listings activated | The SKUs that were just activated (turn off with `activation.emailWhenActivated: false`). |
| ⚠️ Couldn't be activated | Flipkart refused a SKU, with Flipkart's reason. Sent once per SKU. |

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

### 2. Point the Mac's ads reader at this repo

The existing Claude scheduled task on your Mac, **Flipkart ads check (every 30 min)**, reads Seller Hub Ads in Chrome. It currently pushes to `business-watch` with `node ads-push.mjs '<json>'`. Clone this repo on the Mac next to `business-watch`, then edit that task's instructions and add one line after its existing push step:

> Then also run `node ads-push.mjs '<the same JSON line>'` in the `vrprime-autopilot` folder.

The JSON line that `ads/read-ads.js` returns is the same for both repos.

### 3. Test

- **Actions > Autopilot > Run workflow**, then read the log. It lists every SKU it activated or couldn't activate.
- **Dry run first?** Set `"dryRun": true` under `activation` in `config.json`. The log and page then say what *would* be activated, without changing anything.
- **Locally:** `node run.mjs --preview` writes the page and the email to `preview/` and changes nothing. It uses `.env` here or one folder up.
- `npm test` runs the tests. They use a fake Flipkart and a fake Gmail server.

## The budget page

- **In this private repo:** [`BUDGET.md`](BUDGET.md) is the page. It reads well in the GitHub mobile app too.
- **As a web page:** `docs/index.html` is the same page as a phone-friendly website. Turn it on in **Settings > Pages > Deploy from branch > main > /docs**. GitHub Pages on a *private* repo needs a paid GitHub plan, and the site is public, so anyone with the link can see your ad budgets. Then set a repository **variable** `PAGE_URL` to its address, so alert emails link to it.

## Cost and limits

- **Actions minutes:** each run takes under a minute, but GitHub rounds every run up to a whole minute. That's 48 runs a day, about **1,440 minutes a month**. `business-watch` already uses about the same. Together that's ~2,900 minutes. A free GitHub plan includes **2,000 minutes a month for private repos**. To stay inside that, do one of these:
  - upgrade to GitHub Pro (3,000 minutes);
  - change the cron in `.github/workflows/autopilot.yml` to hourly (`12 * * * *`); ads alerts would still arrive within a minute or two, because a push from the Mac starts a run;
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
| `config.json` | Ignore list, dry run, retry interval, alert thresholds |
| `state/state.json` | What's been activated, refused, and alerted. Written by the workflow. |
