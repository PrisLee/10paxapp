/**
 * validStart() only checked the *shape* of the date, so month 13 and
 * February 31st were accepted. `start` anchors the whole slot grid, so a
 * date that does not exist puts every day label and every stored mask on a
 * window nobody can reason about.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { call, makeGroup, asOwner, freshDb } from "./helpers.mjs";

let db;
beforeEach(() => { db = freshDb(); });
afterEach(() => { db.close(); });

const IMPOSSIBLE = [
  "2026-13-45", // month and day both past the end
  "2026-00-10", // there is no month zero
  "2026-02-31", // February never has 31 days
  "2026-02-30",
  "2027-02-29", // 2027 is not a leap year
  "2026-04-31", // April has 30
  "2026-06-31",
  "2026-09-00", // there is no day zero
  "2026-12-32",
];

const REAL = [
  "2026-09-07", // a Monday
  "2026-01-01",
  "2026-12-31",
  "2028-02-29", // 2028 is a leap year
];

describe("`start` has to be a date that exists", () => {
  for (const start of IMPOSSIBLE) {
    test(`POST rejects ${start}`, async () => {
      const { status, data } = await call(db, "POST", "/api/groups", {
        body: { start, weeks: 1, members: ["Ana", "Ben"] },
      });
      assert.equal(status, 400);
      assert.match(data.error, /start must look like/);
    });

    test(`PATCH rejects ${start}`, async () => {
      const { gid, ownerToken } = await makeGroup(db);
      const { status } = await call(db, "PATCH", `/api/groups/${gid}`, {
        body: { start }, headers: asOwner(ownerToken),
      });
      assert.equal(status, 400);
    });
  }

  for (const start of REAL) {
    test(`a real date is still accepted: ${start}`, async () => {
      const { status, data } = await call(db, "POST", "/api/groups", {
        body: { start, weeks: 1, members: ["Ana", "Ben"] },
      });
      assert.equal(status, 201, data?.error);
      assert.equal(data.group.start, start);
    });
  }

  test("an impossible date never reaches the database", async () => {
    await call(db, "POST", "/api/groups", {
      body: { start: "2026-02-31", weeks: 1, members: ["Ana", "Ben"] },
    });
    const row = await db.prepare("SELECT COUNT(*) AS n FROM groups").first();
    assert.equal(row.n, 0);
  });

  test("the shape check still runs first", async () => {
    for (const start of ["", "2026-9-7", "26-09-07", "2026-09-07T00:00", "not-a-date"]) {
      const { status } = await call(db, "POST", "/api/groups", {
        body: { start, weeks: 1, members: ["Ana", "Ben"] },
      });
      assert.equal(status, 400, start);
    }
  });
});
