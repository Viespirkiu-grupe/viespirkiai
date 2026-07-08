export interface InfoBannerObject {
    type?: "text" | "html";
    content: string;
    important?: boolean;
}

export type InfoBannerConfig = string | InfoBannerObject;

export interface TypesenseNodeConfig {
    host: string;
    port: number;
    protocol: string;
    [key: string]: unknown;
}

export interface OcrLatestResultsLiveUpdatesConfig {
    mode: "poll" | "notify";
    intervalMs: number;
    [key: string]: unknown;
}

export interface Config {
    customHead: string;
    analitikaUrl: string;
    onionAddress?: string;
    infoBanner?: InfoBannerConfig;

    port: number;
    proxyIp: string;
    enableMinification: boolean;
    parallelRouteLoading: boolean;
    workerCount: number;
    dev: boolean;

    pgHost: string;
    pgPort: number;
    pgUser: string;
    pgPassword: string;
    pgDatabase: string;
    pgMaxConnections: number;

    typesenseUp: boolean;
    typesenseNodes: TypesenseNodeConfig[];
    typesenseApiKey: string;
    typesenseCollection: string;

    quickwitUp: boolean;
    quickwitUrl?: string;
    quickwitHost?: string;
    quickwitTimeoutMs?: number;

    scrapeProxy?: string;
    torAddress: string;
    torPassword: string;

    internalFileBase: string;
    ocrBandymai: number;
    ocrLatestResultsLiveUpdates: OcrLatestResultsLiveUpdatesConfig;

    ocrRezultataiLocation?: string;
    failaiMetaduomenysLocation?: string;
    failaiTekstasLocation?: string;
    dokumentaiLocation?: string;

    enableGraph: boolean;
    enableVectorSearch: boolean;
    vectorSearchUrl: string;
    teismoNuosprendziaiVectorSearchUrl: string;
    enableDokumentaiSearch: boolean;

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
