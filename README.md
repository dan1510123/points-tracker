# Points Tracker

A ledger of the points you **have** and the points you've **ever used**, across Amex, Chase, Delta, Bilt, Alaska, and anything else you add.

No optimizer, no offers, no card-application tracking. Two questions only: what do I hold, and what did I spend?

A static single-page app — no server, no accounts, no database. Your data lives in your browser and nothing leaves the
device unless you export it or turn on the optional [private-gist sync](#sync-between-devices-through-a-private-gist).
Runs from any static host; a [GitHub Pages deploy](#deploying-to-github-pages) is wired up.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173/points-tracker/ (the `/points-tracker/` base matches where it lives on GitHub Pages).

That's the whole thing — one Vite dev server, no backend. To preview a production build locally:

```bash
npm run build
npm run preview
```

## How value is calculated

Value is always **points × your cents-per-point setting**. Nothing is inferred from your data — no back-solving a rate from what you booked. You set the number on the **Settings** page, per program, with a global default for anything left blank. Change a rate and every figure in the app updates.

This is the main thing that differs from commercial trackers, which apply their own valuations.

## Pages

- **Dashboard** — points held vs. used, value by year, cumulative value, where the points went, biggest redemptions
- **Points I have** — current balance per program, entered by hand; each save records a dated snapshot so a trend builds over time, plus points earned all time per program
- **Points I've used** — the redemption ledger: add, edit, filter, search — and transfers to partners, plus a duplicate check over everything logged
- **Import CSV** — bulk-backfill redemption history from a CSV or JSON file
- **Settings** — cents-per-point per program, add/remove programs, export/import all app data, and private-gist sync

## Duplicates are blocked

An entry that matches one already in the ledger is **refused**. Everything that describes what happened is compared — kind of row, date, program, points, category, description, and for a transfer its destination and the miles received. **Notes are ignored**: they're an optional scratchpad, and letting them count would wave through the same booking typed twice with a note added the second time. Points are compared by magnitude, so a statement that exports awards as negative miles still matches the positive row you already have.

- **Logging one by one** — the form flags the collision as you type, names the entry it collides with, and disables Save. **Save it anyway** overrides it for that one entry.
- **Importing** — duplicate rows are held back and listed individually with the entry each one collides with, whether it's already in the ledger or repeated earlier in the same file. The rest of the file still imports. One checkbox overrides the whole batch.
- **Already-logged duplicates** — Points I've used has a **Duplicate check** panel that sweeps the whole ledger, groups anything logged more than once, and offers to keep the first copy and delete the rest.

The API enforces this too, not just the UI: a write that would duplicate an existing row comes back `409` unless it carries `?allowDuplicate=1`.

## Transfers, and what you actually earned

Points I've used has a second row type: a **transfer** from a transferable currency to a partner — Amex to Delta, Chase to Hyatt. Log it with points out, the transfer bonus, and the miles that landed; a partner that isn't 1:1 goes in by typing the received figure directly.

A transfer is worth **$0**. You haven't gotten anything yet, so pricing it would double-count the award you eventually book with the miles. Log that award separately, against the destination program — that's the row that carries the value. The transfer still counts as points out of the source program, because they really did leave.

What transfers buy you is a number the app otherwise can't know: **points earned all time**, per program.

```
earned = balance + spent + transferred out − transferred in
```

Transfer 100,000 Amex to Delta at a 30% bonus, receive 130,000 SkyMiles, book a 120,000-mile award, and Delta shows 88,034 earned against a 98,034 balance — the flying and cobrand spend you actually did, with the transferred miles netted out. Without the transfer row, Delta would look like it earned all 218,034.

It's a **floor**, not an exact figure. Balances stay the source of truth and this app never writes to them; earning is backed out of what's left plus everything that flowed out, so any redemption or transfer missing from the ledger makes earned read low. A figure shown in red means more arrived by transfer than the balance and ledger can account for — usually a missing redemption.

## Backfilling six years of redemptions

No program here exports redemption history, so the CSV importer takes a sheet you assemble yourself. Only two columns are required — a **date** and a **points** amount. A description and category make the ledger readable later.

Practical ways to reconstruct history:

- **Airline programs (Delta, Alaska)** — the activity page on their site goes back further than most people expect. Copy it into a spreadsheet. Awards appear as negative miles; tick *"keep only the negative rows"* and paste the whole statement in.
- **Transferable currencies (Amex, Chase, Bilt)** — points leave as a *transfer* to a partner, so the transfer is the redemption. Amex and Chase both keep a rewards activity history separate from card transactions.
- **Anything else** — old award confirmation emails. Searching your mail for "award", "miles", or the airline's booking address usually surfaces the large ones fast.

The importer previews everything before writing and tags each batch, so a wrong column mapping is one **Undo import** click away on the Points I've used page.

### Importing JSON

The Import page also takes JSON — upload a file or paste it straight into the box. There's no column mapping: the field names *are* the contract, and unlike CSV the format can express transfers. Accepts either a top-level array or an object with a `redemptions` array, so a file from Settings → **Download JSON** can be fed back in.

```json
{
  "redemptions": [
    {
      "date": "2024-06-02",
      "program": "Delta SkyMiles",
      "points": 120000,
      "description": "JFK–NRT business",
      "category": "Flight"
    },
    {
      "type": "transfer",
      "date": "2024-03-11",
      "program": "Amex Membership Rewards",
      "to": "Delta SkyMiles",
      "points": 100000,
      "bonusPct": 30
    }
  ]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `date` | yes | `YYYY-MM-DD` preferred; `MM/DD/YYYY` and similar accepted. Impossible dates are rejected. |
| `points` | yes | Points leaving the program. Negatives are treated as positive. |
| `program` | no | Name or id. Falls back to the program selected on the page. |
| `type` | no | `redemption` (default) or `transfer`. |
| `category` | no | Redemptions only. Falls back to the default category on the page. |
| `to` | transfers | Destination program name or id. Must differ from the source. |
| `bonusPct` | no | Transfers only, e.g. `30` for a 30% bonus. |
| `received` | no | Transfers only. Overrides points × bonus — use it for partners that aren't 1:1. |
| `description`, `notes` | no | Free text. |

Anything else in the file is ignored. Rows that fail validation are listed one by one with the reason and skipped; they never block the rest of the import. Entries that duplicate something already logged are listed the same way and held back — see [Duplicates are blocked](#duplicates-are-blocked). Every import is tagged as a batch, so **Undo import** reverses the whole thing.

Expect gaps. Partial history still answers the question — just be aware the total is a floor, not a complete accounting.

## Your data

Everything — programs, redemptions, settings — is one JSON object in your browser's `localStorage`, under the key
`pointstracker:store`. There is no server and no file on disk; the same JSON you'd have found in `data/store.json` in the
old server-backed version now lives in the browser.

That has one consequence worth internalizing: **`localStorage` is per-browser and per-origin.** The dev app on
`localhost` and the deployed app on `github.io` keep *separate* copies, and clearing the site's browser data wipes it.
So back up by exporting:

- **Settings → Export app data** downloads the whole store as `points-tracker-backup-<date>.json`. This is your backup
  and the way to move everything to another browser or device.
- **Settings → Import app data** replaces everything on the current device with a backup file. It snapshots the current
  data first (an in-browser safety net, kept for the last several writes), so importing the wrong file is undoable.
- **[Private-gist sync](#sync-between-devices-through-a-private-gist)** is the automated version of the same round-trip.

An unreadable `localStorage` value is set aside rather than silently overwritten, the same way the old server quarantined
a corrupt `store.json`.

## Sync between devices through a private gist

Optional, and off until you set it up. It puts one JSON file — the same one **Download JSON** gives you — in a private
GitHub gist, so a laptop and a desktop can hold the same ledger without a database, a server, or an account anywhere new.
Same mechanism the perk-graph project uses.

1. Go to `github.com/settings/tokens/new` — a **classic** token (Tokens (classic) → Generate new token). This must be a
   classic token: fine-grained tokens don't work with the gist API, and a push with one fails with a 404.
2. Check only the **gist** scope. Nothing else — it needs no repository or other access. Optionally set an expiry.
3. Generate and copy the token.
4. Settings → **Sync to a private gist** → paste the token, leave **Gist id** blank → **Push to gist**. A private gist is
   created and its id appears in the field.
5. On the other device, paste the same token and that gist id, then **Pull from gist**.

After that it's automatic. With **Auto-sync** on (the default once a gist is set up):

- **Every save pushes.** Any change — a balance, a redemption, a rate, an import — is pushed to the gist a moment later.
  A burst of saves becomes one push. A save that couldn't be pushed (offline, tab closed too soon) is remembered and
  pushed the next time the page opens.
- **Every page load pulls.** Opening the app checks the gist first; if another device changed it, that copy is loaded
  (with a snapshot of this device's data taken first) before anything is shown.

Untick **Auto-sync** to go back to doing it by hand: **Push to gist** writes this device's data up, **Pull from gist**
brings the other device's data down — both buttons work either way. **Forget token** clears both fields from this
browser and leaves the gist itself alone. The sidebar shows which gist is in play and whether the last save reached it,
or `local only` when sync is off.

### What it costs you in privacy

The token lives in this browser's `localStorage` and is sent to `api.github.com` and nowhere else. There is no backend
for it to reach even if it wanted to — the app is entirely static. The gist is created private.
Private is not secret: anyone with the URL can read it, and GitHub can. If that's not a trade you want, skip this
section entirely — everything else in the app works without it.

### Conflicts

Gists have no compare-and-swap, so last write wins and there is nothing to stop one device silently overwriting the
other. What the app does instead: it remembers the gist's `updated_at` from the last time *this* browser synced, and
checks it before pushing. If the gist has moved since — almost always the other device having pushed — a manual push
stops and asks, naming the time it was written, before it overwrites anything, and an automatic push is held back and
flagged in the sidebar and Settings. Pulling first is the way out. If both sides changed by the time the page loads
(an unpushed save here, a newer push from elsewhere), the app asks which copy to keep.

A pull replaces everything on this device, and snapshots the current data (the same in-browser safety net that Import
uses) before it does.

## Deploying to GitHub Pages

The repo ships a workflow at `.github/workflows/deploy.yml` that builds the app and publishes it on every push to
`main`. One-time setup:

1. Push to GitHub (public or private both work; Pages is available on public repos, and on private with a paid plan).
2. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Push, or run the workflow manually from the **Actions** tab. It lands at
   `https://<user>.github.io/points-tracker/`.

The Vite `base` is set to `/points-tracker/` to match that URL. If you rename the repo, change `base` in
[`vite.config.js`](vite.config.js) to `/<new-name>/`. Routing uses hash URLs (`#/settings`), so no server rewrites are
needed — a plain static host is enough.

Because your data lives in the browser, the deployed site starts empty. Move your data in with **Settings → Import app
data** (from an exported backup) or gist sync — nothing personal is ever built into the site or committed to the repo.

## Adding programs

Settings → Add a program. Works for hotel currencies, other airlines, anything with a point balance.
