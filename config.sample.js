// Pavyzdinis konfigūracijos failas. Nukopijuokite į `config.js` ir
// pakoreguokite reikšmes pagal aplinką. Šis failas yra registruojamas git'e
// kaip referencija — `config.js` lieka lokalus.

export default {
    // ─────────────────────────────────────────────────────────────────────
    // Bendri puslapio nustatymai
    // ─────────────────────────────────────────────────────────────────────

    // HTML, įterpiamas į kiekvieno puslapio <head> (pvz. analitikos skriptas,
    // papildomas CSS). Tuščia eilutė — nieko nepridedama.
    customHead: ``,

    // Išorinis analitikos URL. /analitika nuoroda peradresuoja į jį (pvz.
    // Plausible dashboard). Tuščia — nuoroda neveikia.
    analitikaUrl: ``,

    // Tor onion adresas, skelbiamas per HTTP antraštę. Paliekam undefined,
    // jei nenaudojame Tor.
    onionAddress: undefined,

    // Informacinis baneris viršuje valdomas per DB lentelę public."infoBaneris"
    // (laukai: content, type, important, enabled, aplinka [NULL=visur | 'dev' | 'prod']).
    // Lentelė sukuriama automatiškai; keitimai pasklinda per pg_notify trigger'į.

    // ─────────────────────────────────────────────────────────────────────
    // HTTP serveris
    // ─────────────────────────────────────────────────────────────────────

    // Portas, kuriame klausosi serveris.
    port: 9019,

    // ─────────────────────────────────────────────────────────────────────
    // PostgreSQL — pagrindinė DB
    // ─────────────────────────────────────────────────────────────────────

    pgHost: "localhost",
    pgPort: 9118,
    pgUser: "admin",
    pgPassword: "CHANGE_ME",
    pgDatabase: "viespirkiai",

    // Maksimalus vienalaikis pool dydis aplikacijos užklausoms.
    pgMaxConnections: 16,

    // Debuginimui: logina visas per postgres.query() einančias užklausas su
    // trukme (connect() paimti klientai/streamai neliečiami).
    pgLogQueries: false,
    // Logina tik užklausas, trukusias >= tiek ms (0 = visas).
    pgLogQueriesMinMs: 0,
    // Jei nurodytas kelias – užklausos papildomai rašomos į šį failą (be ANSI
    // spalvų, su pilna data). null = rašoma tik į konsolę.
    pgLogQueriesFile: null,

    // Profiliavimui: kai nurodytas kelias (arba SQL_LOG_FILE env), VISOS
    // užklausos (pool ir connect() klientai) append'inamos į šį failą JSONL
    // formatu: {ts, ms, src, ok, rows|code, md5, pool, queued, sql}. Parametrų
    // reikšmės nerašomos, pasikartojantys placeholder'iai sutraukiami iki vieno
    // ($?), o `md5` – normalizuotos užklausos hash'as grupavimui. Žr. ENV.md.
    sqlLogFile: null,

    // Dažniausios statiškos užklausos vykdomos kaip prepared statement'ai
    // (planas paruošiamas kartą jungčiai). Išjungti reikia tik jungiantis per
    // pgbouncer transaction pooling režimu be `max_prepared_statements`.
    pgPrepared: true,

    // ─────────────────────────────────────────────────────────────────────
    // Typesense — paieškos pasiūlymai ir juridinių asmenų paieška
    // ─────────────────────────────────────────────────────────────────────

    // Jei Typesense nepasiekiamas — false, susijusios paieškos bus išjungtos.
    typesenseUp: true,
    typesenseNodes: [{ host: "localhost", port: 9021, protocol: "http" }],
    typesenseApiKey: "CHANGE_ME",

    // ─────────────────────────────────────────────────────────────────────
    // Quickwit — pilnatekstė failų turinio paieška
    // ─────────────────────────────────────────────────────────────────────

    quickwitUp: true,
    quickwitUrl: "http://localhost:7280",

    // ─────────────────────────────────────────────────────────────────────
    // Scraping — Tor proxy duomenų rinkimui
    // ─────────────────────────────────────────────────────────────────────

    torAddress: "socks5h://127.0.0.1:9050",
    torPassword: "CHANGE_ME",

    // Išorinių duomenų šaltinių baziniai URL. Galima perrašyti į mirror/proxy
    // (pvz. lokalų cache). Be trailing slash. Paliekam numatytuosius —
    // tikrieji viešieji šaltiniai.
    dataGovUrl: "https://get.data.gov.lt",
    viesiejiPirkimaiUrl: "https://viesiejipirkimai.lt",
    esInvesticijos2021Url: "https://2021.esinvesticijos.lt",

    // e-TAR scraperis (modules/eTar) eina ne tiesiai į e-tar.lt, o į stateless
    // HTML→JSON adapterį. Tuščia reikšmė = scraperis neveikia.
    eTarApiUrl: "http://10.1.10.24:8080",
    // Bearer raktas — tik jei adapteryje nustatytas API_KEY.
    eTarApiKey: "",

    // ─────────────────────────────────────────────────────────────────────
    // Failai ir OCR
    // ─────────────────────────────────────────────────────────────────────

    // Vidinio failų CDN bazinis URL — naudojamas preview nuorodoms sudaryti.
    internalFileBase: "https://failai.viespirkiai.org",

    // Kiek kartų bandyti OCR vienam failui prieš pažymint kaip nepavykusį.
    ocrBandymai: 5,

    // ─────────────────────────────────────────────────────────────────────
    // Blob saugyklų vietos
    // Kiekviena reikšmė gali būti:
    //   - undefined           — funkcija išjungta;
    //   - absoliutus kelias   — lokalus katalogas (pvz. "/data/ocrRezultatai");
    //   - HTTPS URL           — nuotolinis sidecar endpoint'as
    //                           (pvz. "https://host/api/ocr/rezultataiFiles").
    // ─────────────────────────────────────────────────────────────────────

    // OCR rezultatų blob saugyklą.
    ocrRezultataiLocation: undefined,

    // Sujungti failo turinio JSON failai (raktas: failasHash) — apima tekstą,
    // metaduomenis ir išgautus subjektus (iban, jarKodai, links, emails,
    // domains, telefonai).
    failaiLocation: undefined,

    // Dokumentų JSON sidecar failai (raktas: md5).
    dokumentaiLocation: undefined,

    // e-TAR API atsakymų SQLite sidecar (raktas: md5). Skirtingai nuo aukščiau
    // esančių — ne failų medis, o viena SQLite bazė kataloge, ir tik lokali.
    eTarSidecarDir: "/flashas/viespirkiai/eTar",

    // ─────────────────────────────────────────────────────────────────────
    // Eksperimentinės / prototipinės funkcijos
    // ─────────────────────────────────────────────────────────────────────

    // Ryšių grafiko funkcija visoje UI.
    enableGraph: false,

    // ─────────────────────────────────────────────────────────────────────
    // MCP execute_query įrankis
    // Read-only SQL prieigai per MCP. Naudoja atskirą "analyst" rolę su
    // savo pool'u.
    // ─────────────────────────────────────────────────────────────────────

    // Rodyti `get_schema` ir `execute_query` MCP įrankius.
    enableExecuteQueryMcp: false,

    // Tik šie du SQL įrankiai be jokių kitų MCP įrankių. Skirta lokaliam
    // testavimui kartu su prod viespirkiai instance.
    enableExecuteQueryMcpOnly: false,

    // SQL užklausų ir rezultatų žurnalas į stderr (debug'inimui).
    enableExecuteQueryMcpTrace: false,

    // Read-only PG rolė SQL užklausoms. Atskira nuo pgUser, kad teisės būtų
    // ribotos.
    pgAnalystUser: "analyst",
    pgAnalystPassword: "CHANGE_ME",
    pgAnalystPort: 9118,
    pgAnalystMaxConnections: 16,

    // Vienos SQL užklausos timeout sekundėmis (statement_timeout).
    mcpQueryTimeout: 20,

    // ─────────────────────────────────────────────────────────────────────
    // Spinta / Stalčius (atviri duomenys)
    // Eksportas į „spintos“ tipo API serverį. Žiūrėk modules/spinta/.
    // Palaikomi du serveriai (vienodas rašymo protokolas — NDJSON `_op`):
    //   • Spinta   — OAuth client-credentials (spintaClient/spintaSecret/scope'ai)
    //   • Stalčius — vienas statinis API raktas (spintaApiKey)
    // Klientas pasirenka pagal tai, kas užpildyta: jei nustatytas spintaApiKey,
    // naudojamas jis (Bearer), o OAuth (token endpoint) praleidžiamas.
    // ─────────────────────────────────────────────────────────────────────

    // Serverio bazinis URL (su trailing slash arba be).
    // Pvz. "https://put.duomenys.example.lt".
    spintaServer: "",

    // Stalčius: statinis rašymo API raktas (siunčiamas kaip Authorization:
    // Bearer …). Atitinka Stalčiaus serverio API_KEY. Jei užpildytas — OAuth
    // (spintaClient/spintaSecret/spintaScopes) ignoruojamas.
    spintaApiKey: "",

    // Spinta: OAuth client-credentials prisijungimas. client_id + client_secret
    // iš spintos administracijos. Naudojama tik kai spintaApiKey tuščias.
    spintaClient: "",
    spintaSecret: "",

    // Namespace, į kurį rašoma. Pvz. "datasets/gov/viespirkiai".
    // Naudojamas tiek modelių kelio prefiksui, tiek default scope'ams
    // sudaryti (spinta_<ns_su_pabraukimais>_insert ir pan.).
    spintaNamespace: "",

    // Spinta OAuth scope'ai. Paliekam tuščią — naudojam pilną rašymo
    // rinkinį (spinta_getone/getall/search/changes/insert/upsert/update/
    // patch/delete/set_meta_fields). Atitinka standartinį „writer“ klientą
    // (`spinta client add --scope "spinta_getall spinta_getone ..."`).
    // Stalčiui nereikia — jis naudoja vieną API raktą.
    spintaScopes: [],
};
