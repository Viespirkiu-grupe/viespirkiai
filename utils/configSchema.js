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

const ocrLiveUpdatesSchema = z.object({
    mode: z.enum(["poll", "notify"]).default("poll"),
    intervalMs: z.number().positive().default(250),
}).passthrough();

const configSchema = z.object({
    customHead: z.string().default(""),
    analitikaUrl: z.string().default(""),
    onionAddress: z.string().optional(),
    infoBanner: infoBannerSchema.optional(),

    port: z.number().int().positive().default(9019),
    proxyIp: z.string().default("127.0.0.1"),
    enableMinification: z.boolean().default(false),
    parallelRouteLoading: z.boolean().default(true),
    workerCount: z.number().int().positive().default(2),
    dev: z.boolean().default(false),

    pgHost: z.string().default("localhost"),
    pgPort: z.number().int().positive().default(5432),
    pgUser: z.string().default("admin"),
    pgPassword: z.string().default(""),
    pgDatabase: z.string().default("viespirkiai"),
    pgMaxConnections: z.number().int().positive().default(16),

    typesenseUp: z.boolean().default(false),
    typesenseNodes: z.array(typesenseNodeSchema).default([]),
    typesenseApiKey: z.string().default(""),
    typesenseCollection: z.string().default("viespirkiai"),

    quickwitUp: z.boolean().default(false),
    quickwitUrl: z.string().optional(),
    quickwitHost: z.string().optional(),

    scrapeProxy: z.string().optional(),
    torAddress: z.string().default("socks5h://127.0.0.1:9050"),
    torPassword: z.string().default(""),

    internalFileBase: z.string().default(""),
    ocrBandymai: z.number().int().positive().default(5),
    ocrLatestResultsLiveUpdates: ocrLiveUpdatesSchema.default({
        mode: "poll",
        intervalMs: 250,
    }),

    ocrRezultataiLocation: z.string().optional(),
    failaiMetaduomenysLocation: z.string().optional(),
    failaiTekstasLocation: z.string().optional(),
    dokumentaiLocation: z.string().optional(),

    enableGraph: z.boolean().default(false),
    enableVectorSearch: z.boolean().default(false),
    vectorSearchUrl: z.string().default(""),
    teismoNuosprendziaiVectorSearchUrl: z.string().default(""),
    enableDokumentaiSearch: z.boolean().default(false),

    enableExecuteQueryMcp: z.boolean().default(false),
    enableExecuteQueryMcpOnly: z.boolean().default(false),
    enableExecuteQueryMcpTrace: z.boolean().default(false),
    pgAnalystUser: z.string().optional(),
    pgAnalystPassword: z.string().optional(),
    pgAnalystPort: z.number().int().positive().optional(),
    pgAnalystMaxConnections: z.number().int().positive().default(16),
    mcpQueryTimeout: z.number().positive().default(20),
}).passthrough();

export function normalizeConfig(rawConfig) {
    const parsed = configSchema.parse(rawConfig ?? {});

    return {
        ...parsed,
        pgAnalystUser: parsed.pgAnalystUser ?? parsed.pgUser,
        pgAnalystPassword: parsed.pgAnalystPassword ?? parsed.pgPassword,
        pgAnalystPort: parsed.pgAnalystPort ?? parsed.pgPort,
    };
}
