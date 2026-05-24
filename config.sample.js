export default {
    customHead: ``, // Įterpiama į head
    analitikaUrl: ``, // /analitika redirectina į šį URL (pvz. Plausible)
    onionAddress: undefined, // Tor locator header

    // Typesense paieška sutartims bei juridiniams
    typesenseUp: true, // Išjungti jeigu nenaudojama / nepasiekiema
    typesenseNodes: [{ host: "localhost", port: 9021, protocol: "http" }],
    typesenseApiKey: "CHANGE_ME",
    typesenseCollection: "viespirkiai",

    // HTTP
    port: 9019,
    proxyIp: "127.0.0.1", // Trust reverse proxy

    // App
    enableMinification: false,
    parallelRouteLoading: true,
    workerCount: 2,
    dev: false,
    // Informacinis baneris viršuje (nebūtina)
    // Variantai:
    // 1) String (automatinis judantis tekstas / marquee):
    // infoBanner: "Dalis funkcijų gali laikinai neveikti dėl atnaujinimo.",
    // 2) Objektas:
    // infoBanner: {
    //     type: "text", // "text" arba "html"
    //     content: "Dalis funkcijų gali laikinai neveikti dėl atnaujinimo.",
    //     important: true, // jei true: light mode juodas fonas, dark mode baltas
    // },
    // infoBanner: {
    //     type: "html",
    //     content: "<strong>Svarbu:</strong> dalis funkcijų gali laikinai neveikti.",
    //     important: true,
    // },
    infoBanner: undefined,
    
    // PostgreSQL
    pgHost: "localhost",
    pgUser: "admin",
    pgPassword: "CHANGE_ME",
    pgDatabase: "viespirkiai",
    pgPort: 9118,
    pgMaxConnections: 16,

    // Quickwit
    quickwitUp: true,
    quickwitUrl: "http://localhost:7280",
    
    // Scraping
    torAddress: "socks5h://127.0.0.1:9050",
    torPassword: "CHANGE_ME",

    // Failai
    internalFileBase: "https://failai.viespirkiai.org",
    ocrBandymai: 5,
    ocrLatestResultsLiveUpdates: {
        mode: "poll", // "poll" (tinka su PgBouncer) arba "notify"
        intervalMs: 250, // naudojama tik kai mode === "poll"
    },

    // Features
    enableGraph: false,
    enableVectorSearch: false,
    vectorSearchUrl: "",

    ocrRezultataiLocation: undefined, // Absoliutus kelias (pvz. /data/ocrRezultatai) arba nuotolinis URL (pvz. https://host/api/ocr/rezultataiFiles)
    failaiMetaduomenysLocation: undefined, // Absoliutus kelias (pvz. /data/failaiMetaduomenys) arba nuotolinis URL (pvz. https://host/api/failai/metaduomenysFiles)
    failaiTekstasLocation: undefined, // Absoliutus kelias (pvz. /data/failaiTekstas) arba nuotolinis URL (pvz. https://host/api/failai/tekstasFiles)
    dokumentaiLocation: undefined, // Absoliutus kelias (pvz. /data/dokumentai) arba nuotolinis URL — JSON sidecar failai vienam dokumentui (raktas: md5)
};
