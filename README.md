# 10 Pax

Find the one day a small friend group is actually free — without asking anyone to
make an account or post anything publicly.

**Live:** https://prislee.github.io/10paxapp/ (link-and-codes mode until the Worker is
deployed — see [SETUP.md](SETUP.md))

## The problem this is for

A closed group of ~10 friends can't converge on a date: availability is fragmented
and the negotiation happens in a chat thread where nobody can see the overlap. Some
members aren't on social media at all, so anything that requires a signup or a public
profile excludes them.

## v2 — the scheduling wedge, at the hour

`artifact/10pax.html` is a single, dependency-free page:

1. **Roster** — the organiser sets the group name, the names (one per line), the start
   Monday and how many weeks to look at. This produces a share link; the whole roster
   travels inside the URL fragment, so no server holds it.
2. **Your days** — a friend opens the link, picks their name, taps a day to open its
   hours, and crosses out what doesn't work. **Finish** puts the answer straight into
   Group view. Meeting windows are weekday evenings 6–10pm (4 hourly slots) and
   weekends 10am–10pm (12 slots).
3. **Group view** — one row per day showing that day's *best hour*, ranked by how few
   people are out, plus who's out and who hasn't answered. **Confirm** locks a
   day+hour in.
4. **Lock it in** — the chosen day and hour rides in the link, so re-copying the link
   tells everyone what was decided.

### Look and feel

Deliberately loud: lilac ground, grape/mint/sun/coral doing semantic work (mint =
everyone free, sun = a couple out, coral = can't make it), one hue per person on the
roster, Fredoka for headings and Space Mono for hours and codes. Light / dark / auto
cycles from the masthead button and is remembered per device.

Copy is deliberately informal. It was checked with the
[unslop](https://github.com/theclaymethod/unslop) skill's scanners —
`banned_phrase_scan`, `structure_scan`, `silhouette_scan`, `readability_metrics` — which
report zero banned phrases, no structure flags, and a staccato share of 0.0 (loosening
the register must not produce choppy anti-slop prose).

No accounts, no backend, no analytics. A viewer's own selections and the codes an
organiser collects are kept in that browser's `localStorage` only.

### Why codes instead of live shared state

A published Claude Artifact that declares the `db` capability (shared, realtime state
across viewers) is organization-internal — every viewer must be a signed-in member of
the owner's org. That rules it out for friends without accounts, which is precisely
the group this is for. Passing a short code back through the chat the group already
uses needs nothing from anybody.

### Building the hosted page

`artifact/10pax.html` is the single source. It is authored as a fragment because the
Claude Artifact tool supplies the `<!doctype>`/`<head>`/`<body>` skeleton at publish
time; GitHub Pages serves raw files, so `build.py` rebuilds that skeleton around the
same source and writes `index.html`. After editing the artifact:

```bash
python3 build.py     # regenerates both generated pages
npm run dev          # local Worker + local D1 at http://localhost:8787
npm run deploy       # build, then wrangler deploy
```

Do not edit `index.html` or `public/index.html` by hand — both are generated from
`artifact/10pax.html` and will be overwritten.

### Code format

`PAX-<member index, base36>-<unavailable-slot bitmask, base36>-<checksum>`

Each day contributes as many bits as it has slots (4 on a weekday, 12 at the weekend),
laid end to end from the roster's start Monday — so a code is only meaningful against
the roster it was generated from. A mistyped or stale code is
rejected rather than silently misread.

## Layout

    artifact/10pax.html   the app: one file, no build step, no dependencies
    worker/index.js       the API, and the Worker that serves the app
    schema.sql            D1 tables
    wrangler.jsonc        Worker config (assets + D1 binding + observability)
    build.py              wraps the artifact fragment into standalone pages
    public/index.html     generated: served by the Worker
    index.html            generated: the GitHub Pages mirror

## Two modes

The badge in the top corner says which one you are in.

**THIS DEVICE** — no API behind the page. The roster rides inside the share link and
answers travel as copy-paste codes. Every CRUD operation works, but only in the browser
doing it. This is the mode the claude.ai artifact copy runs in, and the Pages mirror
until `pax-api.js` points at a deployed Worker.

**LIVE** — one shared group in D1. Answers arrive on their own, Group view updates as
people reply, the codes disappear from the UI, and the server enforces who may change
what. See [SETUP.md](SETUP.md).

One source file does both: the app probes `GET /api/health` at boot, and every write
goes through `saveGroup` / `saveAnswer` / `dropAnswer` / `addMemberRemote` and friends,
which branch on `cloud.on`.

## Data model

    groups    id, name, start, weeks, pick_day, pick_hour, owner_hash, created_at, updated_at
    members   group_id, id, name, ord, claim_hash
    answers   group_id, member_id, mask, updated_at

Members are rows with stable ids, not names in a list, so renaming somebody keeps their
answer attached. `mask` is the blocked-hours bitmask as a decimal string.

## API

    POST   /api/groups                                  create            -> group + ownerToken
    GET    /api/groups/:gid                             read                anyone with the link
    PATCH  /api/groups/:gid                             name/dates/pick   [owner]
    DELETE /api/groups/:gid                             delete            [owner]
    POST   /api/groups/:gid/members                     add               [owner]
    PATCH  /api/groups/:gid/members/:mid                rename            [owner]
    DELETE /api/groups/:gid/members/:mid                remove            [owner]
    POST   /api/groups/:gid/members/:mid/claim          claim a name        first device wins
    PUT    /api/groups/:gid/answers/:mid                answer            [claim or owner]
    DELETE /api/groups/:gid/answers/:mid                withdraw          [claim or owner]
    DELETE /api/groups/:gid/answers                     clear all         [owner]

Updates reach other people by polling `GET /api/groups/:gid` every 8 seconds, only while
a tab is open and visible.

| | Create | Read | Update | Delete |
|---|---|---|---|---|
| Group | Make it shared | anyone with the link | name, dates | Delete this group |
| Member | Add | in the roster | rename in place | × on the row |
| Answer | Done! | Group view, live | Done! again | Start over, or × on a pill |
| Decision | Lock it in | everyone | pick another | Lock it in again |

### One destructive edit, on purpose

An answer is a bitmask over one exact date window. Move `start` or `weeks` and every
stored mask means something different, so saving new dates **clears every answer** and
says so. Adding, renaming and removing people is safe by contrast — that is why the
local storage key excludes the member list.

### Access model

Enforced in the Worker, so editing the page gets you nowhere:

- **Reading** is open to anyone with the link. Group ids are 22 random characters and
  are never listed, so they cannot be guessed or enumerated.
- **Answering as a name** belongs to the first device to claim it. Claiming returns a
  token; only that token can change or withdraw that answer.
- **The roster, the dates and deleting the group** need the owner token, handed out once
  when the group is created.

Tokens are compared as SHA-256 hashes in constant time. The honest limits: anyone with
the link can read everything, and losing the owner token (clearing browser data) means
losing the ability to edit that group.

## Not built yet

- Accounts. Without them a lost owner token is unrecoverable and a claimed name cannot
  be reassigned without removing and re-adding the person.
- Photo sharing. Dropped from scope.
