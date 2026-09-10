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

Do not edit `index.html` by hand — it is generated and will be overwritten.

### Code format

`PAX-<member index, base36>-<unavailable-slot bitmask, base36>-<checksum>`

Each day contributes as many bits as it has slots (4 on a weekday, 12 at the weekend),
laid end to end from the roster's start Monday — so a code is only meaningful against
the roster it was generated from. A mistyped or stale code is
rejected rather than silently misread.

## The device boundary

**Done** records the answer in that person's own browser, so it fills in Group view on
*their* phone. Pasting the code into the chat is still the only way an answer crosses
to the organiser's device.

The reason is that `db` — shared realtime state for a published artifact — is
organization-internal: every viewer has to be a signed-in member of the owner's org.
That excludes exactly the account-less friends this is built for.

## Not built yet

- A hosted backend, which is what removes the boundary above: answers landing straight
  in the organiser's Group view instead of travelling as codes.
- Photo sharing. Dropped from scope; a closed group album needs real identity and real
  storage, so it belongs in that hosted app rather than a static page.
