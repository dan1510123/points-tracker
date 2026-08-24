# Points Tracker

A local-only ledger of the points you **have** and the points you've **ever used**, across Amex, Chase, Delta, Bilt, Alaska, and anything else you add.

No optimizer, no offers, no card-application tracking. Two questions only: what do I hold, and what did I spend?

Runs entirely on your machine. No accounts, no credentials, no cloud. Data lives in `data/store.json`.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5173

`npm run dev` starts two processes: the API server on port 5174 (which owns the data file) and the Vite dev server on 5173 (which proxies `/api` to it).

To run it as a single process instead:

```bash
npm run build
npm start          # serves the built app + API on http://localhost:5174
```

## How value is calculated

Value is always **points × your cents-per-point setting**. Nothing is inferred from your data — no back-solving a rate from what you booked. You set the number on the **Settings** page, per program, with a global default for anything left blank. Change a rate and every figure in the app updates.

This is the main thing that differs from commercial trackers, which apply their own valuations.

## Pages

- **Dashboard** — points held vs. used, value by year, cumulative value, where the points went, biggest redemptions
- **Points I have** — current balance per program, entered by hand; each save records a dated snapshot so a trend builds over time, plus points earned all time per program
- **Points I've used** — the redemption ledger: add, edit, filter, search — and transfers to partners, plus a duplicate check over everything logged
- **Import CSV** — bulk-backfill redemption history from a CSV or JSON file
- **Settings** — cents-per-point per program, add/remove programs, backup and restore

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

```
data/store.json        everything
data/backups/          timestamped copies
```

`data/` is gitignored. The server writes atomically (temp file + rename), so an interrupted save can't leave you with a half-written store, and an unreadable file gets quarantined into `backups/` rather than overwritten.

Settings → **Write a backup** makes a copy on demand; **Download JSON** and **Restore from a JSON export** move data between machines.

## Adding programs

Settings → Add a program. Works for hotel currencies, other airlines, anything with a point balance.
# points-tracker
