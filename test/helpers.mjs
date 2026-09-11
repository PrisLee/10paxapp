/** Shared plumbing for the API route tests. */
import worker from "../worker/index.js";
import { freshDb, ASSETS } from "./d1.mjs";

export { freshDb };

/** A Monday, which is what the date window is always anchored to. */
export const MONDAY = "2026-09-07";

/**
 * Drive one request through the Worker's fetch handler and hand back both the
 * Response and its parsed body, since nearly every assertion wants both.
 */
export async function call(db, method, path, { body, headers = {} } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    init.headers["content-type"] = "application/json";
  }
  const request = new Request(`https://pax.test${path}`, init);
  const res = await worker.fetch(request, { DB: db, ASSETS });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { res, status: res.status, data };
}

/** Create a group and return its id, owner token and first two member ids. */
export async function makeGroup(db, overrides = {}) {
  const { status, data } = await call(db, "POST", "/api/groups", {
    body: { name: "Badminton", start: MONDAY, weeks: 2, members: ["Ana", "Ben"], ...overrides },
  });
  if (status !== 201) throw new Error(`group setup failed: ${status} ${JSON.stringify(data)}`);
  return {
    gid: data.group.id,
    ownerToken: data.ownerToken,
    members: data.members,
    mids: data.members.map((m) => m.id),
    state: data,
  };
}

export function asOwner(ownerToken) {
  return { "x-pax-owner": ownerToken };
}
