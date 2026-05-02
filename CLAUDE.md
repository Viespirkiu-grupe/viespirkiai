# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build         # Build Tailwind CSS + esbuild bundles (required before first run)
npm run dev           # Development server (single process): node index.js
npm run watch         # Watch assets during development
npm start             # Production (cluster mode): node server.js
node tasks/index.js   # Background task runner (separate process)
npm test              # Node built-in test runner; coverage in test/rysiai/*.test.js
```

There are no lint scripts.

## Local dev setup

1. Copy `config.sample.js` → `config.js` and fill in credentials.
2. Key `config.js` settings for local dev:
   - `dev: true` — disables rate limiting, enables per-request EJS/CSS reload
   - `typesenseUp: false` — disables Typesense; app falls back to PostgreSQL ILIKE
   - `pgMaxConnections: 5` — role `rimvydas` has a hard PostgreSQL limit of 10 direct connections
   - `pgPort: 9118` — direct PostgreSQL (dev); production uses PgBouncer on 9120
3. `npm run build` must run before the server starts — `index.js` computes an MD5 of `public/dist/tailwind.css` at startup.

Local services via `docker compose up <service> -d`: PostgreSQL `:9118`, PgBouncer `:9120`, Typesense `:9021`, Quickwit `:7280`.

## Architecture

### Two-process design

The web server and background task runner are **completely separate processes** — never import task runner code into the web server.

- **Web server** (`server.js` → `index.js`): Express cluster, `config.workerCount` workers, port `config.port` (default 9019)
- **Task runner** (`tasks/index.js`): Background data ingestion using `runner/TaskRunner.js` + `runner/Worker.js`

### Routing

All files in `routes/` are auto-loaded in parallel by `index.js`. To add a route, create a new file exporting a default `express.Router()`. In route handlers, use `res.renderCompiled(viewName, data)` — not `res.render()`.

### Module structure

`modules/` contains domain logic organised by data source (e.g. `sutartys/`, `viesiejiPirkimai/`, `failai/`, `ted/`). Routes import from modules; modules never import from routes.

### Data layer

- **PostgreSQL** (`postgres/postgres.js`): Primary store. `statement_cache_size: 0` required for PgBouncer compatibility. `DATE`/`TIMESTAMP` columns return as strings; `NUMERIC` returns as float (set globally — don't assume JS `Date`).
- **Typesense** (port 9021): Full-text search for contracts and companies. Always guard with `config.typesenseUp` and fall back to PostgreSQL when false.
- **Quickwit** (port 7280): Document text search; coordinated via PostgreSQL bookkeeping tables.

### Task runner

Tasks are registered in `tasks/index.js` from per-domain files (`tasks/sutartys.js`, `tasks/ted.js`, etc.). Task properties:
- `mode: "asap"` — long-lived workers sleeping between jobs
- `schedule: "cron expr"` — cron-scheduled
- `priority`, `cooldown`, `errorCooldown`, `concurrency`
- `onSuccess: (runner) => runner.nudge("taskName")` — wake downstream workers without spawning new ones

### MCP integration

`routes/mcp.js` exposes `/mcp`. `modules/mcp/server.js` auto-loads tools from `modules/mcp/tools/`.

## Key conventions

- **ESM only**: `"type": "module"` in `package.json`. Use `import`/`export`, `import.meta.url`, and `fileURLToPath` (no CommonJS `__dirname`/`__filename`).
- **Lithuanian naming**: Domain variables, DB columns, and UI strings use Lithuanian (`pirkimas`, `tiekejas`, `sutartis`, `jarKodas`, etc.). Keep this consistent.
- **Logging**: Use `log(text)` from `utils/log.js` — auto-tags with caller path. Never use `console.log`.
- **Prototype extensions**: `utils/units.js` and `utils/linksniai.js` extend `Number.prototype` / `String.prototype`. Imported for side effects in `index.js` — do not remove or duplicate those imports.
- **Config**: Loaded by `utils/config.js`, exposed as default export and `global.CONFIG`.
- **`highlightCode`**: Attached to `globalThis` in `index.js` for use in EJS templates.
- **CSS cache busting**: `tailwindCssBuster` (MD5 of `tailwind.css`) is set on `app.locals` at startup, available in all EJS templates.

## Useful entry points

- Contract search + export: `routes/index.js` ↔ `modules/sutartys/searchSutartys.js`
- File/OCR endpoints: `routes/failas.js` + `modules/failai/`
- Graph visualization: `src/rysiai-app.js`, `src/rysiai-bundle.js`, `test/rysiai/*.test.js`
