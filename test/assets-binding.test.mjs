/**
 * The asset fall-through sits above the try/catch that guards every other
 * path, so `env.ASSETS.fetch(request)` threw straight out of the handler when
 * the binding was missing or the asset service failed: a bare runtime error,
 * no log line, and none of the structured logging the API paths get.
 *
 * The DB binding was already guarded a few lines further down. This is the
 * same guard for ASSETS.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { freshDb } from "./d1.mjs";

const get = (path) => new Request(`https://pax.test${path}`);

describe("the asset fall-through", () => {
  test("reports a missing ASSETS binding instead of throwing", async () => {
    const res = await worker.fetch(get("/index.html"), { DB: freshDb() });
    assert.equal(res.status, 500);
    assert.match(await res.text(), /could not load/i);
  });

  test("survives an asset service that throws", async () => {
    const env = {
      DB: freshDb(),
      ASSETS: { fetch: async () => { throw new Error("asset service down"); } },
    };
    const res = await worker.fetch(get("/index.html"), env);
    assert.equal(res.status, 500);
  });

  test("logs the failure so it can be found in Workers Logs", async () => {
    const lines = [];
    const original = console.error;
    console.error = (line) => lines.push(line);
    try {
      await worker.fetch(get("/index.html"), { DB: freshDb() });
    } finally {
      console.error = original;
    }
    assert.equal(lines.length, 1);
    const logged = JSON.parse(lines[0]);
    assert.equal(logged.path, "/index.html");
    assert.match(logged.error, /ASSETS/);
  });

  test("a working binding is still passed straight through", async () => {
    const env = {
      DB: freshDb(),
      ASSETS: { fetch: async () => new Response("<h1>hi</h1>", {
        status: 200, headers: { "content-type": "text/html", "x-from": "assets" },
      }) },
    };
    const res = await worker.fetch(get("/index.html"), env);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("x-from"), "assets", "headers are not rewritten");
    assert.equal(await res.text(), "<h1>hi</h1>");
  });

  test("a 404 from the asset service is relayed, not turned into a 500", async () => {
    const env = {
      DB: freshDb(),
      ASSETS: { fetch: async () => new Response("nope", { status: 404 }) },
    };
    const res = await worker.fetch(get("/missing.png"), env);
    assert.equal(res.status, 404);
  });

  test("API paths never touch the asset binding", async () => {
    const env = {
      DB: freshDb(),
      ASSETS: { fetch: async () => { throw new Error("must not be called"); } },
    };
    assert.equal((await worker.fetch(get("/api/health"), env)).status, 200);
    assert.equal((await worker.fetch(get("/api/nope"), env)).status, 404);
  });
});
