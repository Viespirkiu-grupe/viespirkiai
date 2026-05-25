import configModule from "../../../utils/config.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const config = configModule as any;

export function traceSQL(message: string): void {
    if (config.enableExecuteQueryMcpTrace) {
        console.error(message);
    }
}

export function traceSQLFailure(message: string): void {
    if (config.enableExecuteQueryMcpTrace) {
        console.error(message);
    }
}
