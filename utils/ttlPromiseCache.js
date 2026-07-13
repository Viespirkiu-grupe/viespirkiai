/**
 * Creates a small in-process TTL cache that also coalesces concurrent loads.
 * Rejected loads are evicted immediately and are never cached.
 *
 * @param {number} ttlMs
 * @returns {(key: string, load: () => Promise<any>) => Promise<any>}
 */
export function createTtlPromiseCache(ttlMs) {
    const cache = new Map();

    return (key, load) => {
        const now = Date.now();
        const cached = cache.get(key);
        if (cached && (cached.pending || cached.expiresAt > now)) {
            return cached.promise;
        }

        if (cached) cache.delete(key);

        const entry = {
            pending: true,
            expiresAt: Infinity,
            promise: null,
        };
        entry.promise = Promise.resolve()
            .then(load)
            .then(
                (value) => {
                    entry.pending = false;
                    entry.expiresAt = Date.now() + ttlMs;
                    return value;
                },
                (error) => {
                    if (cache.get(key) === entry) cache.delete(key);
                    throw error;
                },
            );
        cache.set(key, entry);
        return entry.promise;
    };
}
