# 10 Pax

Find the one day a small friend group is actually free — without asking anyone to
make an account or post anything publicly.

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
4. **Photos** — appears once a time is confirmed. Tap the green banner to reach it.

### Theme

Light / dark / auto, cycled from the button in the masthead and remembered per
device. Auto follows the viewer's OS setting.

No accounts, no backend, no analytics. A viewer's own selections and the codes an
organiser collects are kept in that browser's `localStorage` only.

### Why codes instead of live shared state

A published Claude Artifact that declares the `db` capability (shared, realtime state
across viewers) is organization-internal — every viewer must be a signed-in member of
the owner's org. That rules it out for friends without accounts, which is precisely
the group this is for. Passing a short code back through the chat the group already
uses needs nothing from anybody.

### Code format

`PAX-<member index, base36>-<unavailable-slot bitmask, base36>-<checksum>`

Each day contributes as many bits as it has slots (4 on a weekday, 12 at the weekend),
laid end to end from the roster's start Monday — so a code is only meaningful against
the roster it was generated from. A mistyped or stale code is
rejected rather than silently misread.

## Device boundaries (what a static page can't do)

Two features are real but device-local, and both need the hosted version to work the
way you'd want:

- **Finish** records the answer in that person's own browser. It fills in Group view
  on *their* device. Pasting the code into the chat is still the only way an answer
  crosses to the organiser's device.
- **Photos** are stored in the viewer's own IndexedDB (downscaled to 1600px on
  import). Nothing is uploaded; nobody else can see them. A genuinely shared album
  needs real identity — you have to know who may see the photos — and real storage.

`db` (shared realtime state) and `assets` (artifact-hosted uploads) are both
organization-internal: every viewer must be a signed-in member of the owner's org.
That excludes exactly the account-less friends this is built for, which is why neither
is used.

## Not built yet

- A hosted backend, which is what removes both boundaries above: answers landing
  directly in the organiser's Group view, and one shared album for the group.
