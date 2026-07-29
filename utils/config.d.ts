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
    /** Nustatomas automatiškai pagal NODE_ENV (ne per config/.env). */
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

    quickwitUp: boolean;
    quickwitUrl?: string;
    quickwitTimeoutMs?: number;

    torAddress: string;
    torPassword: string;

    internalFileBase: string;
    ocrBandymai: number;

    ocrRezultataiLocation?: string;
    dokumentaiLocation?: string;

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
