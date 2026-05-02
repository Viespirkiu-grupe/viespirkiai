# AGENTS.md

## Big picture

- `Viešpirkiai` is a Node.js/Express civic transparency app plus a separate background ingester. The web process is
  `server.js` → clustered workers running `index.js`; the ingestion process is `tasks/index.js` using
  `runner/TaskRunner.js` + `runner/Worker.js`.
- Keep that boundary intact: web routes live in `routes/`, domain logic lives in `modules/`, and task-runner code stays
  under `tasks/` / `runner/`. Do not import task-runner orchestration into the web server.
- Primary data lives in PostgreSQL (`postgres/postgres.js`), search is split across Typesense (`typesense/typesense.js`)
  for contracts/JAR and Quickwit (`quickwit/quickwit.js`) for document text.
- The MCP integration is part of the web app: `routes/mcp.js` exposes `/mcp`, while `modules/mcp/server.js` auto-loads
  tools from `modules/mcp/tools/`.

## Startup and developer workflow

- Copy `config.sample.js` to `config.js`; runtime config is loaded by `utils/config.js` and also exposed as
  `global.CONFIG`.
- Build assets before starting the server: `index.js` computes an MD5 of `public/dist/tailwind.css` at startup, so
  missing built assets will break boot.
- Main commands:
    - `npm run build` — build Tailwind and the two `src/rysiai*.js` browser bundles
    - `npm run dev` — run `index.js` directly (single process)
    - `npm start` — run clustered production entrypoint `server.js`
    - `node tasks/index.js` — run the background task runner
    - `npm test` — Node test runner; current coverage is mostly `test/rysiai/*.test.js`
- `start.sh` and `startTaskRunner.sh` are outer restart loops used for resilience; prefer the direct Node commands while
  developing.
- Local services from `compose.yml`: PostgreSQL `:9118`, PgBouncer `:9120`, Typesense `:9021`, Quickwit `:7280`.

## Codebase patterns that matter

- ESM only (`"type": "module"`); use `import`/`export`, `import.meta.url`, and `fileURLToPath` instead of CommonJS
  helpers.
- Route files export a default `express.Router()`. `index.js` auto-imports every `routes/*.js` file in filesystem order,
  so adding a new route is just creating a new router file.
- In route handlers, render HTML with `res.renderCompiled(...)`, not plain `res.render(...)`; see `routes/index.js`.
- Domain code belongs in `modules/<source-or-feature>/`. Routes call modules; modules should not import routes.
- Use Lithuanian domain naming consistently (`sutartis`, `tiekejas`, `pirkejas`, `jarKodas`, etc.). Many DB columns and
  view names depend on that vocabulary.
- Prefer `log(text)` from `utils/log.js` for application logging; it auto-tags logs with the caller path.
- `utils/units.js` and `utils/linksniai.js` extend built-in prototypes and are imported for side effects in `index.js`;
  do not remove or duplicate those imports.

## Data/search integration details

- Respect `config.typesenseUp` before doing Typesense work. The app intentionally falls back to PostgreSQL search when
  Typesense is disabled; `routes/index.js` and `typesense/typesense.js` show the expected guard.
- PostgreSQL type parsing is customized globally: `DATE`/`TIMESTAMP` come back as strings and `NUMERIC` as floats. Avoid
  assuming JS `Date` objects from query results.
- `postgres/postgres.js` sets `statement_cache_size: 0` for PgBouncer compatibility; preserve that if touching pool
  config.
- Typesense collections are schema-versioned and may be recreated in `ensureSearchCollection()` /
  `ensureJarCollection()`.
- Quickwit indexing is coordinated through Postgres bookkeeping tables; `quickwit/quickwit.js` is intentionally careful
  about shard allocation, tombstones, and live-hit filtering.

## Task runner conventions

- Task definitions are registered in `tasks/index.js` from per-domain files like `tasks/sutartys.js` or
  `tasks/viesiejiPirkimai.js`.
- `mode: "asap"` means long-lived workers; `schedule` means cron. `priority`, `cooldown`, `errorCooldown`, and
  `concurrency` drive admission in `TaskRunner`.
- Use `runner.nudge("taskName")` in `onSuccess` when one task should wake downstream work without spawning new workers.

## Useful examples

- Contract search + export flow: `routes/index.js` ↔ `modules/sutartys/searchSutartys.js`
- File/OCR endpoints: `routes/failas.js` with supporting logic in `modules/failai/`
- Graph frontend bundles and tests: `src/rysiai-app.js`, `src/rysiai-bundle.js`, `test/rysiai/*.test.js`

