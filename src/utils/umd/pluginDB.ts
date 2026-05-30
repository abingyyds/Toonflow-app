import knex from "knex";
import fs from "fs";
import path from "path";
import getPath from "@/utils/getPath";
import { Parser } from "@/utils/umd/sqlite.umd.js";

const BLOCKED = new Set(["o_user", "o_setting", "o_vendorConfig", "sqlite_master", "sqlite_schema", "sqlite_temp_master", "sqlite_temp_schema"]);
const DDL_OPS = new Set(["create", "drop", "alter", "rename", "truncate", "attach", "detach", "vacuum", "reindex"]);
// 直接拒绝：DDL+ 危险 PRAGMA
const DENY_RE =
  /^\s*(create|drop|alter|truncate|attach|detach|vacuum|reindex|rename)\b|^\s*pragma\s+(writable_schema|legacy_alter_table|journal_mode|secure_delete|trusted_schema|locking_mode|synchronous|temp_store|cache_size)\b/i;
// 直接放行：事务控制 + 普通 PRAGMA
const SKIP_RE = /^\s*(begin|commit|end|rollback|savepoint|release|pragma)\b/i;
// 危险 SQLite 函数
const FUNC_RE = /\b(load_extension|readfile|writefile|fts3_tokenizer|edit|zipfile)\s*\(/i;

const parser = new Parser();

export function checkSQL(sql: string) {
  if (DENY_RE.test(sql)) throw new Error(`Sandbox: denied -> ${sql.slice(0, 80)}`);
  if (SKIP_RE.test(sql)) return;
  if (FUNC_RE.test(sql.replace(/'(?:''|[^'])*'/g, "''"))) {
    throw new Error(`Sandbox: dangerous function -> ${sql.slice(0, 80)}`);
  }
  let entries: string[];
  try {
    entries = parser.tableList(sql.replace(/\?/g, "0"), { database: "sqlite" });
  } catch {
    throw new Error(`Sandbox: parse failed -> ${sql.slice(0, 80)}`);
  }
  for (const e of entries) {
    const [op, , t] = e.split("::");
    if (DDL_OPS.has(op.toLowerCase())) throw new Error(`Sandbox: DDL "${op}" on "${t}"`);
    if (BLOCKED.has(t.toLowerCase())) throw new Error(`Sandbox: table "${t}" denied`);
  }
}

const dbPath = getPath("db2.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export default knex({
  client: "better-sqlite3",
  connection: { filename: dbPath },
  useNullAsDefault: true,
  pool: {
    afterCreate(conn: any, done: (err: Error | null, conn: any) => void) {
      const p = conn.prepare.bind(conn);
      const e = conn.exec.bind(conn);
      conn.prepare = (s: string) => (checkSQL(s), p(s));
      conn.exec = (s: string) => (checkSQL(s), e(s));
      done(null, conn);
    },
  },
});
