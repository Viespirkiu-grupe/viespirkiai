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
| **Blob saugykla** | OCR rezultatai, failų tekstas/metaduomenys, dokumentai. Gali būti **lokalus katalogas** (`/flashas/...`) **arba nuotolinis HTTPS sidecar endpoint'as** (kitas host'as, atsakantis į `?md5=...`). | Taip (failų funkcijoms) |

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

### Quickwit

Pilnatekstė paieška ir facetavimas.

| Kintamasis | Numatyta | Paaiškinimas |
| --- | --- | --- |
| `QUICKWIT_UP` | `false` | Ar Quickwit pasiekiamas. `false` — krenta į Postgres paiešką. |
| `QUICKWIT_URL` | `http://localhost:7280` | Quickwit bazinis URL. |
| `SUTARTYS_QUICKWIT` | — | Sutarčių paieškai naudoti Quickwit. |
| `VIESIEJI_PIRKIMAI_QUICKWIT` | — | Viešųjų pirkimų paieškai naudoti Quickwit. |

### Failų / dokumentų vietos

Kiekviena reikšmė gali būti **absoliutus kelias** (lokalus katalogas, pvz.
`/data/failaiTekstas`) arba **HTTPS URL** (nuotolinis sidecar endpoint'as, pvz.
`https://failai.example.lt/api/failai/tekstasFiles`). Tuščia — funkcija išjungta.

- **Lokalus kelias** — failai skaitomi/rašomi tiesiai diske (sharding'as pagal
  `md5` pirmus simbolius).
- **Nuotolinis URL** — turinys **skaitomas** HTTP užklausa `<URL>?md5=<md5>`
  (naudinga, kai frontend'as ir duomenų diskas skirtinguose host'uose). Į
  nuotolinę vietą **rašyti negalima** — tik lokalus kelias palaiko įrašymą (OCR
  rezultatų / teksto išsaugojimą daro taskrunneris, turintis lokalų diską).

| Kintamasis | Paaiškinimas |
| --- | --- |
| `INTERNAL_FILE_BASE` | Vidinio failų CDN bazinis URL — preview nuorodoms sudaryti. |
| `OCR_REZULTATAI_LOCATION` | OCR rezultatų blob saugykla. |
| `DOKUMENTAI_LOCATION` | Dokumentų JSON sidecar failai (raktas: `md5`). |
| `FAILAI_LOCATION` | Sujungti failo turinio JSON failai (tekstas + metaduomenys + subjektai). |
| `FAILAI_METADUOMENYS_LOCATION` | Failų metaduomenų sidecar JSON. _Senas — bus perkelta į `FAILAI_LOCATION`._ |
| `FAILAI_TEKSTAS_LOCATION` | Failų išgauto teksto saugykla. _Senas — bus perkelta į `FAILAI_LOCATION`._ |

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
