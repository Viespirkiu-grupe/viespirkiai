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
    
    // PostgreSQL
    pgHost: "localhost",
    pgUser: "admin",
    pgPassword: "CHANGE_ME",
    pgDatabase: "viespirkiai",
    pgPort: 9118,
    pgMaxConnections: 16,

    // Quickwit
    quickwitUrl: "http://localhost:7280",
    
    // Scraping
    torAddress: "socks5h://127.0.0.1:9050",
    torPassword: "CHANGE_ME",

    // Failai
    internalFileBase: "https://failai.viespirkiai.org",
    ocrBandymai: 5,
};
