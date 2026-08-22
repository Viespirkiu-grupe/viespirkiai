/**
 * Paprasta FIFO eilė, tolygiai išdėstanti leidimus laike.
 * Pvz. 12.5 RPS reiškia po vieną užklausą kas 80 ms.
 */
export class FifoRateLimiter {
    #intervalMs;
    #queue = [];
    #timer = null;
    #nextAt = 0;
    #lastBacklogAt = -Infinity;
    #firstGrantedAt = null;
    #totalGranted = 0;

    constructor(rps) {
        if (!Number.isFinite(rps) || rps <= 0) {
            throw new Error("RPS turi būti teigiamas skaičius.");
        }
        this.#intervalMs = 1000 / rps;
    }

    get waitingCount() {
        return this.#queue.length;
    }

    get totalGranted() {
        return this.#totalGranted;
    }

    get averageRps() {
        if (this.#totalGranted < 2) return 0;
        return (this.#totalGranted - 1) * 1000
            / Math.max(1, performance.now() - this.#firstGrantedAt);
    }

    acquire() {
        return new Promise((resolve) => {
            this.#queue.push(resolve);
            if (this.#queue.length > 1 || performance.now() < this.#nextAt) {
                this.#lastBacklogAt = performance.now();
            }
            this.#drain();
        });
    }

    wasBackloggedWithin(milliseconds) {
        return performance.now() - this.#lastBacklogAt < milliseconds;
    }

    #drain() {
        if (this.#timer || !this.#queue.length) return;

        const now = performance.now();
        const delay = Math.max(0, this.#nextAt - now);
        if (delay > 0) {
            this.#timer = setTimeout(() => {
                this.#timer = null;
                this.#drain();
            }, delay);
            return;
        }

        const resolve = this.#queue.shift();
        this.#nextAt = Math.max(now, this.#nextAt) + this.#intervalMs;
        this.#firstGrantedAt ??= now;
        this.#totalGranted++;
        resolve();
        if (this.#queue.length) this.#drain();
    }
}
