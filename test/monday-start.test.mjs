/**
 * The slot grid is indexed from a Monday: firstHourOf() reads `day % 7` to
 * decide whether a day runs 10am-10pm or 6-10pm, and schema.sql documents
 * `start` as a Monday. The server never checked, so a caller could anchor a
 * group mid-week and get weekend hours on the wrong days.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { call, makeGroup, asOwner, freshDb, MONDAY } from "./helpers.mjs";

let db;
beforeEach(() => { db = freshDb(); });
afterEach(() => { db.close(); });

// The week after MONDAY (2026-09-07), by weekday.
const NOT_MONDAY = {
  Tuesday: "2026-09-08",
  Wednesday: "2026-09-09",
  Thursday: "2026-09-10",
  Friday: "2026-09-11",
  Saturday: "2026-09-12",
  Sunday: "2026-09-13",
};

describe("`start` has to be a Monday", () => {
  for (const [weekday, start] of Object.entries(NOT_MONDAY)) {
    test(`POST rejects a ${weekday}`, async () => {
      const { status, data } = await call(db, "POST", "/api/groups", {
        body: { start, weeks: 1, members: ["Ana", "Ben"] },
      });
      assert.equal(status, 400);
      assert.match(data.error, /Monday/);
    });

    test(`PATCH rejects a ${weekday}`, async () => {
      const { gid, ownerToken } = await makeGroup(db);
      const { status, data } = await call(db, "PATCH", `/api/groups/${gid}`, {
        body: { start }, headers: asOwner(ownerToken),
      });
      assert.equal(status, 400);
      assert.match(data.error, /Monday/);
    });
  }

  test("Mondays are accepted", async () => {
    for (const start of ["2026-09-07", "2026-09-14", "2026-01-05", "2027-03-01"]) {
      const { status, data } = await call(db, "POST", "/api/groups", {
        body: { start, weeks: 1, members: ["Ana", "Ben"] },
      });
      assert.equal(status, 201, `${start}: ${data?.error}`);
      assert.equal(data.group.start, start);
    }
  });

  test("a non-Monday never reaches the database", async () => {
    await call(db, "POST", "/api/groups", {
      body: { start: NOT_MONDAY.Wednesday, weeks: 1, members: ["Ana", "Ben"] },
    });
    const row = await db.prepare("SELECT COUNT(*) AS n FROM groups").first();
    assert.equal(row.n, 0);
  });

  test("the weekend is where the slot grid expects it", async () => {
    // Days 5 and 6 are the weekend and open at 10am; days 0-4 are weeknights
    // and open at 6pm. That only holds if day 0 is a Monday.
    const { gid, ownerToken } = await makeGroup(db, { start: MONDAY, weeks: 1 });
    const weekend = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: { day: 5, hour: 10 } }, headers: asOwner(ownerToken),
    });
    assert.equal(weekend.status, 200);
    const weeknight = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { pick: { day: 4, hour: 10 } }, headers: asOwner(ownerToken),
    });
    assert.equal(weeknight.status, 400);
  });
});

describe("stored dates are not retroactively invalidated", () => {
  /** Write a row straight past the API, standing in for a pre-check group. */
  async function legacyGroup(start) {
    const { gid, ownerToken } = await makeGroup(db);
    await db.prepare("UPDATE groups SET start = ? WHERE id = ?").bind(start, gid).run();
    return { gid, ownerToken };
  }

  test("a group stored on a non-Monday can still be renamed", async () => {
    const { gid, ownerToken } = await legacyGroup(NOT_MONDAY.Wednesday);
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { name: "Renamed" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200, "a new check on input must not lock an existing row");
    assert.equal(data.group.name, "Renamed");
    assert.equal(data.group.start, NOT_MONDAY.Wednesday, "left as it was");
  });

  test("a group stored on an impossible date can still be renamed", async () => {
    const { gid, ownerToken } = await legacyGroup("2026-02-31");
    const { status } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { name: "Renamed" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
  });

  test("and the organiser can repair it by sending a Monday", async () => {
    const { gid, ownerToken } = await legacyGroup(NOT_MONDAY.Wednesday);
    const { status, data } = await call(db, "PATCH", `/api/groups/${gid}`, {
      body: { start: "2026-09-14" }, headers: asOwner(ownerToken),
    });
    assert.equal(status, 200);
    assert.equal(data.group.start, "2026-09-14");
    assert.equal(data.clearedAnswers, true, "the window moved, so the masks go");
  });
});
