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
| **Sidecar saugykla** | OCR rezultatai, failų tekstas/metaduomenys, dokumentai, LITEKO2, e-TAR. Vienas `SIDECAR_DIR` katalogas su zstd SQLite bazėmis; kitas host'as skaito per `/api/v1/sidecar/<vardas>`. | Taip (failų funkcijoms) |

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
| `APP_ENV` | pagal `NODE_ENV` | Logų aplinkos žyma (`dev` arba `prod`), viršesnė už `NODE_ENV`. Tiesiogiai paleistam produkciniam taskrunneriui nustatyti `prod`. |
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
| `SCRAPE_LOG_FILE` | — | Kai nurodytas – outbound duomenų šaltinių HTTP užklausų metaduomenys append'inami JSONL formatu. |
| `SCRAPE_LOG_QUICKWIT` | `false` | Tie patys scraping metaduomenys rašomi į dienos Quickwit indeksą `scrapeLogV1_*`. |
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

#### `SCRAPE_LOG_*` – outbound duomenų šaltinių užklausos

Scraperiai naudoja `utils/scrapeFetch.js` wrapperį, todėl neliečiamas globalus
`fetch` ir į logą nepatenka Quickwit ingest'as, S3, Spinta, Ollama ar frontend
HTTP srautas. Kiekvienas realus retry bandymas registruojamas atskirai.

`SCRAPE_LOG_QUICKWIT=true` rašo į dieninius `scrapeLogV1_YYYY-MM-DD` indeksus;
`SCRAPE_LOG_FILE=/tmp/scrape.log` tuos pačius dokumentus append'ina JSONL
formatu. Logavimas best-effort: Quickwit siunčiama paketais fone, o gedimas
scraperio nestabdo. Senus indeksus galima valyti su
`pruneScrapeLogIndexes({ keepDays: 30 })`.

Pilnas URL nesaugomas. Jis išskaidomas į `scheme`, `host`, `domain` ir `path`
(`pathname + query`); slapti query parametrai maskuojami. `domain` yra paskutiniai
du hostname segmentai, IP ir `localhost` paliekami nepakeisti. Redirect atveju
pridedami analogiški `final*` laukai.

Kiti svarbiausi laukai: `scraper`, `operation`, `method`, `status`, `ok`,
`ttfbMs`, viso body perdavimo `ms`, faktiškai perskaityti `bytes` ir serverio
deklaruotas `contentLength`. Kai HTTP atsakymo nėra, `status` yra `null`, o
`errorName`/`errorCode` nusako timeout, DNS ar kitą transporto klaidą. Body,
Authorization, cookies ir kiti request/response headeriai niekada nesaugomi.

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

Signalų magistralė tarp procesų (TaskRunner DB eilių pažadinimai, SSE
atnaujinimai, cache invalidacija). TaskRunner darbai ir retry būsena lieka
PostgreSQL, o NATS perduoda tik at-most-once užuominą patikrinti eilę. Pakeitė
PostgreSQL `pg_notify`/`LISTEN` — dėl to `postgres` pool'as nebeturi seansinių
priklausomybių ir gali eiti per pgbouncer.
Gyvą šios magistralės wildcard srautą galima stebėti `/statistika/nats` puslapyje;
istoriją (iki 1000 eventų) laiko tik atidariusi naršyklė.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `NATS_URL` | `nats://127.0.0.1:4222` | NATS serverio adresas. Tuščia reikšmė magistralę išjungia — kanalai tyliai neveikia, gavėjai krenta į savo fallback'us (TaskRunner tikrina DB pasibaigus `cooldown`, SSE persijungęs persikrauna, baneris pollinamas). |
| `NATS_TOKEN` | `""` | Autentikacijos token'as; turi sutapti su serverio `authorization.token`. |

### Quickwit

Pilnatekstė paieška ir facetavimas.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `QUICKWIT_UP` | `false` | Ar Quickwit pasiekiamas. `false` — krenta į Postgres paiešką. |
| `QUICKWIT_URL` | `http://localhost:7280` | Quickwit bazinis URL. |
| `SUTARTYS_QUICKWIT` | — | Sutarčių paieškai naudoti Quickwit. |
| `VIESIEJI_PIRKIMAI_QUICKWIT` | — | Viešųjų pirkimų paieškai naudoti Quickwit. |

### Sidecar saugyklos

