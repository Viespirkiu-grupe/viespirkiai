export interface TypesenseNodeConfig {
    host: string;
    port: number;
    /** Aiški logų aplinkos žyma; turi pirmenybę prieš NODE_ENV. */
    appEnv?: 'dev' | 'prod';
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
    /** Postgres host aplenkiant pgbouncer'į (advisory lock'ams). Numatyta – pgHost. */
    pgDirectHost?: string;
    /** Postgres portas aplenkiant pgbouncer'į (advisory lock'ams). Numatyta – pgPort. */
    pgDirectPort?: number;
    /** Kai nurodytas – visos SQL užklausos su trukme append'inamos į šį failą. */
    sqlLogFile?: string;
    /** Tie patys SQL logo įrašai rašomi tiesiai į Quickwit indeksą `sqlLog`. */
    sqlLogQuickwit: boolean;
    /** Kai nurodytas – outbound scraping užklausos append'inamos JSONL formatu. */
    scrapeLogFile?: string;
    /** Outbound scraping užklausų metaduomenys rašomi į dieninius Quickwit indeksus. */
    scrapeLogQuickwit: boolean;
    /** Ar naudoti prepared statement'us (išjungti prie pgbouncer transaction pooling). */
    pgPrepared: boolean;

    /** NATS signalų magistralė; tuščia eilutė ją išjungia. */
    natsUrl: string;
    /** NATS autentikacijos token'as (`authorization.token` serveryje). */
    natsToken: string;

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
    /** LITEKO2 sprendimų sidecar (API JSON + HTML + tekstas), raktas: md5. */
    liteko2Location?: string;
    liteko2SqliteLocation?: string;

    /** Stateless e-TAR HTML→JSON adapterio bazinis URL (`modules/eTar`). */
    eTarApiUrl: string;
    eTarApiKey: string;
    /** SQLite sidecar katalogas e-TAR API atsakymams. */
    eTarSidecarDir: string;
    /** Kiek naujausių kalendorinių dienų periodiškai tikrina TaskRunner. */
    eTarRecentDays: number;
    /** Po kiek valandų radaro diena vėl laikoma tikrintina. */
    eTarRefreshHours: number;
    /** Bendras visų e-TAR etapų vienu metu laikomų API užklausų limitas. */
    eTarMaxInflight: number;

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
