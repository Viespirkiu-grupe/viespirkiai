# Konfigūracija (`.env`)

`.env` įkeliamas automatiškai — tiek paleidus `npm run dev`, tiek container'yje
(per `env_file` `compose.yml`'e). Tikri aplinkos kintamieji (pvz. iš shell ar
`docker compose`) turi pirmenybę prieš `.env` failo reikšmes. Loginės reikšmės:
`1/true/yes/on` = taip, `0/false/no/off` = ne.

`config.js` montuoti nebereikia — visa konfigūracija eina per `.env`. Nenustatyti
kintamieji krenta į numatytąsias schemos reikšmes (žr. `utils/configSchema.js`).

## Ką reikia turėti (infrastruktūra)

| Servisas | Kam | Būtinas? |
| --- | --- | --- |
| **PostgreSQL + PostGIS** | Pagrindinė DB. **Būtinas PostGIS plėtinys** (geografiniai tipai — gyvenamosios vietovės, žemėlapiai, WKB taškai). | Taip |
| **Typesense** | Paieškos pasiūlymai ir juridinių asmenų paieška. | Ne (be jo šios paieškos išjungtos) |
| **Quickwit** | Pilnatekstė sutarčių / viešųjų pirkimų / dokumentų paieška ir facetavimas. | Ne (krenta į lėtesnę Postgres paiešką) |
| **Tor (SOCKS5)** | Duomenų scrapinimas per Tor (tik taskrunneris). | Tik backend'ui |
| **Chromium** | OG paveikslėlių atvaizdavimas (jau įdiegtas Docker image'e). | Frontend'ui |
| **Blob saugykla** | OCR rezultatai, failų tekstas/metaduomenys, dokumentai. Lokaliai laikomi zstd SQLite; kitas host'as gali skaityti per HTTPS sidecar endpoint'ą. | Taip (failų funkcijoms) |

> **PostGIS:** DB turi būti su įjungtu plėtiniu: `CREATE EXTENSION IF NOT EXISTS postgis;`

## Du procesai

Kodą sudaro **du procesai**, skaitantys tą patį `.env`:

- **Frontend** — Astro web app (`npm run start` → `start-server.mjs`).
- **Backend** — taskrunneris (`./startTaskRunner.sh` → `tasks/index.js`): scrapinimas,
  OCR, indeksavimas, eksportas.

`.env.sample` suskirstytas į dvi dalis. Taisyklė: jei kintamasis naudojamas
**abiejuose** procesuose — jis dedamas į **frontend** sekciją. Backend sekcijoje —
tik tie, kuriuos naudoja **vien** taskrunneris. Taskrunneriui reikia **abiejų**
sekcijų kintamųjų.

---

## Frontend kintamieji

_(taskrunneris juos irgi naudoja)_

### Serveris

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `PORT` | `9019` | Portas, kuriame klausosi web serveris. |
| `LOG_REQUESTS` | `false` | Į `stderr` JSON formatu žurnaluoja kiekvieną HTTP užklausą: metodą, URL, tikrą kliento IP (atsižvelgiant į „Cloudflare“ antraštes) ir `User-Agent`. |
| `ENABLE_ATN1` | `false` | Įjungia CVPP / ATN-1 archyvo puslapius ir jų nuorodą navigacijoje. Išjungus tiesioginės šių puslapių užklausos grąžina `404`. |
| `ENABLE_BOT_CHALLENGE` | `false` | Įjungia lengvą JavaScript patikrą maršrutams `/`, `/viesiejiPirkimai`, `/dokumentai` ir `/juridiniai`. Pirma užklausa nustato sesijos slapuką `bot=no` ir perkrauna puslapį; JavaScript nevykdantys scraperiai iki paieškos neprieina. |
| `GIT_COMMIT` | _(iš `.git` arba `build-info.json`)_ | Paleistos versijos commit'o hash'as – footer'yje rodomas trumpasis hash'as su nuoroda į GitHub. **Paprastai nustatinėti nereikia:** `npm run build` (taip pat ir Docker build'as) hash'ą nuskaito iš `.git` ir įrašo į `build-info.json`, kuris įkepamas į image'ą. Kintamasis reikalingas tik ten, kur `.git` nepasiekiamas (build iš archyvo), arba norint reikšmę perrašyti. Alternatyvūs pavadinimai: `GIT_SHA`, `SOURCE_COMMIT`. |

### DB prisijungimas

Naudoja bendrą pool'ą (`postgres/postgres.js`) — reikalingas ir frontend'ui, ir
taskrunneriui.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `PG_HOST` | `localhost` | PostgreSQL host. |
| `PG_PORT` | `5432` | PostgreSQL portas. |
| `PG_USER` | `admin` | Vartotojas. |
| `PG_PASSWORD` | `""` | Slaptažodis. |
| `PG_DATABASE` | `viespirkiai` | DB pavadinimas. |
| `PG_MAX_CONNECTIONS` | `16` | Maks. vienalaikis pool dydis aplikacijos užklausoms. |
| `PG_DIRECT_HOST` | = `PG_HOST` | Postgres host aplenkiant pgbouncer'į. |
| `PG_DIRECT_PORT` | = `PG_PORT` | Postgres portas aplenkiant pgbouncer'į. Reikalingas TIK tada, kai `PG_PORT` rodo į bouncer'į: seanso lygio advisory lock'ai (`postgres/sessionLock.js`, JAR importas ir juridinių backfill'as) gyvena jungtyje, tad privalo eiti tiesiai į Postgres. |
| `SQL_LOG_FILE` | — | Kai nurodytas – visos SQL užklausos su trukme append'inamos į šį failą (JSONL). |
| `SQL_LOG_QUICKWIT` | `false` | Tie patys įrašai (be SQL teksto – tik `md5`) rašomi į dienos Quickwit indeksą `sqlLogV2_*`, o tekstas – į `sqlLogTekstai` lentelę. Galima kartu su `SQL_LOG_FILE` arba vietoj jo. |
| `PG_PREPARED` | `true` | Statiškas dažnas užklausas vykdyti kaip prepared statement'us. Su pgbouncer transaction pooling režimu palikti `true` galima – nuo pgbouncer 1.21 užtenka nustatyti `max_prepared_statements` į nenulinę reikšmę (`pg` naudoja protokolo lygio named statements, o bouncer juos paruošia susietoje serverio jungtyje). Išjungti (`false`) reikia tik prie senesnio bouncer'io arba kai `max_prepared_statements = 0`. |

Profiliavimui: `SQL_LOG_FILE=/tmp/sql.log` įjungia visų per `postgres.query()` ir
per `postgres.connect()` paimtus klientus einančių užklausų rašymą į failą.
Formatas – **JSONL** (po vieną JSON objektą eilutėje):

```json
{"ts":"2026-08-01T10:12:33.123Z","ms":4.2,"src":"pool","ok":true,"rows":7,
 "md5":"5496896004b26c9c4a522203a8be3afd","pool":{"total":16,"idle":0,"waiting":3},
 "queued":true,"sql":"SELECT * FROM sutartys WHERE id IN ($?)"}
```

| Laukas | Reikšmė |
| --- | --- |
| `ms` | Trukmė. **`src: "pool"` atveju apima ir laukimą laisvos jungties**, `src: "client"` – tik vykdymą (jungtis jau paimta). |
| `src` | `pool` (`postgres.query()`) arba `client` (`postgres.connect()` paimtas klientas). |
| `ok` / `code` | Sėkmė; klaidos atveju – `code` (pvz. `42P01`) vietoj `rows`. |
| `md5` | Normalizuotos užklausos hash'as – patogus `GROUP BY` raktas. Skaičiuojamas nuo pilno teksto, net kai `sql` nukerpamas ties 10 000 simbolių. |
| `pool` | Pool'o būsena **užklausos padavimo** metu. |
| `queued` | `true`, kai padavimo metu laisvų jungčių nebuvo ir pool jau pasiekęs `PG_MAX_CONNECTIONS` – tada į `ms` tikrai įskaičiuotas laukimas eilėje. |

Parametrų **reikšmės nerašomos** (jos ir taip perduodamos atskirai), o
pasikartojantys placeholder'iai bei inline literalų sąrašai sutraukiami iki
vieno (`$1, $2, … $5000` → `$?`, `VALUES ($1),($2),($3)` → `VALUES ($?)`) – taip
vienodos užklausos grupuojasi ir logas neišsipučia. `QueryStream` tipo užklausos
neloginamos.

Analizės pavyzdys – lėčiausios užklausų grupės:

```bash
jq -s 'group_by(.md5) | map({n: length, avg: (map(.ms) | add / length),
       queued: (map(select(.queued)) | length), sql: .[0].sql})
       | sort_by(-.avg) | .[:10]' /tmp/sql.log
```

#### `SQL_LOG_QUICKWIT` – logas tiesiai į Quickwit

`SQL_LOG_QUICKWIT=true` rašo tuos pačius įrašus į Quickwit — **po vieną
indeksą dienai**: `sqlLogV2_2026-08-01` (data iš `ts`, UTC).

**Į Quickwit siunčiamas tik `md5`, be paties SQL teksto.** Išmatuota, kad
390 tūkst. dokumentų tenka ~270 skirtingų užklausų formų (vidutiniškai 2 000
simbolių), tad tekstas ten kartotųsi ~1 400 kartų — apie 744 MB vietoj 0,5 MB.
Tekstą laiko Postgres lentelė `sqlLogTekstai` (žr. [`sqlLogTekstai.sql`](sqlLogTekstai.sql)),
į kurią kiekviena forma įrašoma **vieną kartą** (`INSERT … ON CONFLICT DO NOTHING`,
pati įrašymo užklausa į logą nepatenka):

```sql
SELECT "sql" FROM public."sqlLogTekstai" WHERE "md5" = '…';
```

Jei lentelės nėra (`42P01`) arba jungtis read-only (`25006`), rašymas išsijungia
su vienu įspėjimu — logavimas dėl to nenutrūksta, tik `md5` liks be teksto.

**Kitaip Postgres nedalyvauja**: jokių shard'ų, `quickwitLenteles`/`quickwitIndeksai`
įrašų ar schemos versijų. Indekso schema —
[`quickwit/sqlLogIndexConfig.js`](quickwit/sqlLogIndexConfig.js) (JS eilutė, o ne
.yaml failas: runtime image'e yra tik `dist`, tad failo ten paprasčiausiai nebūtų);
indeksą, jei tos dienos dar nėra, sukuria `quickwit/sqlLogIngest.js`.

Paieška per visas dienas — indeksų šablonu `sqlLogV2_*`. Senienų valymas
**rankinis**, retention politikos nėra: `pruneSqlLogIndexes({ keepDays: 30 })`
ištrina senesnių dienų indeksus (`dryRun: true` parodo, ką liestų). Seni
`sqlLog_*` (be V2) indeksai su kitokia schema paliekami ramybėje: į naują
šabloną nepakliūva ir valymo funkcijos neliečiami.

Dienos indeksas sukuriamas vieną kartą su tuo metu galiojančia schema — pakeitus
`sqlLogIndexConfig.js` nauji laukai atsiras tik kitos dienos indekse. Kol dienos
turi skirtingas schemas, užklausa `sqlLogV2_*` dėl naujo lauko grąžins klaidą
(`field does not exist`), o ne tuščią rezultatą; tokiu atveju arba ieškokite
konkrečioje dienoje, arba atnaujinkite indeksą per `PUT /api/v1/indexes/<id>`.

Dokumentai kaupiami buferyje ir siunčiami paketais (500 vnt. arba kas 1 s), tad
logavimas neblokuoja užklausų. Jei Quickwit nepasiekiamas, paketas prarandamas ir
klaida loginama ne dažniau kaip kartą per minutę — SQL užklausos dėl to nenukenčia.
Staigiai nutraukus procesą galima prarasti iki ~1 s buferio.

Kiekvienas Quickwit įrašas turi: `ts`, `ms`, `md5`, `src` (`pool`/`client`),
`ok`/`code`, `rows`, `pool`, `queued`, `op` (`select` | `insert` | `update` |
`delete` | `schema` | `tx` | `other`), `env` (`dev`/`prod`), `role` (`server` |
`taskRunner` | `worker` | `cli`, perrašoma `APP_ROLE`), o HTTP kelyje – dar
`host` (pvz. `beta.viespirkiai.org`, už proxy imamas `x-forwarded-host`). Fone ar
taskRunner'yje `host` lauko nėra. **`sql` teksto Quickwit'e nėra** – jis
`sqlLogTekstai` lentelėje; `SQL_LOG_FILE` faile tekstas rašomas kaip anksčiau.

Pavyzdžiai (`POST /api/v1/sqlLogV2_*/search`):

```bash
# Daugiausiai laiko valgančios užklausų formos (dažnis × trukmė)
curl -s 'localhost:7280/api/v1/sqlLogV2_*/search' -H 'Content-Type: application/json' -d '{
  "query": "*", "max_hits": 0,
  "aggs": {"grupes": {"terms": {"field": "md5", "size": 10, "order": {"viso_ms": "desc"}},
           "aggs": {"viso_ms": {"sum": {"field": "ms"}}, "vid_ms": {"avg": {"field": "ms"}}}}}}'

# Rašymai gyvoje aplinkoje / vieno domeno užklausos
curl -s 'localhost:7280/api/v1/sqlLogV2_*/search?query=env:prod+AND+NOT+op:select'
curl -s 'localhost:7280/api/v1/sqlLogV2_*/search?query=host:"beta.viespirkiai.org"'

# Užklausos, kurios laukė eilėje prie laisvos jungties
curl -s 'localhost:7280/api/v1/sqlLogV2_*/search' -H 'Content-Type: application/json' \
  -d '{"query": "queued:true AND ms:>1000", "max_hits": 20, "sort_by": "-ms"}'

# Klaidos
curl -s 'localhost:7280/api/v1/sqlLogV2_*/search?query=ok:false'
```

Gavus `md5`, tekstas imamas iš Postgres:

```sql
SELECT "md5", "sql" FROM public."sqlLogTekstai" WHERE "md5" = ANY($1);
```

### MCP `execute_query` + analitiko rolė

Read-only SQL prieiga per MCP (`src/lib/mcp.ts`). Analitikas naudoja **atskirą**
pool'ą su ribotomis teisėmis.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `ENABLE_EXECUTE_QUERY_MCP` | `false` | Įjungia `get_schema` ir `execute_query` MCP įrankius. |
| `ENABLE_EXECUTE_QUERY_MCP_ONLY` | `false` | Tik šie du SQL įrankiai, be jokių kitų MCP įrankių (lokaliam testavimui su prod instance). |
| `ENABLE_EXECUTE_QUERY_MCP_TRACE` | `false` | SQL užklausų ir rezultatų žurnalas į stderr. |
| `MCP_QUERY_TIMEOUT` | `20` | Vienos SQL užklausos timeout sekundėmis (`statement_timeout`). |
| `PG_ANALYST_USER` | — | Read-only DB rolė. **Privalo būti atskiras vartotojas — jokio fallback'o į `PG_*`.** |
| `PG_ANALYST_PASSWORD` | — | Analitiko slaptažodis. |
| `PG_ANALYST_PORT` | — | Analitiko prisijungimo portas. |
| `PG_ANALYST_MAX_CONNECTIONS` | `16` | Analitiko pool dydis. |

### Typesense

Paieškos pasiūlymai ir juridinių asmenų paieška.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `TYPESENSE_UP` | `false` | Ar Typesense pasiekiamas. `false` — susijusios paieškos išjungtos. |
| `TYPESENSE_API_KEY` | `""` | Typesense API raktas. |
| `TYPESENSE_NODES` | `[]` | JSON masyvas mazgų, pvz. `[{"host":"localhost","port":8108,"protocol":"http"}]`. |

### NATS

Signalų magistralė tarp procesų (SSE atnaujinimai, cache invalidacija). Pakeitė
PostgreSQL `pg_notify`/`LISTEN` — dėl to `postgres` pool'as nebeturi seansinių
priklausomybių ir gali eiti per pgbouncer.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `NATS_URL` | `nats://127.0.0.1:4222` | NATS serverio adresas. Tuščia reikšmė magistralę išjungia — kanalai tyliai neveikia, gavėjai krenta į savo fallback'us (SSE persijungęs persikrauna, baneris pollinamas). |
| `NATS_TOKEN` | `""` | Autentikacijos token'as; turi sutapti su serverio `authorization.token`. |

### Quickwit

Pilnatekstė paieška ir facetavimas.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `QUICKWIT_UP` | `false` | Ar Quickwit pasiekiamas. `false` — krenta į Postgres paiešką. |
| `QUICKWIT_URL` | `http://localhost:7280` | Quickwit bazinis URL. |
| `SUTARTYS_QUICKWIT` | — | Sutarčių paieškai naudoti Quickwit. |
| `VIESIEJI_PIRKIMAI_QUICKWIT` | — | Viešųjų pirkimų paieškai naudoti Quickwit. |

### Failų / dokumentų vietos

Lokaliam darbui naudojami tik `*_SQLITE_LOCATION`: tai pilni `.sqlite` failų
keliai. Turinys laikomas zstd suspaustas. SQLite vieta privaloma kiekvienam
procesui, kuris rašo sidecar'us; be jos write baigiasi klaida.

`FAILAI_LOCATION`, `DOKUMENTAI_LOCATION` ir `OCR_REZULTATAI_LOCATION` nebepalaiko
lokalių katalogų. Juose galima nurodyti tik HTTP(S) endpoint'ą nuotoliniam read
fallback. Skaitymo tvarka: lokalus SQLite, tada HTTP(S). Endpoint'ą aptarnaujantis
mazgas skaito tik savo SQLite ir taip išvengia rekursinių HTTP užklausų.

Nuotolinį režimą aptarnauja šie endpoint'ai (kitas mazgas jų URL įsirašo į
atitinkamą `*_LOCATION`):

| Kintamasis | Endpoint'as | Užklausa |
| --- | --- | --- |
| `FAILAI_LOCATION` | `src/pages/api/failai/failaiInfoFiles.ts` | `<URL>?hash=<hash>` |
| `DOKUMENTAI_LOCATION` | `src/pages/api/dokumentai/dokumentaiFiles.ts` | `<URL>?md5=<md5>` |
| `OCR_REZULTATAI_LOCATION` | `src/pages/api/ocr/rezultataiFiles.ts` | `<URL>?md5=<md5>` |

| Kintamasis | Paaiškinimas |
| --- | --- |
| `INTERNAL_FILE_BASE` | Vidinio failų CDN bazinis URL — preview nuorodoms sudaryti. Numatyta: `https://failai.viespirkiai.org`. |
| `OCR_REZULTATAI_LOCATION` | Pasirenkamas nuotolinis OCR HTTP(S) read endpoint'as. |
| `DOKUMENTAI_LOCATION` | Pasirenkamas nuotolinis dokumentų HTTP(S) read endpoint'as. |
| `FAILAI_LOCATION` | Pasirenkamas nuotolinis failų turinio HTTP(S) read endpoint'as. |
| `FAILAIINFO_SQLITE_LOCATION` | Pilnas sujungto failų turinio SQLite failo kelias. |
| `DOKUMENTAI_SQLITE_LOCATION` | Pilnas dokumentų sidecar SQLite failo kelias. |
| `OCR_REZULTATAI_SQLITE_LOCATION` | Pilnas OCR rezultatų SQLite failo kelias. |

PostgreSQL referencinius hash'us galima paketais palyginti su
SQLite, neatliekant brangaus bendro `COUNT(DISTINCT ...)`:

```bash
npm run sidecars:sqlite-missing -- --store dokumentai
```

Kiekvienas nerastas raktas išvedamas kaip `TRŪKSTA <hash>`. Galimi
`--store failaiInfo|dokumentai|ocr`, `--db`, `--page`, `--limit` ir
`--after <hash>`.

### Kita

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `OCR_BANDYMAI` | `5` | Kiek kartų bandyti OCR vienam failui prieš pažymint kaip nepavykusį. |
| `ENABLE_GRAPH` | `false` | Ryšių grafiko funkcija UI. |
| `ONION_ADDRESS` | — | Tor onion adresas, skelbiamas per HTTP antraštę. |
| `ANALITIKA_URL` | `""` | Išorinis analitikos URL (`/analitika` peradresuoja į jį). |
| `CUSTOM_HEAD` | `""` | HTML, įterpiamas į kiekvieno puslapio `<head>`. |

---

## Backend kintamieji

_(naudoja tik taskrunneris)_

### Tor / proxy scrapinimui

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `TOR_ADDRESS` | `socks5h://127.0.0.1:9050` | SOCKS5 proxy adresas scrapinimui. |
| `TOR_PASSWORD` | `""` | Tor control slaptažodis (grandinės keitimui). |

### Išorinių šaltinių URL

Baziniai URL — galima perrašyti į mirror/proxy. Be trailing slash.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `DATA_GOV_URL` | `https://get.data.gov.lt` | data.gov.lt bazinis URL (import scraperiai). |
| `VIESIEJI_PIRKIMAI_URL` | `https://viesiejipirkimai.lt` | Viešųjų pirkimų portalo (EPPS) bazinis URL scrapinimui/parsisiuntimui. |
| `2021_ESINVESTICIJOS` | `https://2021.esinvesticijos.lt` | 2021–2027 ES investicijų portalo bazinis URL CPVA duomenų scrapinimui. |

### e-TAR (`modules/eTar`)

Naujasis e-TAR scraperis eina ne tiesiai į `e-tar.lt`, o į stateless HTML→JSON
adapterį (jo OpenAPI: `<ETAR_API_URL>/openapi.json`). Normalizuoti duomenys
guli Postgres `eTar*` lentelėse, o pilnas atsakymo JSON — SQLite sidecar'e,
adresuojamas `md5` (žr. `modules/eTar/README.md`).

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `ETAR_API_URL` | — | Adapterio bazinis URL, pvz. `http://10.1.10.24:8080`. Be trailing slash. Nenustačius scraperis nepasileidžia. |
| `ETAR_API_KEY` | `""` | Bearer raktas — tik jei adapteryje nustatytas `API_KEY`. |
| `ETAR_SIDECAR_DIR` | `/flashas/viespirkiai/eTar` | Katalogas, kuriame laikoma `eTar.sqlite` atsakymų saugykla (tik lokalus kelias). |

### Spinta / Stalčius (atviri duomenys)

Eksportas į „spintos" tipo API serverį (`modules/spinta/`). Klientas pasirenka
autentifikaciją pagal užpildytus laukus: jei nustatytas `SPINTA_API_KEY` —
naudojamas jis (Stalčius, Bearer), kitaip OAuth client-credentials (Spinta).

| Kintamasis | Paaiškinimas |
| --- | --- |
| `SPINTA_SERVER` | Serverio bazinis URL. |
| `SPINTA_API_KEY` | Stalčiaus statinis rašymo API raktas (jei užpildytas — OAuth praleidžiamas). |
| `SPINTA_CLIENT` | Spinta OAuth `client_id`. |
| `SPINTA_SECRET` | Spinta OAuth `client_secret`. |
| `SPINTA_NAMESPACE` | Namespace, į kurį rašoma (pvz. `datasets/gov/viespirkiai`). |
| `SPINTA_SCOPES` | JSON masyvas OAuth scope'ų. Tuščias — pilnas rašymo rinkinys. |

---

## Automatiškai nustatomi (ne per `.env`)

| Laukas | Kaip nustatomas |
| --- | --- |
| `dev` | Pagal `NODE_ENV` — `true`, kai `NODE_ENV !== "production"`. Naudojamas dev log'ams, info banerio aplinkai, logotipui. |
| `infoBanner` | Iš DB lentelės `public."infoBaneris"` (ne per config), keitimai plinta per `pg_notify`. |
