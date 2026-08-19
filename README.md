# Project Northstar — Railway deploy

Trainer-paced simulation. Learner progress, scores, and session state are stored in **Railway PostgreSQL** via a small Express key-value API.

## Stack

- Static simulation UI (`public/index.html`)
- Node/Express server (`server.js`)
- Railway Postgres (`kv_store` table, created on boot)

## Deploy on Railway

1. Push this repo to GitHub (already configured as `LPA-AI-Projects/Northstar_simulation`).
2. In [Railway](https://railway.app): **New Project** → **Deploy from GitHub** → select this repo.
3. Add a database: **+ New** → **Database** → **PostgreSQL**.
4. On the web service → **Variables** → **Add Reference Variable** → `DATABASE_URL` from the Postgres service.
5. Generate a public domain: service → **Settings** → **Networking** → **Generate Domain**.
6. Redeploy. Open the domain — learners and trainers share one live session backed by Postgres.

Optional: set `TRAINER_CODE` is currently hardcoded in the HTML as `2468` (same as the original sim). Change it in `public/index.html` if you need a different facilitator code.

## Local development

```bash
npm install
# Start local Postgres, then:
cp .env.example .env
# Edit DATABASE_URL in .env
npm start
```

Open http://localhost:3000

## What gets stored

| Key | Purpose |
|-----|---------|
| `session` | Live session status (`waiting` / `active`) |
| `learner:<id>` | Per-learner progress, scores, and submitted responses |

## Trainer access

Use the trainer panel with access code `2468` (unless you change it in the HTML).
