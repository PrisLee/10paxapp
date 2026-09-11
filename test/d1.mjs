/**
 * A D1 stand-in backed by node:sqlite, so the route tests run the real SQL in
 * schema.sql instead of a hand-written fake. Both ship with Node, so this adds
 * no dependencies.
 *
 * Covers the slice of the D1 client that worker/index.js actually calls:
 * prepare().bind().first()/.all()/.run(), and batch() as one transaction.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SCHEMA = fileURLToPath(new URL("../schema.sql", import.meta.url));

/** node:sqlite hands back null-prototype rows; D1 hands back plain objects. */
function plain(row) {
  return row === undefined || row === null ? null : { ...row };
}

class Stmt {
  constructor(db, sql, args = null) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }

  bind(...args) {
    return new Stmt(this.db, this.sql, args);
  }

  #prepared() {
    let s = this.db.cache.get(this.sql);
    if (!s) {
      s = this.db.raw.prepare(this.sql);
      this.db.cache.set(this.sql, s);
    }
    return s;
  }

  async first(column) {
    const row = plain(this.#prepared().get(...(this.args ?? [])));
    if (column === undefined || row === null) return row;
    return row[column] ?? null;
  }

  async all() {
    const results = this.#prepared().all(...(this.args ?? [])).map(plain);
    return { results, success: true, meta: { changes: 0, rows_read: results.length } };
  }

  async run() {
    const r = this.#prepared().run(...(this.args ?? []));
    return {
      results: [],
      success: true,
      meta: { changes: r.changes, last_row_id: Number(r.lastInsertRowid) },
    };
  }
}

class FakeD1 {
  constructor() {
    this.raw = new DatabaseSync(":memory:");
    this.cache = new Map();
    this.raw.exec(readFileSync(SCHEMA, "utf8"));
  }

  prepare(sql) {
    return new Stmt(this, sql);
  }

  /** D1 runs a batch as a single transaction; so does this. */
  async batch(stmts) {
    this.raw.exec("BEGIN");
    try {
      const out = [];
      for (const s of stmts) out.push(await s.run());
      this.raw.exec("COMMIT");
      return out;
    } catch (err) {
      this.raw.exec("ROLLBACK");
      throw err;
    }
  }

  close() {
    this.cache.clear();
    this.raw.close();
  }
}

export function freshDb() {
  return new FakeD1();
}

/** Stands in for the static-asset binding, which the API paths never reach. */
export const ASSETS = {
  fetch: async () => new Response("asset", { status: 200 }),
};
