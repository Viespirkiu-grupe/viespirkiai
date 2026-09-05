import { z } from "zod";

const typesenseNodeSchema = z.object({
    host: z.string(),
    port: z.number(),
    protocol: z.string(),
}).passthrough();

const configSchema = z.object({
    customHead: z.string().default(""),
    analitikaUrl: z.string().default(""),
    onionAddress: z.string().optional(),
    // Info baneris paprastai imamas iš DB (`viespirkiai."infoBaneris"`), bet
    // kai DB redaguoti neįmanoma, `.env` reikšmė turi pirmenybę.
    infoBanner: z.string().default(""),
    infoBannerImportant: z.boolean().default(false),

    port: z.number().int().positive().default(9019),
    appEnv: z.enum(["dev", "prod"]).optional(),
    logRequests: z.boolean().default(false),
    // TaskRunner darbų išjungimas be kodo keitimo: vardų sąrašas, kuriame
    // leidžiami `*` pakaitos simboliai, pvz. `eSeimas*,tedScrape`.
    taskRunnerDisabledTasks: z.array(z.string()).default([]),
    enableAtn1: z.boolean().default(false),
    enableBotChallenge: z.boolean().default(false),

    pgHost: z.string().default("localhost"),
    pgPort: z.number().int().positive().default(5432),
    pgUser: z.string().default("admin"),
    pgPassword: z.string().default(""),
    pgDatabase: z.string().default("viespirkiai"),
    pgMaxConnections: z.number().int().positive().default(16),
    // Tiesioginė jungtis į Postgres, aplenkiant pgbouncer'į – reikalinga tik
    // seanso lygio advisory lock'ams (žr. postgres/sessionLock.js). Nenurodžius
    // krenta į PG_HOST/PG_PORT.
    pgDirectHost: z.string().optional(),
    pgDirectPort: z.number().int().positive().optional(),
    sqlLogFile: z.string().optional(),
    sqlLogQuickwit: z.boolean().default(false),
    scrapeLogFile: z.string().optional(),
    scrapeLogQuickwit: z.boolean().default(false),
    pgPrepared: z.boolean().default(true),

    // Signalų magistralė (SSE, cache invalidacija). Tuščias URL ją išjungia –
    // kanalai tada tyliai neveikia, o gavėjai krenta į savo fallback'us.
    natsUrl: z.string().default("nats://127.0.0.1:4222"),
    natsToken: z.string().default(""),

    typesenseUp: z.boolean().default(false),
    typesenseNodes: z.array(typesenseNodeSchema).default([]),
    typesenseApiKey: z.string().default(""),

    quickwitUp: z.boolean().default(false),
    quickwitUrl: z.string().optional(),

    torAddress: z.string().default("socks5h://127.0.0.1:9050"),
    torPassword: z.string().default(""),

    // Baziniai išorinių šaltinių URL — leidžia perrašyti į mirror/proxy.
    // Be trailing slash.
    dataGovUrl: z.string().default("https://get.data.gov.lt"),
    kotisUrl: z.string().default("https://kotis.kt.gov.lt"),
    viesiejiPirkimaiUrl: z.string().default("https://viesiejipirkimai.lt"),
    esInvesticijos2021Url: z
        .string()
        .default("https://2021.esinvesticijos.lt"),

    // e-TAR: ne pats e-tar.lt, o stateless HTML→JSON adapteris prieš jį
    // (modules/eTar). Raktas reikalingas tik jei adapteryje nustatytas API_KEY.
    eTarApiUrl: z.string().default(""),
    eTarApiKey: z.string().default(""),
    eTarRecentDays: z.number().int().positive().default(180),
    eTarRefreshHours: z.number().positive().default(3),
    eTarMaxInflight: z.number().int().positive().default(6),
    // e-Seimas naudoja tą patį adapterio URL/raktą, bet turi atskirą darbo tempą.
    eSeimasRecentDays: z.number().int().positive().default(180),
    eSeimasRefreshHours: z.number().positive().default(3),
    eSeimasMaxInflight: z.number().int().positive().default(6),

    internalFileBase: z.string().default("https://failai.viespirkiai.org"),
    ocrBandymai: z.number().int().positive().default(5),

    // Sidecar SQLite bazės: vienas katalogas visoms (`<vardas>.sqlite`), o
    // mazgai be lokalių failų skaito per vieną nuotolinį bazinį URL.
    sidecarDir: z.string().optional(),
    sidecarRemote: z.string().optional(),
    // Kiek gijų aptarnauja sidecar'ų skaitymus. `1` — jokių gijų, skaitoma
    // pagrindinėje gijoje (žr. utils/sqliteSidecarPoolas.js).
    sidecarReadThreads: z.number().int().min(1).default(4),

    enableGraph: z.boolean().default(false),

    enableExecuteQueryMcp: z.boolean().default(false),
    enableExecuteQueryMcpOnly: z.boolean().default(false),
    enableExecuteQueryMcpTrace: z.boolean().default(false),
    // Analitiko (read-only) DB prisijungimas MCP execute_query'iui. NĖRA
    // fallback'o į pg* – analitikas privalo būti atskiras read-only vartotojas.
    pgAnalystUser: z.string().optional(),
    pgAnalystPassword: z.string().optional(),
    pgAnalystPort: z.number().int().positive().optional(),
    pgAnalystMaxConnections: z.number().int().positive().default(16),
    mcpQueryTimeout: z.number().positive().default(20),

    // Procurement Risk Service — the `risk` schema lives in the main database
    // and is reached through the main `postgres` pool, so it needs no
    // connection settings of its own.
    // Rodyti rizikos indikatorių "čipsus" (chips) viešųjų pirkimų puslapiuose.
    riskEnableIndicatorsChips: z.boolean().default(false),

    spintaServer: z.string().default(""),
    spintaApiKey: z.string().default(""),
    spintaClient: z.string().default(""),
    spintaSecret: z.string().default(""),
    spintaNamespace: z.string().default(""),
    spintaScopes: z.array(z.string()).default([]),
}).passthrough();

export function normalizeConfig(rawConfig) {
    const parsed = configSchema.parse(rawConfig ?? {});

    return {
        ...parsed,
        // `dev` nustatomas automatiškai pagal aplinką (ne per config/.env).
        dev: process.env.NODE_ENV !== "production",
    };
}
