"use strict";

const path = require("path");
const express = require("express");
const { Pool } = require("pg");

const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL. Add Railway Postgres and link DATABASE_URL to this service.");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false },
});

async function initDb() {
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

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Northstar simulation listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Failed to initialize database:", err);
    process.exit(1);
  });