Visos sidecar SQLite bazės guli **viename kataloge**, po vieną failą kiekvienam
registro įrašui. Vardas yra vienintelis identifikatorius — iš jo išvedamas ir
failo kelias, ir HTTP kelias:

```
failas(vardas) = <SIDECAR_DIR>/<vardas>.sqlite
URL(vardas)    = <SIDECAR_REMOTE>/api/v1/sidecar/<vardas>?md5=<raktas>
```

Registras — `utils/sidecarPaths.js`:

| Vardas | Failas | Kas viduje |
| --- | --- | --- |
| `failaiInfo` | `failaiInfo.sqlite` | Sujungtas failo turinio JSON (raktas: turinio hash). |
| `dokumentai` | `dokumentai.sqlite` | Dokumentų JSON (tekstas, metaduomenys, subjektai). |
| `ocrRezultatai` | `ocrRezultatai.sqlite` | OCR rezultatai. |
| `liteko2` | `liteko2.sqlite` | LITEKO2 sprendimai (`modules/liteko2`). |
| `eTar` | `eTar.sqlite` | e-TAR API atsakymai (`modules/eTar`). |

Kiekviena bazė lieka atskiru failu: SQLite turi vieną rašytoją visai bazei, o
čia lygiagrečiai rašo skirtingi procesai (OCR darbininkai, scraper'iai, eTar
taskrunner) — sujungus jie rikiuotųsi eilėje prie to paties WAL.

Turinys laikomas zstd suspaustas. `SIDECAR_DIR` privalomas kiekvienam procesui,
kuris rašo sidecar'us; be jo write baigiasi klaida.

| Kintamasis | Paaiškinimas |
| --- | --- |
| `SIDECAR_DIR` | Katalogas su visomis sidecar SQLite bazėmis. Būtinas rašymui. |
| `SIDECAR_REMOTE` | Mazgo su lokaliomis bazėmis bazinis URL — nuotolinis read fallback mazgams be `SIDECAR_DIR`. |
| `INTERNAL_FILE_BASE` | Vidinio failų CDN bazinis URL — preview nuorodoms sudaryti. Numatyta: `https://failai.viespirkiai.org`. |

Skaitymo tvarka: lokalus SQLite, tada `SIDECAR_REMOTE`. Endpoint'ą aptarnaujantis
mazgas skaito tik savo SQLite ir taip išvengia rekursinių HTTP užklausų.

#### HTTP API (tik skaitymas)

Rašymo per HTTP nėra — rašo tik mazgas, turintis lokalų `SIDECAR_DIR`.

```
GET  /api/v1/sidecar/<vardas>?md5=<md5>
     200 application/json — turinys; 404 nerastas; 400 blogas md5;
     404 nežinomas vardas; 503 SIDECAR_DIR nenustatytas

POST /api/v1/sidecar/<vardas>/batch
     body: ["<md5>", …] arba md5 per eilutę, daugiausia 500 vienu kartu
     200 application/x-ndjson — po eilutę {"md5":…,"turinys":…}, tik rastiems
```

Batch atsakymas streaminamas gabalais, o nerastų raktų eilučių jame nėra — ko
negrįžo, to nėra.

#### Trūkstamų įrašų patikra

PostgreSQL referencinius hash'us galima paketais palyginti su
SQLite, neatliekant brangaus bendro `COUNT(DISTINCT ...)`:

```bash
npm run sidecars:sqlite-missing -- --store dokumentai
```

Kiekvienas nerastas raktas išvedamas kaip `TRŪKSTA <hash>`. Galimi
`--store failaiInfo|dokumentai|ocrRezultatai|liteko2|eTar`, `--db`, `--page`,
`--limit` ir `--after <hash>`.

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
| `ETAR_RECENT_DAYS` | `180` | Kiek naujausių dienų periodiškai iš naujo tikrina TaskRunner radaras. |
| `ETAR_REFRESH_HOURS` | `3` | Po kiek valandų radaro diena vėl laikoma tikrintina. |
| `ETAR_MAX_INFLIGHT` | `6` | Bendras lygiagrečių užklausų į e-TAR adapterį limitas visiems etapams. |

Prieš pirmą naujų TaskRunner e-TAR darbų paleidimą reikia rankiniu būdu
pritaikyti `modules/eTar/taskRunnerQueue.sql`. TaskRunner pats DB schemos nekeičia.

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
