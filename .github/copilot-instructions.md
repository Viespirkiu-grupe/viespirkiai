# Copilot Instructions

## Project overview

Viešpirkiai is a Lithuanian civic transparency platform (https://viespirkiai.org) that aggregates and exposes public procurement data from multiple government sources. It has two separately deployed processes: a web server and a background task runner.

## Commands

```bash
# Run web server (direct, single process)
node index.js

# Run web server (cluster mode, with auto-restart wrapper)
node server.js        # or ./start.sh for the self-restarting loop

# Run background task runner
node tasks/index.js   # or ./startTaskRunner.sh for the self-restarting loop

# Build Tailwind CSS (required before first run)
npm run build:tailwind

# Watch Tailwind during development
npm run watch:tailwind
```

There are no test or lint scripts.

## Architecture

### Two-process design

- **Web server** (`server.js` → `index.js`): Express app running in cluster mode (`config.workerCount` workers). Serves the public website on `config.port` (default 9019).
- **Task runner** (`tasks/index.js`): A completely separate Node.js process handling all background data ingestion. Uses the custom `TaskRunner` / `Worker` classes in `runner/`. Never import task runner code into the web server.

### Configuration

All runtime config lives in `config.js` (gitignored). Copy from `config.sample.js`. The module at `utils/config.js` loads it and exposes it as both the default export and `global.CONFIG`.

### Routing

All files in `routes/` are auto-loaded in parallel by `index.js` and registered as Express routers in filesystem order. To add a route, create a new file in `routes/` exporting a default `express.Router()`.

### Data layer

- **PostgreSQL** (via `pg` Pool in `postgres/postgres.js`): Primary data store. Connected through PgBouncer (port 9120) in production; directly on port 9118 in dev. `statement_cache_size: 0` is required for PgBouncer compatibility.
- **Typesense** (port 9021): Full-text search index for contracts and public procurements. Schema versioning handled in `typesense/typesense.js`.
- **Quickwit** (port 7280): Secondary search engine used alongside Typesense.

All services are defined in `compose.yml` and accessed via WireGuard VPN (`10.1.10.2`).

### Modules

`modules/` contains domain logic organised by data source (e.g. `viesiejiPirkimai`, `ted`, `sutartys`, `failai`). Routes import from modules; modules never import from routes.

### Task runner

Tasks are registered in `tasks/index.js` from per-domain files (`tasks/ted.js`, `tasks/sutartys.js`, etc.). Each task definition has:
- `mode: "asap"` — workers run continuously, sleeping between jobs
- `schedule: "cron expr"` — runs on a cron schedule
- `priority` (1–10), `cooldown` (ms), `errorCooldown` (ms), `concurrency`
- Optional `onSuccess: (runner) => runner.nudge("otherTask")` to wake downstream workers

`runner.nudge(taskName)` wakes sleeping workers without respawning them.

### Views

EJS templates in `views/`. In production, templates are compiled once and cached. In dev (`config.dev = true`), they are re-read on every request. Use `res.renderCompiled(viewName, data)` (not `res.render`) in route handlers.

## Key conventions

- **ESM throughout**: `"type": "module"` in `package.json`. Use `import`/`export`. Use `import.meta.url` and `fileURLToPath` to get `__dirname`.
- **Lithuanian naming**: Domain variables, database columns, and UI strings use Lithuanian (`pirkimas`, `tiekejas`, `sutartis`, `viesiejiPirkimai`, etc.). Keep this consistent.
- **Logging**: Use `log(text)` from `utils/log.js` — it auto-detects the caller's filename/folder and colour-codes output. Never use `console.log` for application logs.
- **Prototype extensions**: `utils/units.js` and `utils/linksniai.js` modify `Number.prototype` and `String.prototype`. They must be imported in `index.js` for side effects before any route uses them.
- **Postgres type parsers**: `DATE` and `TIMESTAMP` columns are returned as strings (not JS `Date`). `NUMERIC` is returned as `float`. This is set globally in `postgres/postgres.js`.
- **CSS cache busting**: `tailwindCssBuster` (MD5 of `tailwind.css`) is set on `app.locals` at startup (or per-request in dev) and available in all EJS templates.
- **`highlightCode`** is attached to `globalThis` in `index.js` so EJS templates can call it directly.
- **Config dev mode**: Set `config.dev = true` in `config.js` to disable rate limiting, enable per-request template reloading, and per-request CSS MD5 recomputation.
