/**
 * pluginDB 沙箱测试集（扩展版）
 * 运行：npx tsx scripts/test-pluginDB.ts
 *
 * 覆盖：
 *  A. 越权（黑名单表 o_assets 各种访问形态）
 *  B. DDL 拦截（含 INDEX/TRIGGER/VIEW/ATTACH 等 parser 不识别的种类）
 *  C. 危险 PRAGMA 拦截
 *  D. 各类绕过尝试（大小写、引号、注释、Schema 限定、多语句、子查询、CASE、EXISTS、UNION、CTE、UPDATE-SET-子查询）
 *  E. 合法 SQL 放行（含占位符、聚合、JOIN、RETURNING）
 *  F. 边界（空/空白/纯注释/超长 SQL/Unicode 表名）
 *  G. Parser 失败 → fail-closed
 *  H. Knex 集成（CRUD、事务、聚合、子查询 IN、batchInsert、raw）
 *  I. 性能 smoke
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import knex from "knex";
import { Parser } from "@/utils/umd/sqlite.umd.js";

// ============================================================
// 复制最小版 checkSQL（与 pluginDB.ts 保持同步）
// ============================================================
const BLOCKED = new Set(["o_user", "o_setting", "o_vendorConfig", "sqlite_master", "sqlite_schema", "sqlite_temp_master", "sqlite_temp_schema"]);
const DDL_OPS = new Set(["create", "drop", "alter", "rename", "truncate", "attach", "detach", "vacuum", "reindex"]);
const DENY_RE =
  /^\s*(create|drop|alter|truncate|attach|detach|vacuum|reindex|rename)\b|^\s*pragma\s+(writable_schema|legacy_alter_table|journal_mode|secure_delete|trusted_schema|locking_mode|synchronous|temp_store|cache_size)\b/i;
const SKIP_RE = /^\s*(begin|commit|end|rollback|savepoint|release|pragma)\b/i;
const FUNC_RE = /\b(load_extension|readfile|writefile|fts3_tokenizer|edit|zipfile)\s*\(/i;
const parser = new Parser();

function checkSQL(sql: string) {
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

// ============================================================
// 测试辅助
// ============================================================
let passed = 0;
let failed = 0;
const fails: string[] = [];

function expectBlocked(sql: string, label: string) {
  try {
    checkSQL(sql);
    failed++;
    fails.push(`[FAIL] 应被拒绝但放行：${label}\n        SQL: ${sql}`);
  } catch {
    passed++;
    console.log(`  ✓ ${label}`);
  }
}

function expectAllowed(sql: string, label: string) {
  try {
    checkSQL(sql);
    passed++;
    console.log(`  ✓ ${label}`);
  } catch (e: any) {
    failed++;
    fails.push(`[FAIL] 应放行但被拒：${label}\n        SQL: ${sql}\n        Error: ${e.message}`);
  }
}

function section(name: string) {
  console.log(`\n── ${name} ──`);
}

(async () => {
  // ============================================================
  // A. 越权访问 o_assets
  // ============================================================
  section("A. 越权访问 o_assets");
  expectBlocked("SELECT * FROM o_assets", "直接 SELECT");
  expectBlocked("SELECT id FROM o_assets WHERE x=?", "带 WHERE 的 SELECT（占位符）");
  expectBlocked("INSERT INTO o_assets (a) VALUES (?)", "INSERT");
  expectBlocked("UPDATE o_assets SET a=?", "UPDATE");
  expectBlocked("DELETE FROM o_assets", "DELETE");
  expectBlocked("REPLACE INTO o_assets (a) VALUES (?)", "REPLACE");
  expectBlocked("INSERT INTO o_assets (a) VALUES (?) RETURNING *", "INSERT RETURNING");
  expectBlocked("DELETE FROM o_assets RETURNING id", "DELETE RETURNING");

  // ============================================================
  // B. DDL 拦截
  // ============================================================
  section("B. DDL 拦截");
  expectBlocked("CREATE TABLE x(a INT)", "CREATE TABLE");
  expectBlocked("CREATE TEMP TABLE x(a INT)", "CREATE TEMP TABLE");
  expectBlocked("CREATE TABLE IF NOT EXISTS x(a INT)", "CREATE TABLE IF NOT EXISTS");
  expectBlocked("DROP TABLE users", "DROP TABLE");
  expectBlocked("DROP TABLE IF EXISTS users", "DROP TABLE IF EXISTS");
  expectBlocked("ALTER TABLE users ADD COLUMN x INT", "ALTER TABLE ADD");
  expectBlocked("ALTER TABLE users RENAME TO users2", "ALTER TABLE RENAME");
  expectBlocked("CREATE INDEX idx ON users(id)", "CREATE INDEX");
  expectBlocked("CREATE UNIQUE INDEX idx ON users(id)", "CREATE UNIQUE INDEX");
  expectBlocked("DROP INDEX idx", "DROP INDEX");
  expectBlocked("CREATE TRIGGER t BEFORE INSERT ON users BEGIN SELECT 1; END", "CREATE TRIGGER");
  expectBlocked("CREATE VIEW v AS SELECT * FROM users", "CREATE VIEW");
  expectBlocked("DROP VIEW v", "DROP VIEW");
  expectBlocked("VACUUM", "VACUUM");
  expectBlocked("REINDEX", "REINDEX");
  expectBlocked("ATTACH DATABASE 'foo.db' AS x", "ATTACH DATABASE");
  expectBlocked("DETACH DATABASE x", "DETACH DATABASE");

  // ============================================================
  // C. 危险 PRAGMA
  // ============================================================
  section("C. 危险 PRAGMA 拦截");
  expectBlocked("PRAGMA writable_schema = 1", "writable_schema（可改 sqlite_master）");
  expectBlocked("PRAGMA writable_schema = ON", "writable_schema = ON");
  expectBlocked("PRAGMA legacy_alter_table = ON", "legacy_alter_table");
  expectBlocked("PRAGMA journal_mode = OFF", "journal_mode = OFF");
  expectBlocked("PRAGMA secure_delete = OFF", "secure_delete");
  expectBlocked("PRAGMA trusted_schema = ON", "trusted_schema");
  expectBlocked("  pragma   WRITABLE_SCHEMA  =  1  ", "大小写 + 空白");

  // ============================================================
  // D. 绕过尝试
  // ============================================================
  section("D. 绕过尝试");
  expectBlocked("SELECT * FROM O_ASSETS", "大小写绕过");
  expectBlocked("SELECT * FROM `o_assets`", "反引号包裹");
  expectBlocked('SELECT * FROM "o_assets"', "双引号包裹");
  expectBlocked("SELECT * FROM [o_assets]", "方括号包裹");
  expectBlocked("SELECT * FROM main.o_assets", "Schema 限定 main.o_assets");
  expectBlocked('SELECT * FROM "main"."o_assets"', "Schema 限定带引号");
  expectBlocked("SELECT * FROM temp.o_assets", "Schema 限定 temp.o_assets");
  expectBlocked("SELECT * FROM users JOIN o_assets ON users.id=o_assets.uid", "JOIN");
  expectBlocked("SELECT * FROM users LEFT JOIN o_assets a ON users.id=a.uid", "LEFT JOIN + 别名");
  expectBlocked("SELECT * FROM users WHERE id IN (SELECT uid FROM o_assets)", "WHERE IN 子查询");
  expectBlocked("SELECT * FROM users WHERE EXISTS (SELECT 1 FROM o_assets)", "WHERE EXISTS 子查询");
  expectBlocked("SELECT CASE WHEN 1 THEN (SELECT data FROM o_assets) END", "CASE WHEN 子查询");
  expectBlocked("UPDATE users SET x=(SELECT data FROM o_assets) WHERE id=?", "UPDATE SET 子查询");
  expectBlocked("WITH t AS (SELECT * FROM o_assets) SELECT * FROM t", "CTE");
  expectBlocked("SELECT * FROM users UNION SELECT * FROM o_assets", "UNION");
  expectBlocked("SELECT * FROM users UNION ALL SELECT * FROM o_assets", "UNION ALL");
  expectBlocked("INSERT INTO users SELECT * FROM o_assets", "INSERT...SELECT");
  expectBlocked("SELECT 1; SELECT * FROM o_assets", "多语句 - 第二条访问黑名单");
  expectBlocked("SELECT * FROM o_assets; SELECT 1", "多语句 - 第一条访问黑名单");
  expectBlocked("SELECT 1; DROP TABLE users", "多语句 - 含 DDL");
  expectBlocked("/*c*/ SELECT * FROM o_assets", "前置块注释");
  expectBlocked("-- comment\nSELECT * FROM o_assets", "前置行注释");
  expectBlocked("SELECT\t*\nFROM\to_assets", "异常空白");

  // 反向：注释/字面量含表名不应误伤
  expectAllowed("SELECT 'o_assets' AS label FROM users", "字符串字面量含表名");
  expectAllowed("SELECT * FROM users -- o_assets in comment", "行注释含表名");
  expectAllowed("SELECT * FROM users /* o_assets */", "块注释含表名");

  // ============================================================
  // E. 合法 SQL 放行
  // ============================================================
  section("E. 合法 SQL 放行");
  expectAllowed("SELECT * FROM users", "基础 SELECT");
  expectAllowed("SELECT * FROM o_image ORDER BY id DESC LIMIT ? OFFSET ?", "占位符 + LIMIT/OFFSET");
  expectAllowed("INSERT INTO users (name) VALUES (?)", "INSERT 占位符");
  expectAllowed("UPDATE users SET name=? WHERE id=?", "UPDATE 占位符");
  expectAllowed("DELETE FROM users WHERE id=?", "DELETE 占位符");
  expectAllowed("INSERT INTO users (name) VALUES (?) RETURNING id, name", "INSERT RETURNING");
  expectAllowed("SELECT COUNT(*) FROM users", "COUNT(*)");
  expectAllowed("SELECT type, COUNT(*) FROM users GROUP BY type HAVING COUNT(*) > ?", "GROUP BY + HAVING");
  expectAllowed("SELECT SUM(x), AVG(y), MAX(z), MIN(w) FROM users", "多聚合");
  expectAllowed("SELECT a.*, b.name FROM o_image a LEFT JOIN users b ON a.uid=b.id", "LEFT JOIN");
  expectAllowed("SELECT * FROM users INNER JOIN o_image ON users.id=o_image.uid", "INNER JOIN");
  expectAllowed("WITH t AS (SELECT * FROM users) SELECT * FROM t", "CTE");
  expectAllowed("WITH t1 AS (SELECT * FROM users), t2 AS (SELECT * FROM o_image) SELECT * FROM t1, t2", "多 CTE");
  expectAllowed("SELECT * FROM users WHERE id IN (?, ?, ?)", "WHERE IN 列表");

  // ============================================================
  // F. 边界
  // ============================================================
  section("F. 边界情况");
  expectAllowed("", "空 SQL");
  expectAllowed("   ", "纯空白");
  expectAllowed("/* only comment */", "纯块注释");
  expectAllowed("-- only line comment", "纯行注释");
  expectAllowed("PRAGMA foreign_keys = ON", "无害 PRAGMA - foreign_keys");
  expectAllowed("PRAGMA table_info('users')", "PRAGMA table_info");
  expectAllowed("PRAGMA user_version", "PRAGMA user_version");
  expectAllowed("SELECT 1", "纯表达式");
  expectAllowed("SELECT 1 + 2 * 3", "纯表达式 - 算术");
  expectAllowed("BEGIN", "BEGIN（事务控制）");
  expectAllowed("BEGIN;", "BEGIN; 带分号");
  expectAllowed("COMMIT", "COMMIT");
  expectAllowed("ROLLBACK", "ROLLBACK");
  expectAllowed("SAVEPOINT sp1", "SAVEPOINT");
  expectAllowed("RELEASE SAVEPOINT sp1", "RELEASE SAVEPOINT");
  const longSQL = "SELECT * FROM users WHERE id IN (" + Array(2000).fill("?").join(",") + ")";
  expectAllowed(longSQL, `超长 SQL (${longSQL.length} chars)`);

  // ============================================================
  // G. Parser 失败 → fail-closed
  // ============================================================
  section("G. Parser 异常 fail-closed");
  expectBlocked("@@@invalid sql@@@", "完全无效 SQL");
  expectBlocked("INSERT INTO users (a) SELECT a FROM o_assets RETURNING *", "INSERT-SELECT-RETURNING（parser 不支持）");

  // ============================================================
  // J. 注入与极端
  // ============================================================
  section("J. 注入向量与极端 SQL");
  // 经典 UNION 注入：合法 SQL 后追加 UNION 拉取黑名单数据
  expectBlocked("SELECT * FROM users WHERE name = 'admin' UNION SELECT data, NULL FROM o_assets", "UNION 注入拉取 o_assets");
  // 注释截断 + 多语句 stacked
  expectBlocked("SELECT * FROM users WHERE id=1; DROP TABLE users -- ", "注释截断 + stacked DROP");
  expectBlocked("SELECT * FROM users; DELETE FROM o_assets; --", "stacked DELETE 黑名单 + 注释");
  expectBlocked("SELECT 1 /* stacked */ ; SELECT * FROM o_assets", "块注释分隔 + stacked 黑名单");
  // sqlite_master 信息泄露
  expectBlocked("SELECT sql FROM sqlite_master", "sqlite_master 列 DDL");
  expectBlocked("SELECT sql FROM sqlite_schema WHERE name='o_assets'", "sqlite_schema 查目标表 DDL");
  expectBlocked("SELECT * FROM sqlite_temp_master", "sqlite_temp_master");
  expectBlocked("SELECT * FROM users JOIN sqlite_master m ON m.name=users.name", "JOIN sqlite_master 旁路");
  // 危险 SQLite 函数
  expectBlocked("SELECT load_extension('evil.so')", "load_extension");
  expectBlocked("SELECT readfile('/etc/passwd')", "readfile");
  expectBlocked("SELECT writefile('/tmp/x', 'data')", "writefile");
  expectBlocked("SELECT * FROM users WHERE load_extension('x')", "load_extension 嵌在 WHERE");
  expectBlocked("SELECT LOAD_EXTENSION('x')", "load_extension 大写");
  // 危险函数名出现在字符串字面量里 → 不应误伤
  expectAllowed("SELECT 'load_extension is evil' AS msg FROM users", "load_extension 在字符串字面量");
  expectAllowed("SELECT * FROM users WHERE note = 'readfile()'", "readfile 在字面量");
  // 递归 CTE 引用黑名单
  expectBlocked("WITH RECURSIVE r(n) AS (SELECT 1 UNION SELECT n+1 FROM r WHERE n<5) SELECT * FROM r, o_assets", "递归 CTE 中混入黑名单");
  // 深度嵌套子查询
  expectBlocked("SELECT * FROM ((((SELECT * FROM o_assets))))", "4 层括号嵌套子查询");
  expectBlocked("SELECT * FROM users WHERE id IN (SELECT id FROM (SELECT uid AS id FROM (SELECT * FROM o_assets)))", "3 层 IN-FROM 嵌套");
  // 引号转义攻击：参数已正确转义 → 内容只是字面量，应放行
  expectAllowed("SELECT * FROM users WHERE name = 'O''Brien'", "SQL 标准转义 ''");
  expectAllowed("SELECT * FROM users WHERE name = 'foo'';DROP TABLE users--'", "字面量内含 DROP 语法（已正确转义）");
  // 拼接构造表名（SQLite 不支持，parser 应当 fail-closed）
  expectBlocked("SELECT * FROM ('o_' || 'assets')", "动态构造表名（parser 失败 → 拒）");
  // 非可打印字符 / BOM / 全角
  expectBlocked("\uFEFFSELECT * FROM o_assets", "BOM 前缀（parser 失败 → 拒）");
  expectBlocked("ＳＥＬＥＣＴ * FROM o_assets", "全角关键字（parser 失败 → 拒）");
  expectBlocked("SELECT * FROM o\u0000_assets", "表名含 NULL 字节（parser 失败 → 拒）");
  // 完整 OWASP 风格 payload
  expectBlocked("SELECT * FROM users WHERE id='1' OR 1=1; DROP TABLE users--", "OR 1=1 + stacked DROP");
  expectBlocked("SELECT * FROM users WHERE id='1' UNION ALL SELECT name, sql FROM sqlite_master--", "UNION + sqlite_master + 注释");
  // 经典 payload 但 SQL 是纯参数化（payload 在 ? 绑定里）→ 应放行（SQL 本身合法）
  expectAllowed("SELECT * FROM users WHERE name = ?", "参数化 SELECT（payload 在绑定值中，与 SQL 解析无关）");
  // EXPLAIN 黑名单（parser 不支持 EXPLAIN → fail-closed 拒）
  expectBlocked("EXPLAIN SELECT * FROM o_assets", "EXPLAIN + 黑名单（fail-closed）");
  expectBlocked("EXPLAIN QUERY PLAN SELECT * FROM o_assets", "EXPLAIN QUERY PLAN");
  // 大量分号空语句（应不崩溃）
  expectAllowed(";;;;;;", "纯分号串");
  // 极端嵌套 IN 列表（DoS 测试 - 应快速通过）
  const huge = "SELECT * FROM users WHERE id IN (" + Array(5000).fill("?").join(",") + ")";
  expectAllowed(huge, `极大 IN 列表 (${huge.length} chars)`);
  // 多个黑名单表混合
  expectBlocked("SELECT * FROM o_assets a, sqlite_master m WHERE a.id=m.rootpage", "同时访问 o_assets 和 sqlite_master");

  // ============================================================
  // H. Knex 集成测试
  // ============================================================
  section("H. Knex 集成测试");
  const tmpDb = path.join(os.tmpdir(), `sandbox-test-${Date.now()}.sqlite`);
  const rawDb = knex({
    client: "better-sqlite3",
    connection: { filename: tmpDb },
    useNullAsDefault: true,
  });
  await rawDb.schema.createTable("o_image", (t) => {
    t.increments("id");
    t.string("name");
    t.integer("uid");
  });
  await rawDb.schema.createTable("users", (t) => {
    t.increments("id");
    t.string("name");
  });
  await rawDb.schema.createTable("o_assets", (t) => {
    t.increments("id");
    t.string("data");
  });
  await rawDb("users").insert([{ name: "alice" }, { name: "bob" }]);
  await rawDb("o_image").insert([
    { name: "a", uid: 1 },
    { name: "b", uid: 1 },
    { name: "c", uid: 2 },
  ]);
  await rawDb("o_assets").insert({ data: "secret" });
  await rawDb.destroy();

  const sb = knex({
    client: "better-sqlite3",
    connection: { filename: tmpDb },
    useNullAsDefault: true,
    pool: {
      afterCreate(conn: any, done: any) {
        const origPrepare = conn.prepare.bind(conn);
        const origExec = conn.exec.bind(conn);
        conn.prepare = (sql: string) => (checkSQL(sql), origPrepare(sql));
        conn.exec = (sql: string) => (checkSQL(sql), origExec(sql));
        done(null, conn);
      },
    },
  });

  async function knexCase(label: string, fn: () => Promise<void>, shouldFail: boolean) {
    try {
      await fn();
      if (shouldFail) {
        failed++;
        fails.push(`[FAIL] Knex 应被拒：${label}`);
      } else {
        passed++;
        console.log(`  ✓ ${label}`);
      }
    } catch (e: any) {
      if (shouldFail) {
        passed++;
        console.log(`  ✓ ${label}（被拒）`);
      } else {
        failed++;
        fails.push(`[FAIL] Knex 应放行但被拒：${label}\n        Error: ${e.message}`);
      }
    }
  }

  // 合法
  await knexCase(
    "基础 SELECT",
    async () => {
      const rows = await sb("o_image").orderBy("id", "desc").limit(10).offset(0).select("*");
      assert.equal(rows.length, 3);
    },
    false,
  );
  await knexCase(
    "COUNT 聚合",
    async () => {
      const rows = await sb("users").count<{ cnt: number }[]>({ cnt: "*" });
      assert.equal(Number(rows[0].cnt), 2);
    },
    false,
  );
  await knexCase(
    "GROUP BY",
    async () => {
      const rows = await sb("o_image").select("uid").count({ c: "*" }).groupBy("uid");
      assert.equal(rows.length, 2);
    },
    false,
  );
  await knexCase(
    "LEFT JOIN",
    async () => {
      const rows = await sb("o_image as i").leftJoin("users as u", "i.uid", "u.id").select("i.id", "u.name");
      assert.equal(rows.length, 3);
    },
    false,
  );
  await knexCase(
    "whereIn 字面量",
    async () => {
      const rows = await sb("users").whereIn("id", [1, 2]).select("*");
      assert.equal(rows.length, 2);
    },
    false,
  );
  await knexCase(
    "whereIn 子查询",
    async () => {
      const rows = await sb("users").whereIn("id", sb("o_image").select("uid")).select("*");
      assert.ok(rows.length >= 1);
    },
    false,
  );
  await knexCase(
    "INSERT + RETURNING",
    async () => {
      const ret = await sb("users").insert({ name: "carol" }).returning(["id", "name"]);
      assert.equal((ret[0] as any).name, "carol");
    },
    false,
  );
  await knexCase(
    "UPDATE",
    async () => {
      const n = await sb("users").where({ name: "bob" }).update({ name: "bob2" });
      assert.equal(n, 1);
    },
    false,
  );
  await knexCase(
    "DELETE",
    async () => {
      const n = await sb("users").where({ name: "carol" }).del();
      assert.equal(n, 1);
    },
    false,
  );
  await knexCase(
    "事务 commit",
    async () => {
      await sb.transaction(async (trx) => {
        await trx("users").insert({ name: "tx1" });
      });
      const r = await sb("users").where({ name: "tx1" }).count<{ c: number }[]>({ c: "*" });
      assert.equal(Number(r[0].c), 1);
    },
    false,
  );
  await knexCase(
    "事务 rollback",
    async () => {
      try {
        await sb.transaction(async (trx) => {
          await trx("users").insert({ name: "tx2" });
          throw new Error("force rollback");
        });
      } catch {}
      const r = await sb("users").where({ name: "tx2" }).count<{ c: number }[]>({ c: "*" });
      assert.equal(Number(r[0].c), 0);
    },
    false,
  );
  await knexCase(
    "batchInsert",
    async () => {
      await sb.batchInsert("users", [{ name: "b1" }, { name: "b2" }, { name: "b3" }], 2);
      const r = await sb("users").whereIn("name", ["b1", "b2", "b3"]).count<{ c: number }[]>({ c: "*" });
      assert.equal(Number(r[0].c), 3);
    },
    false,
  );
  await knexCase(
    "raw 合法 SELECT",
    async () => {
      const result = await sb.raw("SELECT COUNT(*) AS c FROM users");
      assert.ok(Array.isArray(result));
    },
    false,
  );

  // 应被拒
  await knexCase(
    "访问 o_assets",
    async () => {
      await sb("o_assets").select("*");
    },
    true,
  );
  await knexCase(
    "INSERT o_assets",
    async () => {
      await sb("o_assets").insert({ data: "x" });
    },
    true,
  );
  await knexCase(
    "UPDATE o_assets",
    async () => {
      await sb("o_assets").update({ data: "x" });
    },
    true,
  );
  await knexCase(
    "DELETE o_assets",
    async () => {
      await sb("o_assets").del();
    },
    true,
  );
  await knexCase(
    "schema.createTable",
    async () => {
      await sb.schema.createTable("evil", (t) => t.increments());
    },
    true,
  );
  await knexCase(
    "schema.dropTable",
    async () => {
      await sb.schema.dropTable("users");
    },
    true,
  );
  await knexCase(
    "raw DELETE o_assets",
    async () => {
      await sb.raw("DELETE FROM o_assets");
    },
    true,
  );
  await knexCase(
    "raw 危险 PRAGMA",
    async () => {
      await sb.raw("PRAGMA writable_schema = 1");
    },
    true,
  );
  await knexCase(
    "raw ATTACH",
    async () => {
      await sb.raw("ATTACH DATABASE 'x' AS y");
    },
    true,
  );
  await knexCase(
    "raw 子查询访问黑名单",
    async () => {
      await sb.raw("SELECT * FROM users WHERE id IN (SELECT uid FROM o_assets)");
    },
    true,
  );
  await knexCase(
    "事务内访问黑名单（整事务回滚）",
    async () => {
      await sb.transaction(async (trx) => {
        await trx("o_assets").select("*");
      });
    },
    true,
  );
  // 注入相关
  await knexCase(
    "raw UNION 注入 o_assets",
    async () => {
      await sb.raw("SELECT id FROM users UNION SELECT id FROM o_assets");
    },
    true,
  );
  await knexCase(
    "raw sqlite_master 查 DDL",
    async () => {
      await sb.raw("SELECT sql FROM sqlite_master WHERE name=?", ["o_assets"]);
    },
    true,
  );
  await knexCase(
    "raw load_extension",
    async () => {
      await sb.raw("SELECT load_extension('evil.so')");
    },
    true,
  );
  await knexCase(
    "raw stacked DROP via exec",
    async () => {
      // 通过 .raw 走 prepare；多语句 SQLite prepare 会报错，但拦截器在更前面
      await sb.raw("SELECT 1; DROP TABLE users");
    },
    true,
  );
  // 注入 payload 在参数里（合法）— 应正常返回 0 行
  await knexCase(
    "参数化拒绝注入（payload 在 ? 绑定）",
    async () => {
      const rows = await sb("users").where({ name: "alice'; DROP TABLE users--" }).select("*");
      assert.equal(rows.length, 0);
    },
    false,
  );

  await sb.destroy();
  fs.unlinkSync(tmpDb);

  // ============================================================
  // I. 性能 smoke
  // ============================================================
  section("I. 性能 smoke");
  const N = 1000;
  const t0 = Date.now();
  for (let i = 0; i < N; i++) {
    checkSQL("SELECT a, b, c FROM users WHERE id = ? AND type IN (?, ?, ?) ORDER BY id LIMIT ? OFFSET ?");
  }
  const dt = Date.now() - t0;
  if (dt < 5000) {
    passed++;
    console.log(`  ✓ ${N} 次 checkSQL 耗时 ${dt}ms（< 5s）`);
  } else {
    failed++;
    fails.push(`[FAIL] 性能不达标：${N} 次 ${dt}ms`);
  }

  // ============================================================
  // 汇总
  // ============================================================
  console.log(`\n${"=".repeat(50)}`);
  console.log(`通过: ${passed}    失败: ${failed}`);
  if (fails.length) {
    console.log("\n失败详情:");
    fails.forEach((f) => console.log(f));
    process.exit(1);
  }
  console.log("全部通过 ✓");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
