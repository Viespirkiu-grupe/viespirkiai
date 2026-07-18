import { z } from "zod";

const infoBannerSchema = z.union([
    z.string(),
    z.object({
        type: z.enum(["text", "html"]).optional(),
        content: z.string(),
        important: z.boolean().optional(),
    }).passthrough(),
]);

const typesenseNodeSchema = z.object({
    host: z.string(),
    port: z.number(),
    protocol: z.string(),
}).passthrough();

const configSchema = z.object({
    customHead: z.string().default(""),
    analitikaUrl: z.string().default(""),
    onionAddress: z.string().optional(),
    infoBanner: infoBannerSchema.optional(),

    port: z.number().int().positive().default(9019),

    pgHost: z.string().default("localhost"),
    pgPort: z.number().int().positive().default(5432),
    pgUser: z.string().default("admin"),
    pgPassword: z.string().default(""),
    pgDatabase: z.string().default("viespirkiai"),
    pgMaxConnections: z.number().int().positive().default(16),

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
    viesiejiPirkimaiUrl: z.string().default("https://viesiejipirkimai.lt"),

    internalFileBase: z.string().default(""),
    ocrBandymai: z.number().int().positive().default(5),

    ocrRezultataiLocation: z.string().optional(),
    failaiMetaduomenysLocation: z.string().optional(),
    failaiTekstasLocation: z.string().optional(),
    dokumentaiLocation: z.string().optional(),

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
