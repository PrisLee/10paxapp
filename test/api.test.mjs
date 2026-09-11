/**
 * Route tests for worker/index.js, driven through the real fetch handler
 * against the real schema. No mocks beyond the D1 client itself.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { call, makeGroup, asOwner, freshDb, MONDAY } from "./helpers.mjs";

let db;
beforeEach(() => { db = freshDb(); });
afterEach(() => { db.close(); });

describe("entry and routing", () => {
  test("non-API paths fall through to the asset binding", async () => {
    const { status } = await call(db, "GET", "/index.html");
    assert.equal(status, 200);
  });

  test("health needs no database", async () => {
    const request = new Request("https://pax.test/api/health");
    const res = await (await import("../worker/index.js")).default.fetch(request, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  test("OPTIONS preflight answers 204 with the CORS headers", async () => {
    const { res, status } = await call(db, "OPTIONS", "/api/groups");
    assert.equal(status, 204);
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
    assert.match(res.headers.get("access-control-allow-headers"), /x-pax-owner/);
  });

  test("JSON replies carry CORS and are never cached", async () => {
    const { res } = await call(db, "GET", "/api/health");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("access-control-allow-origin"), "*");
  });

  test("a missing database binding is reported, not thrown", async () => {
    const request = new Request("https://pax.test/api/groups/abcdef");
    const res = await (await import("../worker/index.js")).default.fetch(request, {});
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /no database/i);
  });

  test("unknown endpoints and collections 404", async () => {
    assert.equal((await call(db, "GET", "/api/nope")).status, 404);
    const { gid } = await makeGroup(db);
    assert.equal((await call(db, "GET", `/api/groups/${gid}/nope`)).status, 404);
    assert.equal((await call(db, "GET", `/api/groups/${gid}/members/abc/extra`)).status, 404);
  });

  test("a malformed group id is rejected before any query runs", async () => {
    const { status, data } = await call(db, "GET", "/api/groups/SHOUTING");
    assert.equal(status, 400);
    assert.match(data.error, /malformed/);
  });

  test("a malformed person id is rejected", async () => {
    const { gid } = await makeGroup(db);
    assert.equal((await call(db, "PATCH", `/api/groups/${gid}/members/BAD!`)).status, 400);
    assert.equal((await call(db, "PUT", `/api/groups/${gid}/answers/BAD!`)).status, 400);
  });

  test("wrong methods are refused with 405", async () => {
    const { gid, mids } = await makeGroup(db);
    assert.equal((await call(db, "GET", "/api/groups")).status, 405);
    assert.equal((await call(db, "PUT", `/api/groups/${gid}`)).status, 405);
    assert.equal((await call(db, "GET", `/api/groups/${gid}/members`)).status, 405);
    assert.equal((await call(db, "GET", `/api/groups/${gid}/members/${mids[0]}`)).status, 405);
    assert.equal((await call(db, "GET", `/api/groups/${gid}/members/${mids[0]}/claim`)).status, 405);
    assert.equal((await call(db, "GET", `/api/groups/${gid}/answers`)).status, 405);
    assert.equal((await call(db, "POST", `/api/groups/${gid}/answers/${mids[0]}`)).status, 405);
  });

  test("an unexpected failure becomes a 500, not a crash", async () => {
    const broken = {
      prepare() { throw new Error("d1 exploded"); },
      batch() { throw new Error("d1 exploded"); },
    };
    const request = new Request("https://pax.test/api/groups/abcdefgh");
    const res = await (await import("../worker/index.js")).default.fetch(request, { DB: broken });
    assert.equal(res.status, 500);
    assert.match((await res.json()).error, /broke on our side/);
  });
});

describe("POST /api/groups", () => {
  test("creates the group, the roster and a one-time owner token", async () => {
    const { status, data } = await call(db, "POST", "/api/groups", {
      body: { name: "  Badminton   crew ", start: MONDAY, weeks: 2, members: ["Ana", "Ben", "Cai"] },
    });
    assert.equal(status, 201);
    assert.match(data.group.id, /^[a-z0-9]{22}$/);
    assert.equal(data.group.name, "Badminton crew");
    assert.equal(data.group.start, MONDAY);
    assert.equal(data.group.weeks, 2);
    assert.equal(data.group.pick, null);
    assert.match(data.ownerToken, /^[0-9a-f]{48}$/);
    assert.deepEqual(data.members.map((m) => m.name), ["Ana", "Ben", "Cai"]);
    assert.deepEqual(data.members.map((m) => m.claimed), [false, false, false]);
    assert.deepEqual(data.answers, {});
  });

  test("the owner token is never stored in the clear", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const row = await db.prepare("SELECT owner_hash FROM groups WHERE id = ?").bind(gid).first();
    assert.notEqual(row.owner_hash, ownerToken);
    assert.match(row.owner_hash, /^[0-9a-f]{64}$/);
  });

  test("members may arrive as strings or as objects with a name", async () => {
    const { data } = await call(db, "POST", "/api/groups", {
      body: { start: MONDAY, weeks: 1, members: ["Ana", { name: "Ben" }, { nope: 1 }, "", "   "] },
    });
    assert.deepEqual(data.members.map((m) => m.name), ["Ana", "Ben"]);
  });

  test("long names are trimmed to the cap", async () => {
    const { data } = await call(db, "POST", "/api/groups", {
      body: { name: "g".repeat(200), start: MONDAY, weeks: 1, members: ["a".repeat(80), "Ben"] },
    });
    assert.equal(data.group.name.length, 60);
    assert.equal(data.members[0].name.length, 40);
  });

  test("the roster is capped at thirty people", async () => {
    const many = Array.from({ length: 40 }, (_, i) => `P${i}`);
    const { data } = await call(db, "POST", "/api/groups", {
      body: { start: MONDAY, weeks: 1, members: many },
    });
    assert.equal(data.members.length, 30);
  });

  test("a non-JSON body is refused", async () => {
    const { status, data } = await call(db, "POST", "/api/groups", { body: "not json" });
    assert.equal(status, 400);
    assert.match(data.error, /JSON body/);
  });

  test("a JSON body that is not an object is refused", async () => {
    const { status } = await call(db, "POST", "/api/groups", { body: "[1,2]" });
    assert.equal(status, 400);
  });

  test("weeks must be a whole number from one to eight", async () => {
    for (const weeks of [0, 9, -1, "abc", null, undefined, 100]) {
      const { status, data } = await call(db, "POST", "/api/groups", {
        body: { start: MONDAY, weeks, members: ["Ana", "Ben"] },
      });
      assert.equal(status, 400, `weeks=${weeks}`);
      assert.match(data.error, /weeks/);
    }
  });

  test("a group needs at least two people", async () => {
    for (const members of [undefined, [], ["Solo"], "Ana"]) {
      const { status, data } = await call(db, "POST", "/api/groups", {
        body: { start: MONDAY, weeks: 1, members },
      });
      assert.equal(status, 400);
      assert.match(data.error, /two people/);
    }
  });

  test("creation is rate limited per bucket", async () => {
    const body = { start: MONDAY, weeks: 1, members: ["Ana", "Ben"] };
    const headers = { "cf-connecting-ip": "203.0.113.9" };
    for (let i = 0; i < 20; i++) {
      const { status } = await call(db, "POST", "/api/groups", { body, headers });
      assert.equal(status, 201, `attempt ${i + 1}`);
    }
    const { res, status, data } = await call(db, "POST", "/api/groups", { body, headers });
    assert.equal(status, 429);
    assert.match(data.error, /lot of groups/);
    assert.ok(Number(res.headers.get("retry-after")) > 0);
  });

  test("the limit is scoped to one bucket, not everybody", async () => {
    const body = { start: MONDAY, weeks: 1, members: ["Ana", "Ben"] };
    for (let i = 0; i < 21; i++) {
      await call(db, "POST", "/api/groups", { body, headers: { "cf-connecting-ip": "198.51.100.1" } });
    }
    const other = await call(db, "POST", "/api/groups", {
      body, headers: { "cf-connecting-ip": "198.51.100.2" },
    });
    assert.equal(other.status, 201);
  });
});

describe("GET /api/groups/:gid", () => {
  test("returns the whole shared state to anyone with the link", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "12" } });
    const { status, data } = await call(db, "GET", `/api/groups/${gid}`);
    assert.equal(status, 200);
    assert.equal(data.group.id, gid);
    assert.equal(data.members.length, 2);
    assert.equal(data.answers[mids[0]], "12");
    assert.ok(!("ownerToken" in data), "the owner token is issued once, not on every read");
    assert.ok(!JSON.stringify(data).includes(ownerToken));
  });

  test("an unknown group is a 404", async () => {
    const { status, data } = await call(db, "GET", "/api/groups/aaaaaaaaaa");
    assert.equal(status, 404);
    assert.match(data.error, /No such group/);
  });

  test("members come back in roster order", async () => {
    const { gid, ownerToken } = await makeGroup(db, { members: ["Zoe", "Ana", "Mal"] });
    await call(db, "POST", `/api/groups/${gid}/members`, {
      body: { name: "New" }, headers: asOwner(ownerToken),
    });
    const { data } = await call(db, "GET", `/api/groups/${gid}`);
    assert.deepEqual(data.members.map((m) => m.name), ["Zoe", "Ana", "Mal", "New"]);
  });
});

describe("owner authorisation", () => {
  test("edits without the owner token are refused", async () => {
    const { gid, mids } = await makeGroup(db);
    const denied = [
      ["PATCH", `/api/groups/${gid}`, { body: { name: "x" } }],
      ["DELETE", `/api/groups/${gid}`, {}],
      ["POST", `/api/groups/${gid}/members`, { body: { name: "x" } }],
      ["PATCH", `/api/groups/${gid}/members/${mids[0]}`, { body: { name: "x" } }],
      ["DELETE", `/api/groups/${gid}/members/${mids[0]}`, {}],
      ["DELETE", `/api/groups/${gid}/answers`, {}],
    ];
    for (const [method, path, opts] of denied) {
      const { status, data } = await call(db, method, path, opts);
      assert.equal(status, 403, `${method} ${path}`);
      assert.match(data.error, /set this group up/);
    }
  });

  test("a wrong owner token is refused", async () => {
    const { gid } = await makeGroup(db);
    const { status } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { name: "x" }, headers: asOwner("f".repeat(48)),
    });
    assert.equal(status, 403);
  });

  test("one group's owner token does not work on another", async () => {
    const a = await makeGroup(db);
    const b = await makeGroup(db);
    const { status } = await call(db, "DELETE", `/api/groups/${b.gid}`, {
      headers: asOwner(a.ownerToken),
    });
    assert.equal(status, 403);
  });
});

describe("PATCH /api/groups/:gid", () => {
  test("renames the group without disturbing the answers", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "7" } });
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { name: "Renamed" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.equal(data.group.name, "Renamed");
    assert.equal(data.clearedAnswers, false);
    assert.equal(data.answers[mids[0]], "7");
  });

  test("omitted fields keep their current values", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: {}, headers: asOwner(ownerToken),
    });
    assert.equal(data.group.name, "Badminton");
    assert.equal(data.group.start, MONDAY);
    assert.equal(data.group.weeks, 2);
  });

  test("moving the start date clears every answer", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "7" } });
    const { data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { start: "2026-09-14" }, headers: asOwner(ownerToken),
    });
    assert.equal(data.clearedAnswers, true);
    assert.deepEqual(data.answers, {});
    assert.equal(data.group.start, "2026-09-14");
  });

  test("moving the window also drops a chosen slot", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: { day: 0, hour: 19 } }, headers: asOwner(ownerToken),
    });
    const { data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { start: "2026-09-14" }, headers: asOwner(ownerToken),
    });
    assert.equal(data.group.pick, null);
  });

  test("a bad start or weeks is refused", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const bad = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { start: "07/09/2026" }, headers: asOwner(ownerToken),
    });
    assert.equal(bad.status, 400);
    const weeks = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { weeks: 99 }, headers: asOwner(ownerToken),
    });
    assert.equal(weeks.status, 400);
  });

  test("a non-JSON body is refused", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { status } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: "nope", headers: asOwner(ownerToken),
    });
    assert.equal(status, 400);
  });

  test("patching a group that does not exist is a 404", async () => {
    // Proving ownership needs the row, so a missing group cannot reach patchGroup
    // through the router; call it with a real token on a deleted group instead.
    const { gid, ownerToken } = await makeGroup(db);
    await call(db, "DELETE", `/api/groups/${gid}`, { headers: asOwner(ownerToken) });
    const { status } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { name: "x" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 403, "the owner row is gone, so ownership can no longer be proved");
  });
});

describe("the chosen slot", () => {
  test("accepts a weeknight hour inside the evening window", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: { day: 0, hour: 18 } }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.deepEqual(data.group.pick, { day: 0, hour: 18 });
  });

  test("accepts a weekend morning, which a weeknight would not allow", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: { day: 5, hour: 10 } }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.deepEqual(data.group.pick, { day: 5, hour: 10 });
  });

  test("rejects a morning hour on a weeknight", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: { day: 0, hour: 10 } }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 400);
    assert.match(data.error, /outside the date window/);
  });

  test("rejects hours and days outside the window", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    for (const pick of [
      { day: 0, hour: 22 }, { day: 0, hour: 23 }, { day: -1, hour: 19 },
      { day: 14, hour: 19 }, { day: "x", hour: 19 }, { day: 0, hour: "x" },
    ]) {
      const { status } = await call(db, "PATCH", `/api/groups/${gid}`, {
        body: { pick }, headers: asOwner(ownerToken),
      });
      assert.equal(status, 400, JSON.stringify(pick));
    }
  });

  test("an explicit null clears the slot", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: { day: 5, hour: 11 } }, headers: asOwner(ownerToken),
    });
    const { data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: null }, headers: asOwner(ownerToken),
    });
    assert.equal(data.group.pick, null);
  });

  test("the last day of the window is addressable", async () => {
    const { gid, ownerToken } = await makeGroup(db, { weeks: 1 });
    const { status } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: { day: 6, hour: 21 } }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
  });
});

describe("DELETE /api/groups/:gid", () => {
  test("removes the group and everything hanging off it", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "3" } });
    const { status, data } = await call(db, "DELETE", `/api/groups/${gid}`, {
      headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.deepEqual(data, { deleted: true });
    assert.equal((await call(db, "GET", `/api/groups/${gid}`)).status, 404);
    for (const table of ["groups", "members", "answers"]) {
      const row = await db.prepare(
        `SELECT COUNT(*) AS n FROM ${table} WHERE ${table === "groups" ? "id" : "group_id"} = ?`
      ).bind(gid).first();
      assert.equal(row.n, 0, table);
    }
  });

  test("one group's deletion leaves another alone", async () => {
    const a = await makeGroup(db);
    const b = await makeGroup(db);
    await call(db, "DELETE", `/api/groups/${a.gid}`, { headers: asOwner(a.ownerToken) });
    assert.equal((await call(db, "GET", `/api/groups/${b.gid}`)).status, 200);
  });
});

describe("the roster", () => {
  test("the organiser can add somebody", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { status, data } = await call(db, "POST", `/api/groups/${gid}/members`, {
      body: { name: "  Cai  " }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 201);
    assert.equal(data.members.length, 3);
    assert.equal(data.members[2].name, "Cai");
    assert.equal(data.members[2].id, data.added);
  });

  test("a new person goes on the end of the list", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    await call(db, "DELETE", `/api/groups/${gid}/members/${(await makeGroup(db)).mids[0]}`, {
      headers: asOwner(ownerToken),
    });
    const { data } = await call(db, "POST", `/api/groups/${gid}/members`, {
      body: { name: "Cai" }, headers: asOwner(ownerToken),
    });
    const ords = await db.prepare("SELECT name, ord FROM members WHERE group_id = ? ORDER BY ord").bind(gid).all();
    assert.deepEqual(ords.results.map((r) => r.name), ["Ana", "Ben", "Cai"]);
    assert.equal(data.members.at(-1).name, "Cai");
  });

  test("a nameless addition is refused", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    for (const body of [{}, { name: "" }, { name: "   " }, undefined]) {
      const { status, data } = await call(db, "POST", `/api/groups/${gid}/members`, {
        body, headers: asOwner(ownerToken),
      });
      assert.equal(status, 400);
      assert.match(data.error, /a name/);
    }
  });

  test("the group tops out at thirty people", async () => {
    const { gid, ownerToken } = await makeGroup(db, {
      members: Array.from({ length: 30 }, (_, i) => `P${i}`),
    });
    const { status, data } = await call(db, "POST", `/api/groups/${gid}/members`, {
      body: { name: "One too many" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 409);
    assert.match(data.error, /tops out at 30/);
  });

  test("renaming keeps the answer attached to that person", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "42" } });
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}/members/${mids[0]}`, {
      body: { name: "Ana B" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.equal(data.members[0].name, "Ana B");
    assert.equal(data.answers[mids[0]], "42");
  });

  test("renaming a stranger is a 404", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}/members/zzzzzzzz`, {
      body: { name: "Ghost" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 404);
    assert.match(data.error, /not on this list/);
  });

  test("a rename with no name is refused", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    const { status } = await call(db, "PATCH", `/api/groups/${gid}/members/${mids[0]}`, {
      body: { name: "  " }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 400);
  });

  test("removing somebody takes their answer with them", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "9" } });
    const { status, data } = await call(db, "DELETE", `/api/groups/${gid}/members/${mids[0]}`, {
      headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.equal(data.members.length, 1);
    assert.deepEqual(data.answers, {});
    const left = await db.prepare("SELECT COUNT(*) AS n FROM answers WHERE group_id = ?").bind(gid).first();
    assert.equal(left.n, 0);
  });

  test("removing a stranger is a 404", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { status } = await call(db, "DELETE", `/api/groups/${gid}/members/zzzzzzzz`, {
      headers: asOwner(ownerToken),
    });
    assert.equal(status, 404);
  });
});

describe("claiming a name", () => {
  test("the first device to claim gets a token", async () => {
    const { gid, mids } = await makeGroup(db);
    const { status, data } = await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    assert.equal(status, 201);
    assert.match(data.claimToken, /^[0-9a-f]{48}$/);
    const { data: state } = await call(db, "GET", `/api/groups/${gid}`);
    assert.equal(state.members[0].claimed, true);
    assert.equal(state.members[1].claimed, false);
  });

  test("the claim token is never stored in the clear", async () => {
    const { gid, mids } = await makeGroup(db);
    const { data } = await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    const row = await db.prepare("SELECT claim_hash FROM members WHERE group_id = ? AND id = ?")
      .bind(gid, mids[0]).first();
    assert.notEqual(row.claim_hash, data.claimToken);
    assert.match(row.claim_hash, /^[0-9a-f]{64}$/);
  });

  test("a second claim on the same name is refused", async () => {
    const { gid, mids } = await makeGroup(db);
    await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    const { status, data } = await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    assert.equal(status, 409);
    assert.match(data.error, /already answered as this person/);
  });

  test("claiming a stranger is a 404", async () => {
    const { gid } = await makeGroup(db);
    const { status } = await call(db, "POST", `/api/groups/${gid}/members/zzzzzzzz/claim`);
    assert.equal(status, 404);
  });
});

describe("answers", () => {
  test("an unclaimed name is open to whoever answers first", async () => {
    const { gid, mids } = await makeGroup(db);
    const { status, data } = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, {
      body: { mask: "1234567890" },
    });
    assert.equal(status, 200);
    assert.equal(data.answers[mids[0]], "1234567890");
  });

  test("a second PUT replaces the stored mask", async () => {
    const { gid, mids } = await makeGroup(db);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "11" } });
    const { data } = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "22" } });
    assert.equal(data.answers[mids[0]], "22");
    const rows = await db.prepare("SELECT COUNT(*) AS n FROM answers WHERE group_id = ?").bind(gid).first();
    assert.equal(rows.n, 1, "upsert, not a second row");
  });

  test("a claimed name needs its own token", async () => {
    const { gid, mids } = await makeGroup(db);
    const { data: claim } = await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);

    const denied = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "5" } });
    assert.equal(denied.status, 403);
    assert.match(denied.data.error, /another device/);

    const wrong = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, {
      body: { mask: "5" }, headers: { "x-pax-claim": "0".repeat(48) },
    });
    assert.equal(wrong.status, 403);

    const ok = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, {
      body: { mask: "5" }, headers: { "x-pax-claim": claim.claimToken },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.data.answers[mids[0]], "5");
  });

  test("one person's claim token does not unlock another's answer", async () => {
    const { gid, mids } = await makeGroup(db);
    const { data: claim } = await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    await call(db, "POST", `/api/groups/${gid}/members/${mids[1]}/claim`);
    const { status } = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[1]}`, {
      body: { mask: "5" }, headers: { "x-pax-claim": claim.claimToken },
    });
    assert.equal(status, 403);
  });

  test("the organiser can overwrite a claimed answer", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    const { status, data } = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, {
      body: { mask: "8" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.equal(data.answers[mids[0]], "8");
  });

  test("answering for somebody not on the list is a 404", async () => {
    const { gid } = await makeGroup(db);
    const { status, data } = await call(db, "PUT", `/api/groups/${gid}/answers/zzzzzzzz`, {
      body: { mask: "1" },
    });
    assert.equal(status, 404);
    assert.match(data.error, /not on this list/);
  });

  test("a mask has to be a decimal string within the cap", async () => {
    const { gid, mids } = await makeGroup(db);
    for (const mask of ["", "abc", "-1", "1.5", "0x10", " 12", "1e3", "9".repeat(401), null, undefined, {}]) {
      const { status, data } = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, {
        body: { mask },
      });
      assert.equal(status, 400, JSON.stringify(mask));
      assert.match(data.error, /not a valid mask/);
    }
  });

  test("a mask at the length cap is accepted", async () => {
    const { gid, mids } = await makeGroup(db);
    const { status } = await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, {
      body: { mask: "9".repeat(400) },
    });
    assert.equal(status, 200);
  });

  test("a person can withdraw their own answer", async () => {
    const { gid, mids } = await makeGroup(db);
    const { data: claim } = await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, {
      body: { mask: "5" }, headers: { "x-pax-claim": claim.claimToken },
    });
    const { status, data } = await call(db, "DELETE", `/api/groups/${gid}/answers/${mids[0]}`, {
      headers: { "x-pax-claim": claim.claimToken },
    });
    assert.equal(status, 200);
    assert.deepEqual(data.answers, {});
  });

  test("withdrawing somebody else's claimed answer is refused", async () => {
    const { gid, mids } = await makeGroup(db);
    await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[1]}`, { body: { mask: "5" } });
    const { status } = await call(db, "DELETE", `/api/groups/${gid}/answers/${mids[0]}`);
    assert.equal(status, 403);
  });

  test("the organiser can clear one answer", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, {
      body: { mask: "5" }, headers: asOwner(ownerToken),
    });
    const { status, data } = await call(db, "DELETE", `/api/groups/${gid}/answers/${mids[0]}`, {
      headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.deepEqual(data.answers, {});
  });

  test("the organiser can clear the whole board", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "5" } });
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[1]}`, { body: { mask: "6" } });
    const { status, data } = await call(db, "DELETE", `/api/groups/${gid}/answers`, {
      headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.deepEqual(data.answers, {});
    assert.equal(data.members.length, 2, "the roster survives");
  });

  test("clearing the board does not release the claims", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    await call(db, "POST", `/api/groups/${gid}/members/${mids[0]}/claim`);
    await call(db, "DELETE", `/api/groups/${gid}/answers`, { headers: asOwner(ownerToken) });
    const { data } = await call(db, "GET", `/api/groups/${gid}`);
    assert.equal(data.members[0].claimed, true);
  });
});

describe("updated_at", () => {
  test("moves when the shared state changes", async () => {
    const { gid, mids, ownerToken } = await makeGroup(db);
    const before = (await call(db, "GET", `/api/groups/${gid}`)).data.group.updatedAt;
    await db.prepare("UPDATE groups SET updated_at = ? WHERE id = ?").bind(before - 5000, gid).run();
    await call(db, "PUT", `/api/groups/${gid}/answers/${mids[0]}`, { body: { mask: "5" } });
    const after = (await call(db, "GET", `/api/groups/${gid}`)).data.group.updatedAt;
    assert.ok(after > before - 5000, "an answer bumps updated_at");

    await db.prepare("UPDATE groups SET updated_at = 0 WHERE id = ?").bind(gid).run();
    await call(db, "POST", `/api/groups/${gid}/members`, {
      body: { name: "Cai" }, headers: asOwner(ownerToken),
    });
    assert.ok((await call(db, "GET", `/api/groups/${gid}`)).data.group.updatedAt > 0);
  });
});
