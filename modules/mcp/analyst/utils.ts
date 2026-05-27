import config from "../../../utils/config.js";

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
