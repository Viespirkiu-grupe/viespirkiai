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
    /** Info banerio tekstas iš `.env`; netuščias nustelbia DB lentelę. */
    infoBanner: string;
    /** Ar `.env` baneris rodomas kaip svarbus (paryškintas). */
    infoBannerImportant: boolean;

    port: number;
    /** Į stderr rašyti struktūrizuotą kiekvienos HTTP užklausos žurnalą. */
    logRequests: boolean;
    /** TaskRunner darbų vardai, kurių neregistruoti; leidžiami `*` pakaitos simboliai. */
    taskRunnerDisabledTasks: string[];
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

    /** KOTIS portalo arba jo mirror/proxy bazinis URL. */
    kotisUrl: string;

    internalFileBase: string;
    ocrBandymai: number;

    /**
     * Katalogas, kuriame guli visos sidecar SQLite bazės — po vieną failą
     * kiekvienam registro įrašui: `<sidecarDir>/<vardas>.sqlite`.
     * Žr. `utils/sidecarPaths.js`. Be jo mazgas gali tik skaityti per
     * `sidecarRemote`.
     */
    sidecarDir?: string;
    /**
     * Mazgo, turinčio lokalias bazes, bazinis URL. Klientas pats prilipdo
     * `/api/v1/sidecar/<vardas>`. Naudojamas tik skaitymui.
     */
    sidecarRemote?: string;
    /** Sidecar'ų skaitymo gijų skaičius; `1` – be gijų. Numatyta – 4. */
    sidecarReadThreads: number;

    /** Stateless e-TAR HTML→JSON adapterio bazinis URL (`modules/eTar`). */
    eTarApiUrl: string;
    eTarApiKey: string;
    /** Kiek naujausių kalendorinių dienų periodiškai tikrina TaskRunner. */
    eTarRecentDays: number;
    /** Po kiek valandų radaro diena vėl laikoma tikrintina. */
    eTarRefreshHours: number;
    /** Bendras visų e-TAR etapų vienu metu laikomų API užklausų limitas. */
    eTarMaxInflight: number;

    /** RC dok.php užklausų per sekundę riba (bendra visiems lygiagretiems workeriams). */
    rcJarDokumentaiRps: number;
    /** Kiek dok.php užklausų vykdoma vienu metu. */
    rcJarDokumentaiConcurrency: number;
    /** Kiek JAR kodų paimama į vieną porciją. */
    rcJarDokumentaiBatch: number;
    /** Po kiek dienų tas pats JAR kodas skaitomas iš naujo. */
    rcJarDokumentaiIntervalDays: number;

    enableGraph: boolean;

    enableExecuteQueryMcp: boolean;
    enableExecuteQueryMcpOnly: boolean;
    enableExecuteQueryMcpTrace: boolean;
    pgAnalystUser: string;
    pgAnalystPassword: string;
    pgAnalystPort: number;
    pgAnalystMaxConnections: number;
    mcpQueryTimeout: number;

    /** Rodyti rizikos indikatorių čipsus viešųjų pirkimų puslapiuose. */
    riskEnableIndicatorsChips: boolean;

    [key: string]: unknown;
}

declare const config: Config;
export default config;
