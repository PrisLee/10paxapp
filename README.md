# 10 Pax

Find the one day a small friend group is actually free — without asking anyone to
make an account or post anything publicly.

## The problem this is for

A closed group of ~10 friends can't converge on a date: availability is fragmented
and the negotiation happens in a chat thread where nobody can see the overlap. Some
members aren't on social media at all, so anything that requires a signup or a public
profile excludes them.

## v1 — the scheduling wedge

`artifact/10pax.html` is a single, dependency-free page:

1. **Roster** — the organiser sets the group name, the names (one per line), the start
   Monday and how many weeks to look at. This produces a share link; the whole roster
   travels inside the URL fragment, so no server holds it.
2. **Your days** — a friend opens the link, picks their name, and taps the days they
   *can't* make. The page gives them a short code (`PAX-3-K7X2M9-B`) to paste back
   into the group chat.
3. **Group view** — the organiser pastes the codes in. Dates rank by how few people
   are out, showing who's out on each and who hasn't replied yet.

No accounts, no backend, no analytics. A viewer's own selections and the codes an
organiser collects are kept in that browser's `localStorage` only.

### Why codes instead of live shared state

A published Claude Artifact that declares the `db` capability (shared, realtime state
across viewers) is organization-internal — every viewer must be a signed-in member of
the owner's org. That rules it out for friends without accounts, which is precisely
the group this is for. Passing a short code back through the chat the group already
uses needs nothing from anybody.

### Code format

`PAX-<member index, base36>-<unavailable-day bitmask, base36>-<checksum>`

The bitmask is over day offsets from the roster's start Monday, so a code is only
meaningful against the roster it was generated from. A mistyped or stale code is
rejected rather than silently misread.

## Not built yet

- **Private photo album.** The other half of the original problem: a closed album for
  the group, no feed and no public profiles. It needs real identity (you have to know
  who may see the photos) and real storage, so it belongs in a hosted app rather than
  a static page.
