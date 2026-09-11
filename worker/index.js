/**
 * 10 Pax API — Cloudflare Worker + D1.
 *
 * Serves the app from ./public (see wrangler.jsonc `assets`) and answers
 * /api/* here. Same origin, so the browser makes no cross-origin request;
 * CORS headers exist only so the GitHub Pages mirror can reach this API too.
 *
 * ACCESS MODEL — enforced here, on the server:
 *
 *   Reading a group      anyone holding the link. The group id is 22 random
 *                        characters and is never listed, so it cannot be guessed.
 *   Editing the roster,  the organiser only, proving it with the owner token
 *   dates, or deleting   returned once when the group is created.
 *   Answering as someone the first device to claim that name gets a token, and
 *                        only that token can change or withdraw the answer.
 *
 * So a friend with the link can answer as themselves and read everything, but
 * cannot answer as somebody else, rewrite the roster, or delete the group.
 */

const MAX_NAME = 40;
const MAX_GROUP_NAME = 60;
const MAX_MEMBERS = 30;
const MAX_MASK = 400;
const WEEKEND_FROM = 10;   // weekends run 10am-10pm
const WEEKDAY_FROM = 18;   // weeknights run 6-10pm
const UNTIL = 22;
const CREATE_LIMIT = 20;           // groups per bucket per window
const CREATE_WINDOW_MS = 3600_000; // one hour

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PATCH,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,x-pax-owner,x-pax-claim",
  "access-control-max-age": "86400",
};

/* ---------- helpers ---------- */

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...extra },
  });
}

function fail(status, message) {
  return json({ error: message }, status);
}

function token() {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function shortId(len) {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789";
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  let out = "";
  for (const b of buf) out += abc[b % 36];
  return out;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time compare, so a wrong token leaks nothing through timing. */
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  if (crypto.subtle.timingSafeEqual) return crypto.subtle.timingSafeEqual(x, y);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function cleanName(v, cap) {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, cap);
}

function validStart(v) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ""));
}

function validWeeks(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 8 ? n : null;
}

/** Day offsets are always from a Monday, so day % 7 gives the weekday. */
function firstHourOf(day) {
  return (day % 7) >= 5 ? WEEKEND_FROM : WEEKDAY_FROM;
}

function validPick(pick, weeks) {
  if (pick === null || pick === undefined) return null;
  const day = Math.round(Number(pick.day));
  const hour = Math.round(Number(pick.hour));
  if (!Number.isFinite(day) || !Number.isFinite(hour)) return undefined;
  if (day < 0 || day >= weeks * 7) return undefined;
  // The hour has to be one THIS day actually offers. A global 10..22 check
  // would accept 10am on a weeknight, which the client then cannot locate in
  // that day's slot list, and it silently reports another day's tally.
  if (hour < firstHourOf(day) || hour >= UNTIL) return undefined;
  return { day, hour };
}

/**
 * Rolling per-bucket limit on group creation. Creating a group needs no
 * credentials by design, so without this anyone can script it until the
 * database is full. Turnstile is the stronger answer; this needs no setup.
 */
async function overCreateLimit(db, request) {
  const bucket = request.headers.get("cf-connecting-ip") || "local";
  const now = Date.now();
  const row = await db.prepare(
    "INSERT INTO rate (bucket, hits, window_start) VALUES (?, 1, ?)" +
    " ON CONFLICT (bucket) DO UPDATE SET" +
    "   hits = CASE WHEN ? - rate.window_start >= ? THEN 1 ELSE rate.hits + 1 END," +
    "   window_start = CASE WHEN ? - rate.window_start >= ? THEN ? ELSE rate.window_start END" +
    " RETURNING hits, window_start"
  ).bind(bucket, now, now, CREATE_WINDOW_MS, now, CREATE_WINDOW_MS, now).first();

  if (!row || row.hits <= CREATE_LIMIT) return null;
  const retryAfter = Math.max(1, Math.ceil((row.window_start + CREATE_WINDOW_MS - now) / 1000));
  return json(
    { error: `That is a lot of groups in one go. Try again in ${Math.ceil(retryAfter / 60)} minutes.` },
    429,
    { "retry-after": String(retryAfter) }
  );
}

