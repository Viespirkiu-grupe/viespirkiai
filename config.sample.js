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

    // Informacinis baneris viršuje. Variantai:
    //   1) String — automatinis judantis tekstas (marquee):
    //        infoBanner: "Dalis funkcijų gali laikinai neveikti dėl atnaujinimo."
    //   2) Objektas su lauku `type` ("text" arba "html"), `content` ir
    //      `important` (jei true — light mode juodas fonas, dark mode baltas):
    //        infoBanner: {
    //            type: "html",
    //            content: "<strong>Svarbu:</strong> dalis funkcijų neveikia.",
    //            important: true,
    //        }
    // undefined — baneris nerodomas.
    infoBanner: undefined,

    // ─────────────────────────────────────────────────────────────────────
    // HTTP serveris
    // ─────────────────────────────────────────────────────────────────────

    // Portas, kuriame klausosi serveris.
    port: 9019,

    // Reverse proxy IP, kurio X-Forwarded-* antraštėmis pasitikim. Be šio
    // nustatymo klientų IP bus matomas kaip proxy IP.
    proxyIp: "127.0.0.1",

    // ─────────────────────────────────────────────────────────────────────
    // App elgsena
    // ─────────────────────────────────────────────────────────────────────

    // HTML atsako minifikacija. Įjungti tik production'e — dev'e apsunkina
    // debug'inimą.
    enableMinification: false,

    // Ar lygiagrečiai krauti maršrutus (greitesnis startup, daugiau RAM).
    parallelRouteLoading: true,

    // Astro/Node worker procesų skaičius. Padidinti pagal CPU branduolius.
    workerCount: 2,

    // Dev rėžimas — papildomi log'ai, jokios minifikacijos, hot reload.
    dev: false,

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

    // ─────────────────────────────────────────────────────────────────────
    // Typesense — sutarčių ir juridinių asmenų paieška
    // ─────────────────────────────────────────────────────────────────────

    // Jei Typesense nepasiekiamas — false, susijusios paieškos bus išjungtos.
    typesenseUp: true,
    typesenseNodes: [{ host: "localhost", port: 9021, protocol: "http" }],
    typesenseApiKey: "CHANGE_ME",
    typesenseCollection: "viespirkiai",

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

    // ─────────────────────────────────────────────────────────────────────
    // Failai ir OCR
    // ─────────────────────────────────────────────────────────────────────

    // Vidinio failų CDN bazinis URL — naudojamas preview nuorodoms sudaryti.
    internalFileBase: "https://failai.viespirkiai.org",

    // Kiek kartų bandyti OCR vienam failui prieš pažymint kaip nepavykusį.
    ocrBandymai: 5,

    // OCR rezultatų live atnaujinimai puslapyje:
    //   mode: "poll"   — periodiškas tikrinimas; veikia su PgBouncer.
    //   mode: "notify" — PostgreSQL LISTEN/NOTIFY; reikalingas tiesioginis PG.
    ocrLatestResultsLiveUpdates: {
        mode: "poll",
        intervalMs: 250, // naudojama tik mode === "poll" atveju
    },

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

    // Failų metaduomenų sidecar JSON failai.
    failaiMetaduomenysLocation: undefined,

    // Failų išgauto teksto saugykla.
    failaiTekstasLocation: undefined,

    // Dokumentų JSON sidecar failai (raktas: md5).
    dokumentaiLocation: undefined,

    // ─────────────────────────────────────────────────────────────────────
    // Eksperimentinės / prototipinės funkcijos
    // ─────────────────────────────────────────────────────────────────────

    // Ryšių grafiko funkcija visoje UI.
    enableGraph: false,

    // Vektorinė failų paieška.
    enableVectorSearch: false,
    vectorSearchUrl: "",

    // Vektorinė teismo nuosprendžių paieška (atskiras backend'as).
    teismoNuosprendziaiVectorSearchUrl: "",

    // Prototipinis /dokumentai paieškos puslapis.
    enableDokumentaiSearch: false,

    // ─────────────────────────────────────────────────────────────────────
    // MCP execute_query įrankis
    // Read-only SQL prieigai per MCP. Naudoja atskirą "analyst" rolę su
    // savo pool'u — jungiamasi tiesiai į PG (ne per PgBouncer), kad veiktų
    // SET LOCAL statement_timeout.
    // ─────────────────────────────────────────────────────────────────────

    // Rodyti `get_schema` ir `execute_query` MCP įrankius.
    enableExecuteQueryMcp: false,

    // Tik šie du SQL įrankiai be jokių kitų MCP įrankių. Skirta lokaliam
    // testavimui kartu su prod viespirkiai instance.
    enableExecuteQueryMcpOnly: false,

    // SQL užklausų ir rezultatų žurnalas į stderr (debug'inimui).
    enableExecuteQueryMcpTrace: false,

    // Read-only PG rolė SQL užklausoms. Atskira nuo pgUser, kad teisės būtų
    // ribotos. pgAnalystPort turi rodyti tiesiai į PG (ne PgBouncer).
    pgAnalystUser: "analyst",
    pgAnalystPassword: "CHANGE_ME",
    pgAnalystPort: 9118,
    pgAnalystMaxConnections: 16,

    // Vienos SQL užklausos timeout sekundėmis (SET LOCAL statement_timeout).
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
