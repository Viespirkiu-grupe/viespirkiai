-- `infra` schemos teisės (2026-09).
--
-- 001_infra.sql perkėlė lenteles, bet nesukūrė schemos teisių. Lentelių ACL
-- keliauja kartu su lentele (`viespirkiaiDev`, `viesduomenys`, o
-- `scrapeProxies` – ir `kiaurastekinis` turi SELECT), tačiau be USAGE ant
-- schemos jos lieka nepasiekiamos: has_table_privilege rodo true, o užklausa
-- vis tiek gauna „permission denied for schema infra".
--
-- Patikrinta gyvoje bazėje po 001 pritaikymo:
--   has_schema_privilege('viesduomenys', 'infra', 'USAGE') = false
--
-- `viespirkiai` (aplikacijos rolė) čia nefigūruoja – ji yra `pg_read_all_data`
-- ir `pg_write_all_data` narė, o šios rolės USAGE ant visų schemų suteikia
-- pačios. Todėl aplikacija po perkėlimo ir neužlūžo.
--
-- `analyst` sąmoningai negauna nieko: šios lentelės niekada nebuvo MCP
-- TABLE_WHITELIST'e (žr. modules/mcp/analyst/validateSql.ts).
--
-- Toks pat rinkinys yra ant visų kitų iš `public` iškeltų schemų (`sodra`,
-- `liteko`, `ppa`, `vpmSutartys`, `eTar` …).

BEGIN;

GRANT USAGE ON SCHEMA infra TO kiaurastekinis, "viespirkiaiDev", viesduomenys;

-- Kad naujos `infra` lentelės iškart būtų skaitomos tų pačių rolių, kaip ir
-- `public` schemoje (pg_default_acl eilutė, savininkas `admin`).
ALTER DEFAULT PRIVILEGES IN SCHEMA infra
    GRANT SELECT ON TABLES TO kiaurastekinis, "viespirkiaiDev", viesduomenys;

COMMIT;
