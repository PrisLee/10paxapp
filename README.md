# 10 Pax

Find the one day a small friend group is actually free — without asking anyone to
make an account or post anything publicly.

**Live:** https://prislee.github.io/10paxapp/

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
python3 build.py     # regenerates index.html
```

Do not edit `index.html` by hand — it is generated and will be overwritten. The build
also injects `firebase-config.js`, so the hosted page picks up the database while the
artifact copy stays in link-and-codes mode.

### Code format

`PAX-<member index, base36>-<unavailable-slot bitmask, base36>-<checksum>`

Each day contributes as many bits as it has slots (4 on a weekday, 12 at the weekend),
laid end to end from the roster's start Monday — so a code is only meaningful against
the roster it was generated from. A mistyped or stale code is
rejected rather than silently misread.

## Two modes

The badge in the top corner says which one you are in.

**THIS DEVICE** (no Firebase config) — the roster rides inside the share link and
answers travel as copy-paste codes. Every CRUD operation works, but only in the
browser doing it. This is also the only mode the claude.ai artifact copy can run, since
its CSP blocks Google's CDN.

**LIVE** (Firebase config filled in) — one shared Firestore group. Answers arrive on
their own and Group view updates as people reply; the codes disappear from the UI
entirely. See [SETUP.md](SETUP.md) — about five minutes in the Firebase console.

The same source file does both. `loadFirebase()` resolves `null` when there is no
config or the SDK cannot load, and every write goes through `saveGroup` / `saveAnswer` /
`dropAnswer`, which branch on `cloud.on`.

## Data model

    groups/{groupId}                      name, members[{id,name}], start, weeks, pick, updatedAt
    groups/{groupId}/answers/{memberId}   mask, name, updatedAt

Members are entities with stable ids, not names in a list, so renaming somebody keeps
their answer attached. `mask` is the blocked-hours bitmask as a decimal string.

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

"The link is the key": a group id is a long random string that lives only in the share
link, and holding the link grants read and write. [`firestore.rules`](firestore.rules)
makes group ids undiscoverable (`get` allowed, `list` denied, so the collection cannot
be enumerated) and caps the shape and size of writes. It authenticates nobody — the
trade-off for friends who will not sign up for anything. SETUP.md spells out the limits.

## Not built yet

- Real per-person identity, which is what would stop someone answering as somebody
  else and make a leaked link revocable.
- Photo sharing. Dropped from scope; a closed group album needs that identity work
  first.
