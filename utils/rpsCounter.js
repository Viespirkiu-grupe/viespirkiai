import { performance } from "perf_hooks";

/**
 * Class to track rolling requests per second (RPS)
 */
export default class RPSCounter {
    constructor(windowMs = 3000) {
        this.windowMs = windowMs; // rolling window in milliseconds
        this.requests = [];
    }

    /**
     * Record a request at the current time
     */
    record() {
        const now = performance.now();
        this.requests.push(now);
        this._prune(now);
    }

    /**
     * Get current RPS over the rolling window
     * @returns {number} RPS
     */
    getRPS() {
        const now = performance.now();
        this._prune(now);
        return this.requests.length / (this.windowMs / 1000);
    }

    /**
     * Prune requests older than the rolling window
     * @param {number} now - current time in ms
     * @private
     */
    _prune(now) {
        while (
            this.requests.length &&
            this.requests[0] <= now - this.windowMs
        ) {
            this.requests.shift();
        }
    }

    /**
     * Return a JSON summary (like Timings.json)
     */
    json() {
        return {
            windowMs: this.windowMs,
            count: this.requests.length,
            rps: this.getRPS(),
        };
    }

    /**
     * Return a server-style timing string
     */
    serverTiming(name = "rps") {
        return `${name};rps=${this.getRPS().toFixed(2)}`;
    }
}
