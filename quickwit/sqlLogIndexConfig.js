/**
 * Quickwit indekso schema SQL logui – kaip eilutė, o ne .yaml failas.
 *
 * Failo skaityti negalima: runtime image'e (Dockerfile) yra tik `dist`, o po
 * bundlinimo `import.meta.url` rodo į chunk'o katalogą, kur jokių .yaml nėra.
 * Tas pats modulis turi veikti ir plainame Node (taskRunner, CLI), ir Astro
 * bundle'e, tad schema laikoma čia.
 *
 * `index_id` yra šablonas – `quickwit/sqlLogIngest.js` prieš kurdamas pakeičia
 * jį į tos dienos vardą (`sqlLogV2_2026-08-01`).
 *
 * SVARBU: placeholder'is be apatinio brūkšnio (`sqlLogV2Template`, ne
 * `sqlLogV2_TEMPLATE`) – kitaip netyčia sukurtas šabloninis indeksas pakliūtų į
 * `sqlLogV2_*` paiešką ir, turėdamas kitokią schemą, griautų visas užklausas
 * („field does not exist").
 */
export const SQL_LOG_INDEX_CONFIG = `# SQL užklausų logas – po vieną Quickwit indeksą kiekvienai dienai, be jokio
# Postgres tarpininko.
#
# \`index_id\` čia yra tik šablonas: \`quickwit/sqlLogIngest.js\` prieš kurdamas
# pakeičia jį į tos dienos pavadinimą pagal \`ts\` (UTC), pvz. \`sqlLogV2_2026-08-01\`.
# Todėl:
#   * paieška per visas dienas – indeksų šablonu \`sqlLogV2_*\`;
#   * senienų valymas – tiesiog ištrinant senų dienų indeksus
#     (\`pruneSqlLogIndexes()\`), o ne split'ų retention politika.
#
# Skirtingai nuo \`sutartys\`/\`dokumentai\`/\`juridiniai\`, čia NĖRA nei shard'ų, nei
# \`quickwitLenteles\`/\`quickwitIndeksai\` versijavimo — dokumentai rašomi tiesiai.
#
# Pakeitus šį failą jau sukurti indeksai NEPERSIKURIA; nauja schema pritaikoma
# kitos dienos indeksui (arba per \`PUT /api/v1/indexes/<id>\`).
version: 0.9

index_id: sqlLogV2Template

doc_mapping:
  # \`lenient\` – nauji laukai loge nesugriaus ingest'o; nežinomi tiesiog dingsta.
  mode: lenient
  store_source: false
  index_field_presence: false

  field_mappings:
    - name: ts
      type: datetime
      input_formats: [rfc3339, unix_timestamp]
      output_format: rfc3339
      fast_precision: milliseconds
      indexed: true
      fast: true
      stored: true

    # Trukmė ms. \`pool\` šaltiniui apima ir laukimą eilėje prie jungties,
    # \`client\` – tik vykdymą (žr. \`src\`).
    - name: ms
      type: f64
      indexed: true
      fast: true
      stored: true

    # select | insert | update | delete | schema (DDL) | tx | other
    - name: op
      type: text
      tokenizer: raw
      indexed: true
      fast: true
      stored: true

    # dev | prod (pagal NODE_ENV)
    - name: env
      type: text
      tokenizer: raw
      indexed: true
      fast: true
      stored: true

    # server | taskRunner | worker | cli (arba APP_ROLE reikšmė)
    - name: role
      type: text
      tokenizer: raw
      indexed: true
      fast: true
      stored: true

    # HTTP hostas, kurį aptarnaujant vykdyta užklausa: viespirkiai.org,
    # beta.viespirkiai.org, 192.168.1.10:5050… Už proxy imamas
    # \`x-forwarded-host\`. taskRunner'yje/CLI lauko nėra.
    - name: host
      type: text
      tokenizer: raw
      indexed: true
      fast: true
      stored: true

    # pool | client
    - name: src
      type: text
      tokenizer: raw
      indexed: true
      fast: true
      stored: true

    - name: ok
      type: bool
      indexed: true
      fast: true
      stored: true

    # Postgres klaidos kodas (pvz. 42P01); yra tik kai ok = false.
    - name: code
      type: text
      tokenizer: raw
      indexed: true
      fast: true
      stored: true

    - name: rows
      type: i64
      indexed: true
      fast: true
      stored: true

    # Normalizuotos užklausos md5 – pagrindinis grupavimo raktas
    # (term agregacijos „lėčiausios užklausų grupės").
    - name: md5
      type: text
      tokenizer: raw
      indexed: true
      fast: true
      stored: true

    # Pool'o būsena užklausos padavimo metu.
    - name: pool
      type: object
      field_mappings:
        - name: total
          type: i64
          indexed: true
          fast: true
          stored: true
        - name: idle
          type: i64
          indexed: true
          fast: true
          stored: true
        - name: waiting
          type: i64
          indexed: true
          fast: true
          stored: true

    # true, kai padavimo metu laisvų jungčių nebuvo ir pool jau pasiekęs
    # PG_MAX_CONNECTIONS – t. y. į \`ms\` tikrai įskaičiuotas laukimas eilėje.
    - name: queued
      type: bool
      indexed: true
      fast: true
      stored: true

  # Splitų pruning'ui pagal dažniausius filtrus. \`md5\` kardinalumas didesnis,
  # tad Quickwit dalyje splitų tag'ų gali ir nesaugoti – tada tiesiog nebus
  # pruning'o, paieška vis tiek veiks.
  tag_fields: [env, role, host, op, src, md5]

  timestamp_field: ts

search_settings:
  # \`sql\` lauko čia nebėra – tekstas gyvena Postgres lentelėje \`sqlLogTekstai\`.
  default_search_fields: [md5]

indexing_settings:
  # Logas – ne paieškos kritinis kelias, tad rečiau commit'inam ir gaunam
  # mažiau splitų bei merge'ų.
  commit_timeout_secs: 30

# \`retention\` sąmoningai nenaudojama: dienos indeksas trinamas visas, žr.
# \`pruneSqlLogIndexes()\`.
`;