async function body(request) {
  try {
    const v = await request.json();
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/* ---------- reads ---------- */

async function readGroup(db, gid) {
  const group = await db.prepare(
    "SELECT id, name, start, weeks, pick_day, pick_hour, updated_at FROM groups WHERE id = ? LIMIT 1"
  ).bind(gid).first();
  if (!group) return null;

  const [members, answers] = await Promise.all([
    db.prepare("SELECT id, name, claim_hash IS NOT NULL AS claimed FROM members WHERE group_id = ? ORDER BY ord")
      .bind(gid).all(),
    db.prepare("SELECT member_id, mask FROM answers WHERE group_id = ?").bind(gid).all(),
  ]);

  const out = {};
  for (const row of answers.results ?? []) out[row.member_id] = row.mask;

  return {
    group: {
      id: group.id,
      name: group.name,
      start: group.start,
      weeks: group.weeks,
      pick: group.pick_day === null || group.pick_day === undefined
        ? null
        : { day: group.pick_day, hour: group.pick_hour },
      updatedAt: group.updated_at,
    },
    members: (members.results ?? []).map((m) => ({ id: m.id, name: m.name, claimed: !!m.claimed })),
    answers: out,
  };
}

async function touch(db, gid) {
  await db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").bind(Date.now(), gid).run();
}

/* ---------- auth ---------- */

async function isOwner(db, gid, request) {
  const supplied = request.headers.get("x-pax-owner");
  if (!supplied) return false;
  const row = await db.prepare("SELECT owner_hash FROM groups WHERE id = ? LIMIT 1").bind(gid).first();
  if (!row) return false;
  return sameSecret(await sha256(supplied), row.owner_hash);
}

/** An unclaimed name is open to whoever answers first; a claimed one needs its token. */
async function mayAnswerAs(db, gid, mid, request) {
  const row = await db.prepare("SELECT claim_hash FROM members WHERE group_id = ? AND id = ? LIMIT 1")
    .bind(gid, mid).first();
  if (!row) return { ok: false, status: 404, message: "That person is not on this list." };
  if (!row.claim_hash) return { ok: true };
  const supplied = request.headers.get("x-pax-claim");
  if (supplied && sameSecret(await sha256(supplied), row.claim_hash)) return { ok: true };
  return { ok: false, status: 403, message: "Somebody already answered as this person on another device." };
}

/* ---------- routes ---------- */

async function createGroup(db, request) {
  const limited = await overCreateLimit(db, request);
  if (limited) return limited;

  const b = await body(request);
  if (!b) return fail(400, "Send a JSON body.");

  const weeks = validWeeks(b.weeks);
  if (!weeks) return fail(400, "weeks must be a whole number from 1 to 8.");
  if (!validStart(b.start)) return fail(400, "start must look like 2026-09-07.");

  const names = Array.isArray(b.members) ? b.members : [];
  const members = names
    .map((m) => cleanName(typeof m === "string" ? m : m?.name, MAX_NAME))
    .filter(Boolean)
    .slice(0, MAX_MEMBERS);
  if (members.length < 2) return fail(400, "A group needs at least two people.");

  const gid = shortId(22);
  const ownerToken = token();
  const now = Date.now();

  const stmts = [
    db.prepare(
      "INSERT INTO groups (id, name, start, weeks, pick_day, pick_hour, owner_hash, created_at, updated_at)" +
      " VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?)"
    ).bind(gid, cleanName(b.name, MAX_GROUP_NAME), b.start, weeks, await sha256(ownerToken), now, now),
  ];
  members.forEach((name, i) => {
    stmts.push(
      db.prepare("INSERT INTO members (group_id, id, name, ord, claim_hash) VALUES (?, ?, ?, ?, NULL)")
        .bind(gid, shortId(8), name, i)
    );
  });

  await db.batch(stmts);
  const state = await readGroup(db, gid);
  return json({ ...state, ownerToken }, 201);
}

async function patchGroup(db, gid, request) {
  const b = await body(request);
  if (!b) return fail(400, "Send a JSON body.");

  const current = await db.prepare("SELECT name, start, weeks FROM groups WHERE id = ? LIMIT 1").bind(gid).first();
  if (!current) return fail(404, "No such group.");

  const name = b.name === undefined ? current.name : cleanName(b.name, MAX_GROUP_NAME);
  const start = b.start === undefined ? current.start : String(b.start);
  if (!validStart(start)) return fail(400, "start must look like 2026-09-07.");
  const weeks = b.weeks === undefined ? current.weeks : validWeeks(b.weeks);
  if (!weeks) return fail(400, "weeks must be a whole number from 1 to 8.");

  // An answer is a bitmask over one exact date window. Move the window and every
  // stored mask means something else, so the answers cannot survive it.
  const windowMoved = start !== current.start || weeks !== current.weeks;

  let pick = b.pick === undefined ? undefined : validPick(b.pick, weeks);
  if (pick === undefined && b.pick !== undefined) return fail(400, "That pick is outside the date window.");
  if (windowMoved) pick = null;

  const stmts = [];
  if (pick === undefined) {
    stmts.push(db.prepare("UPDATE groups SET name = ?, start = ?, weeks = ?, updated_at = ? WHERE id = ?")
      .bind(name, start, weeks, Date.now(), gid));
  } else {
    stmts.push(db.prepare(
      "UPDATE groups SET name = ?, start = ?, weeks = ?, pick_day = ?, pick_hour = ?, updated_at = ? WHERE id = ?"
    ).bind(name, start, weeks, pick ? pick.day : null, pick ? pick.hour : null, Date.now(), gid));
  }
  if (windowMoved) stmts.push(db.prepare("DELETE FROM answers WHERE group_id = ?").bind(gid));

  // batch() is one transaction: the answers never disappear without the dates moving.
  await db.batch(stmts);
  return json({ ...(await readGroup(db, gid)), clearedAnswers: windowMoved });
}

async function addMember(db, gid, request) {
  const b = await body(request);
  const name = cleanName(b?.name, MAX_NAME);
  if (!name) return fail(400, "Give the person a name.");

  const count = await db.prepare("SELECT COUNT(*) AS n FROM members WHERE group_id = ?").bind(gid).first();
  if ((count?.n ?? 0) >= MAX_MEMBERS) return fail(409, `A group tops out at ${MAX_MEMBERS} people.`);

  const top = await db.prepare("SELECT COALESCE(MAX(ord), -1) AS m FROM members WHERE group_id = ?").bind(gid).first();
  const mid = shortId(8);
  await db.prepare("INSERT INTO members (group_id, id, name, ord, claim_hash) VALUES (?, ?, ?, ?, NULL)")
    .bind(gid, mid, name, (top?.m ?? -1) + 1).run();
  await touch(db, gid);
  return json({ ...(await readGroup(db, gid)), added: mid }, 201);
}

async function renameMember(db, gid, mid, request) {
  const b = await body(request);
  const name = cleanName(b?.name, MAX_NAME);
  if (!name) return fail(400, "Give the person a name.");
  // Renaming touches only `name`, so the answer keyed to this id stays attached.
  const res = await db.prepare("UPDATE members SET name = ? WHERE group_id = ? AND id = ?")
    .bind(name, gid, mid).run();
  if (!res.meta.changes) return fail(404, "That person is not on this list.");
  await touch(db, gid);
  return json(await readGroup(db, gid));
}

async function removeMember(db, gid, mid) {
  const res = await db.batch([
    db.prepare("DELETE FROM answers WHERE group_id = ? AND member_id = ?").bind(gid, mid),
    db.prepare("DELETE FROM members WHERE group_id = ? AND id = ?").bind(gid, mid),
  ]);
  if (!res[1].meta.changes) return fail(404, "That person is not on this list.");
  await touch(db, gid);
  return json(await readGroup(db, gid));
}

async function claimMember(db, gid, mid) {
  const row = await db.prepare("SELECT claim_hash FROM members WHERE group_id = ? AND id = ? LIMIT 1")
    .bind(gid, mid).first();
  if (!row) return fail(404, "That person is not on this list.");
  if (row.claim_hash) return fail(409, "Somebody already answered as this person on another device.");

  const claimToken = token();
  // Guarded UPDATE: two devices claiming at once, only the first one lands.
  const res = await db.prepare("UPDATE members SET claim_hash = ? WHERE group_id = ? AND id = ? AND claim_hash IS NULL")
    .bind(await sha256(claimToken), gid, mid).run();
  if (!res.meta.changes) return fail(409, "Somebody claimed that name a moment before you.");
  return json({ claimToken }, 201);
}

async function putAnswer(db, gid, mid, request) {
  const b = await body(request);
  const mask = String(b?.mask ?? "");
  if (!/^[0-9]{1,400}$/.test(mask) || mask.length > MAX_MASK) return fail(400, "That answer is not a valid mask.");

  const exists = await db.prepare("SELECT 1 AS ok FROM members WHERE group_id = ? AND id = ? LIMIT 1")
    .bind(gid, mid).first();
  if (!exists) return fail(404, "That person is not on this list.");

  await db.prepare(
    "INSERT INTO answers (group_id, member_id, mask, updated_at) VALUES (?, ?, ?, ?)" +
    " ON CONFLICT (group_id, member_id) DO UPDATE SET mask = excluded.mask, updated_at = excluded.updated_at"
  ).bind(gid, mid, mask, Date.now()).run();
  await touch(db, gid);
  return json(await readGroup(db, gid));
}

/* ---------- entry ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // This sits above the try/catch below, so it needs its own: a missing
    // binding or a failing asset service used to throw straight out of the
    // handler, with none of the logging the API paths get. env.DB is already
    // guarded a few lines down; this is the same guard for env.ASSETS.
    if (!path.startsWith("/api/")) {
      try {
        if (!env.ASSETS) throw new Error("this Worker has no ASSETS binding");
        return await env.ASSETS.fetch(request);
      } catch (err) {
        console.error(JSON.stringify({ msg: "asset_error", path, error: String(err && err.message || err) }));
        // Plain text, not the API's JSON shape: a browser asked for a page.
        return new Response("Could not load that page.", {
          status: 500,
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
        });
      }
    }
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (path === "/api/health") return json({ ok: true });

    const db = env.DB;
    if (!db) return fail(500, "This Worker has no database bound to it.");

    const parts = path.replace(/^\/api\/?/, "").split("/").filter(Boolean);
    const method = request.method;

    try {
      if (parts[0] !== "groups") return fail(404, "No such endpoint.");

      // POST /api/groups
      if (parts.length === 1) {
        if (method !== "POST") return fail(405, "Use POST to make a group.");
        return await createGroup(db, request);
      }

      const gid = parts[1];
      if (!/^[a-z0-9]{6,40}$/.test(gid)) return fail(400, "That group id is malformed.");

      const owner = () => isOwner(db, gid, request);
      const denyOwner = fail(403, "Only whoever set this group up can change that.");

      // /api/groups/:gid
      if (parts.length === 2) {
        if (method === "GET") {
          const state = await readGroup(db, gid);
          return state ? json(state) : fail(404, "No such group.");
        }
        if (method === "PATCH") return (await owner()) ? await patchGroup(db, gid, request) : denyOwner;
        if (method === "DELETE") {
          if (!(await owner())) return denyOwner;
          await db.batch([
            db.prepare("DELETE FROM answers WHERE group_id = ?").bind(gid),
            db.prepare("DELETE FROM members WHERE group_id = ?").bind(gid),
            db.prepare("DELETE FROM groups WHERE id = ?").bind(gid),
          ]);
          return json({ deleted: true });
        }
        return fail(405, "That method is not allowed here.");
      }

      // /api/groups/:gid/members[/:mid[/claim]]
      if (parts[2] === "members") {
        if (parts.length === 3) {
          if (method !== "POST") return fail(405, "Use POST to add somebody.");
          return (await owner()) ? await addMember(db, gid, request) : denyOwner;
        }
        const mid = parts[3];
        if (!/^[a-z0-9]{1,24}$/.test(mid)) return fail(400, "That person id is malformed.");

        if (parts.length === 5 && parts[4] === "claim") {
          if (method !== "POST") return fail(405, "Use POST to claim a name.");
          return await claimMember(db, gid, mid);
        }
        if (parts.length !== 4) return fail(404, "No such endpoint.");
        if (method === "PATCH") return (await owner()) ? await renameMember(db, gid, mid, request) : denyOwner;
        if (method === "DELETE") return (await owner()) ? await removeMember(db, gid, mid) : denyOwner;
        return fail(405, "That method is not allowed here.");
      }

      // /api/groups/:gid/answers[/:mid]
      if (parts[2] === "answers") {
        if (parts.length === 3) {
          if (method !== "DELETE") return fail(405, "Use DELETE to clear every answer.");
          if (!(await owner())) return denyOwner;
          await db.prepare("DELETE FROM answers WHERE group_id = ?").bind(gid).run();
          await touch(db, gid);
          return json(await readGroup(db, gid));
        }
        const mid = parts[3];
        if (!/^[a-z0-9]{1,24}$/.test(mid)) return fail(400, "That person id is malformed.");

        if (method === "PUT" || method === "DELETE") {
          // The organiser can clear anybody; otherwise you need that name's token.
          const allowed = (await mayAnswerAs(db, gid, mid, request));
          if (!allowed.ok && !(await owner())) return fail(allowed.status, allowed.message);
          if (method === "PUT") return await putAnswer(db, gid, mid, request);
          await db.prepare("DELETE FROM answers WHERE group_id = ? AND member_id = ?").bind(gid, mid).run();
          await touch(db, gid);
          return json(await readGroup(db, gid));
        }
        return fail(405, "That method is not allowed here.");
      }

      return fail(404, "No such endpoint.");
    } catch (err) {
      // Structured, so Workers Logs can be searched by field.
      console.error(JSON.stringify({ msg: "api_error", path, method, error: String(err && err.message || err) }));
      return fail(500, "Something broke on our side.");
    }
  },
};
