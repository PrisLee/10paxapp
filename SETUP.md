# Deploying 10 Pax to Cloudflare

The app already runs without any of this: open it and the badge says **THIS DEVICE**,
the roster rides inside the share link, and answers travel as copy-paste codes.

Deploy and the badge turns **LIVE**. Answers arrive on their own, the codes disappear
from the UI, and the server — not the honour system — decides who may change what.

Everything below fits inside Cloudflare's free tier.

## What gets created

| Piece | What it is |
| --- | --- |
| Worker `tenpax` | serves the app *and* the `/api` routes, one origin, no CORS |
| D1 database `pax` | three tables: `groups`, `members`, `answers` |

## 1. Log in

```bash
npx wrangler login
```

This opens a browser for your Cloudflare account. If you do not have one, the signup is
free and needs no card. Check it worked:

```bash
npx wrangler whoami
```

## 2. Create the database

```bash
npx wrangler d1 create pax
```

It prints a `database_id`. Put that value into `wrangler.jsonc`, replacing
`PUT_YOUR_DATABASE_ID_HERE`:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "pax", "database_id": "the-uuid-it-printed" }
]
```

## 3. Create the tables

```bash
npm run db:remote     # applies schema.sql to the real database
```

`npm run db:local` does the same to the local copy used by `npm run dev`. Local and
remote are separate databases; applying one never touches the other.

## 4. Deploy

```bash
npm run deploy        # runs build.py, then wrangler deploy
```

Wrangler prints the URL, something like `https://tenpax.<your-subdomain>.workers.dev`.
Open it: the badge should read **LIVE**. In Roster, press **Make it shared** to turn
your group into a shared one — answers already on your device come along. The link
changes to a short `#g=…`. Send that around.

## 5. Optional: keep the GitHub Pages link working

If you already shared the Pages URL, point it at the Worker so it keeps working. Put
the Worker URL in `pax-api.js`:

```js
window.PAX_API = "https://tenpax.<your-subdomain>.workers.dev/api";
```

Then `python3 build.py && git push`. The Worker sends permissive CORS headers, so the
Pages copy can reach the same API. Leave it blank and the Pages copy stays in
link-and-codes mode.

## Running it locally

```bash
npm run db:local      # once
npm run dev           # http://localhost:8787
```

`wrangler dev` uses a local D1 file, so nothing you do while developing touches the
deployed database.

## Who is allowed to do what

Unlike the earlier link-only version, these rules are enforced in the Worker, so a
friend cannot get around them by editing the page.

| Action | Who | How the server knows |
| --- | --- | --- |
| Read a group | anyone with the link | group ids are 22 random characters and are never listed, so they cannot be guessed or enumerated |
| Answer as yourself | the first device to claim that name | claiming returns a token; only that token can change or withdraw the answer |
| Add, rename, remove people; change dates; delete the group | the organiser | creating a group returns an owner token once, stored on that device |

Both tokens are kept in the organiser's / friend's own browser and compared as SHA-256
hashes in constant time. Consequences worth knowing:

- **Clearing your browser data loses the owner token**, and with it the ability to edit
  or delete that group. Nothing else can recover it. Make a new group.
- **The first device to answer as a name owns that name.** If a friend answers on the
  wrong person's behalf, the organiser can clear that answer (× on the pill) but the
  claim stays; remove and re-add the person to reset it.
- **Anyone with the link can still read everything.** That is the deliberate trade for
  nobody needing an account.

## Costs

The free tier covers 100,000 Worker requests a day and 5 million D1 rows read. Ten
people picking a date uses a few hundred requests. The app polls every 8 seconds only
while a tab is open and visible, so an idle tab costs nothing.

## Undeploying

```bash
npx wrangler delete                 # removes the Worker
npx wrangler d1 delete pax          # removes the database and all groups
```
