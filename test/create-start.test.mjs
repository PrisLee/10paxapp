/**
 * POST /api/groups validated `start` through String() but stored the raw
 * value, so a non-string that stringifies to a valid date passed validation
 * and then failed at the D1 bind — a 500 for what is really a bad request.
 * PATCH already coerced; this pins both to the same behaviour.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { call, makeGroup, asOwner, freshDb, MONDAY } from "./helpers.mjs";

let db;
beforeEach(() => { db = freshDb(); });
afterEach(() => { db.close(); });

// Both survive JSON and pass `validStart`, because String(v) matches the date
// shape — but neither is a string D1 can bind. (An object with a custom
// toString cannot get here: JSON.stringify drops the method.)
const STRINGIFY_TO_A_DATE = [
  [MONDAY],
  [[MONDAY]],
];

describe("POST /api/groups stores `start` as a string", () => {
  for (const [i, start] of STRINGIFY_TO_A_DATE.entries()) {
    test(`a non-string start does not reach the database (case ${i + 1})`, async () => {
      const { status } = await call(db, "POST", "/api/groups", {
        body: { start, weeks: 1, members: ["Ana", "Ben"] },
      });
      assert.notEqual(status, 500, "a bad request must not surface as a server error");
      assert.equal(status, 201);
    });

    test(`a non-string start is normalised on the way in (case ${i + 1})`, async () => {
      const { data } = await call(db, "POST", "/api/groups", {
        body: { start, weeks: 1, members: ["Ana", "Ben"] },
      });
      assert.equal(data.group.start, MONDAY);
      assert.equal(typeof data.group.start, "string");
      const row = await db.prepare("SELECT start FROM groups WHERE id = ?").bind(data.group.id).first();
      assert.equal(row.start, MONDAY, "the stored column is a plain date string");
    });
  }

  test("PATCH already behaved this way, and still does", async () => {
    const { gid, ownerToken } = await makeGroup(db);
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { start: ["2026-09-14"] }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.equal(data.group.start, "2026-09-14");
  });

  test("a start that does not stringify to a date is still a 400", async () => {
    for (const start of [undefined, null, 42, {}, "nonsense", "07/09/2026"]) {
      const { status, data } = await call(db, "POST", "/api/groups", {
        body: { start, weeks: 1, members: ["Ana", "Ben"] },
      });
      assert.equal(status, 400, JSON.stringify(start));
      assert.match(data.error, /start must look like/);
    }
  });
});
