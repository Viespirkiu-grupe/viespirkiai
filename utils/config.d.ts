export interface TypesenseNodeConfig {
    host: string;
    port: number;
    protocol: string;
    [key: string]: unknown;
}

export interface Config {
    customHead: string;
    analitikaUrl: string;
    onionAddress?: string;

    port: number;
    /** Į stderr rašyti struktūrizuotą kiekvienos HTTP užklausos žurnalą. */
    logRequests: boolean;
    /** Rodyti CVPP / ATN-1 archyvo puslapius ir navigacijos nuorodą. */
    enableAtn1: boolean;
    /** Saugoti brangius paieškos maršrutus paprastu JavaScript slapuko patikrinimu. */
    enableBotChallenge: boolean;
    /** Nustatomas automatiškai pagal NODE_ENV (ne per config/.env). */
    dev: boolean;

    pgHost: string;
    pgPort: number;
    pgUser: string;
    pgPassword: string;
    pgDatabase: string;
    pgMaxConnections: number;
    /** Kai nurodytas – visos SQL užklausos su trukme append'inamos į šį failą. */
    sqlLogFile?: string;
    /** Tie patys SQL logo įrašai rašomi tiesiai į Quickwit indeksą `sqlLog`. */
    sqlLogQuickwit: boolean;
    /** Ar naudoti prepared statement'us (išjungti prie pgbouncer transaction pooling). */
    pgPrepared: boolean;

    typesenseUp: boolean;
    typesenseNodes: TypesenseNodeConfig[];
    typesenseApiKey: string;

    quickwitUp: boolean;
    quickwitUrl?: string;
    quickwitTimeoutMs?: number;

    torAddress: string;
    torPassword: string;

    internalFileBase: string;
    ocrBandymai: number;

    ocrRezultataiLocation?: string;
    dokumentaiLocation?: string;
    failaiLocation?: string;
    failaiInfoSqliteLocation?: string;
    dokumentaiSqliteLocation?: string;
    ocrRezultataiSqliteLocation?: string;

    /** Stateless e-TAR HTML→JSON adapterio bazinis URL (`modules/eTar`). */
    eTarApiUrl: string;
    eTarApiKey: string;
    /** SQLite sidecar katalogas e-TAR API atsakymams. */
    eTarSidecarDir: string;

    enableGraph: boolean;

    enableExecuteQueryMcp: boolean;
    enableExecuteQueryMcpOnly: boolean;
    enableExecuteQueryMcpTrace: boolean;
    pgAnalystUser: string;
    pgAnalystPassword: string;
    pgAnalystPort: number;
    pgAnalystMaxConnections: number;
    mcpQueryTimeout: number;

    [key: string]: unknown;
}

declare const config: Config;
export default config;
