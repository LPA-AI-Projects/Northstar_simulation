"use strict";

const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;

const CONNECTION_ENV_VARS = [
  "DATABASE_URL",
  "DATABASE_PRIVATE_URL",
  "POSTGRES_URL",
  "DATABASE_PUBLIC_URL",
];

const SETUP_HINT = [
  "Railway setup:",
  "  1. Add PostgreSQL to the project (+ New -> Database -> PostgreSQL).",
  "  2. On this service: Variables -> New Variable ->",
  "     DATABASE_URL = ${{Postgres.DATABASE_URL}}",
  "     (use the service name shown on the canvas if it is not 'Postgres')",
  "  3. Redeploy.",
].join("\n");

function resolveConnection() {
  for (const name of CONNECTION_ENV_VARS) {
    const raw = (process.env[name] || "").trim();
    if (!raw) continue;

    if (raw.includes("${{")) {
      throw new Error(
        `${name} is set to an unresolved Railway template ("${raw}"). ` +
          `The referenced service name does not exist.\n${SETUP_HINT}`
      );
    }

    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      throw new Error(
        `${name} is not a valid Postgres connection string.\n${SETUP_HINT}`
      );
    }

    const host = parsed.hostname;
    if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
      throw new Error(
        `${name} points at ${host || "no host"}, which is this container itself, not the Railway database.\n${SETUP_HINT}`
      );
    }

    console.log(`Using ${name} -> ${host}:${parsed.port || 5432}`);
    return { connectionString: raw, host };
  }

  throw new Error(
    `No database connection string found. Checked: ${CONNECTION_ENV_VARS.join(", ")}.\n${SETUP_HINT}`
  );
}

let connection;
try {
  connection = resolveConnection();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

// Railway's private network (*.railway.internal) is unencrypted; public proxy hosts require TLS.
const useSsl =
  process.env.PGSSLMODE === "disable"
    ? false
    : connection.host.endsWith(".railway.internal")
      ? false
      : { rejectUnauthorized: false };

const pool = new Pool({
  connectionString: connection.connectionString,
  ssl: useSsl,
  connectionTimeoutMillis: 10000,
});

pool.on("error", (err) => {
  console.error("Idle Postgres client error:", err.message);
});

async function createSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kv_store (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS kv_store_key_prefix_idx
    ON kv_store (key text_pattern_ops);
  `);
  console.log("Database ready (kv_store).");
}

// The database service can still be booting when the app starts.
async function initDb(attempts = 5) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await createSchema();
      return;
    } catch (err) {
      if (attempt === attempts) throw err;
      const waitMs = attempt * 2000;
      console.warn(
        `Database not ready (attempt ${attempt}/${attempts}): ${err.message}. Retrying in ${waitMs}ms.`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

const app = express();
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/** List keys by prefix: GET /api/store?prefix=learner: */
app.get("/api/store", async (req, res) => {
  const prefix = String(req.query.prefix || "");
  try {
    const result = await pool.query(
      `SELECT key FROM kv_store WHERE key LIKE $1 ORDER BY key`,
      [prefix + "%"]
    );
    res.json({ keys: result.rows.map((r) => r.key) });
  } catch (err) {
    console.error("listKeys error:", err);
    res.status(500).json({ error: "Failed to list keys" });
  }
});

app.get("/api/store/:key", async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  try {
    const result = await pool.query(`SELECT value FROM kv_store WHERE key = $1`, [key]);
    if (!result.rows.length) return res.status(404).json({ value: null });
    res.json({ value: result.rows[0].value });
  } catch (err) {
    console.error("get error:", err);
    res.status(500).json({ error: "Failed to get key" });
  }
});

app.put("/api/store/:key", async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  if (!Object.prototype.hasOwnProperty.call(req.body || {}, "value")) {
    return res.status(400).json({ error: "Body must include { value }" });
  }
  try {
    await pool.query(
      `INSERT INTO kv_store (key, value, updated_at)
       VALUES ($1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(req.body.value)]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error("set error:", err);
    res.status(500).json({ error: "Failed to set key" });
  }
});

app.delete("/api/store/:key", async (req, res) => {
  const key = decodeURIComponent(req.params.key);
  try {
    await pool.query(`DELETE FROM kv_store WHERE key = $1`, [key]);
    res.json({ ok: true });
  } catch (err) {
    console.error("del error:", err);
    res.status(500).json({ error: "Failed to delete key" });
  }
});

app.use(express.static(path.join(__dirname, "public")));

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Northstar simulation listening on port ${PORT}`);
});

initDb().catch((err) => {
  console.error(`Failed to initialize database: ${err.message}\n${SETUP_HINT}`);
  process.exit(1);
});
