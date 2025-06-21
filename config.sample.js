export default {
    scrape: true,
    scrapeInterval: 60,
    scrapeProxy: null, // "http://127.0.0.1:9024"
    exportFile: "export.jsonl",
    mongoDb: "mongodb://root:password@localhost:9020",
    mongoDBName: "viespirkiai",
    mongoDbCollection: "viespirkiai",
    customHead: ``,
    analitikaUrl: "https://plausible.viespirkiai.top/viespirkiai.top",
    typesenseNodes: [
        { host: "localhost", port: 9021, protocol: "http" }
    ],
    typesenseApiKey: "password",
    typesenseCollection: "viespirkiai",
    mysqlHost: "localhost",
    mysqlUser: "viespirkiai",
    mysqlPassword: "viespirkiai",
    mysqlDatabase: "viespirkiai",
    mysqlPort: 9022,
    port: 9019,
}