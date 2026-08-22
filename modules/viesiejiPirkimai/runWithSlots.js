/**
 * Iteruoja async iterable su pastoviu kiekiu aktyvių darbų ir backpressure.
 * Sąrašas nekaupiamas atmintyje; užsipildžius slotams laukiama pirmo pabaigto.
 * Sąmoningai nenaudoja Promise.all.
 *
 * @template T
 * @param {AsyncIterable<T>} iterable
 * @param {(item: T) => Promise<void>} task
 * @param {number} concurrency
 */
export async function runWithSlots(iterable, task, concurrency) {
    const slotuSkaicius = Math.max(1, Math.floor(concurrency));
    const active = new Set();

    for await (const item of iterable) {
        while (active.size >= slotuSkaicius) {
            await Promise.race(active);
        }

        const job = Promise.resolve()
            .then(() => task(item))
            .finally(() => active.delete(job));
        active.add(job);
    }

    while (active.size) await Promise.race(active);
}

/**
 * Kaip runWithSlots, tik slotų kiekį pamažu augina, o išoriniam ribotuvui
 * aptikus eilę — mažina. Jau pradėtų darbų nestabdo.
 */
export async function runAdaptiveSlots(iterable, task, {
    initialConcurrency = 4,
    maxConcurrency = 256,
    growEveryMs = 250,
    canGrow = () => true,
    onConcurrencyChange = () => {},
} = {}) {
    const minimum = Math.max(1, Math.floor(initialConcurrency));
    let target = minimum;
    const maximum = Math.max(target, Math.floor(maxConcurrency));
    const active = new Set();
    let wakeScheduler = () => {};
    let lastShrinkAt = -Infinity;

    const growthTimer = setInterval(() => {
        if (!canGrow()) {
            const now = performance.now();
            if (now - lastShrinkAt < 1000) return;
            const reduced = Math.max(minimum, Math.floor(target * 0.9));
            if (reduced === target) return;
            target = reduced;
            lastShrinkAt = now;
            onConcurrencyChange(target);
            return;
        }
        if (target >= maximum || active.size < target) return;
        target = Math.min(maximum, target + Math.max(1, Math.ceil(target * 0.25)));
        onConcurrencyChange(target);
        wakeScheduler();
    }, growEveryMs);
    growthTimer.unref?.();

    const waitForCapacity = async () => {
        while (active.size >= target) {
            let wake;
            const growth = new Promise((resolve) => { wake = resolve; });
            wakeScheduler = wake;
            await Promise.race([Promise.race(active), growth]);
            wakeScheduler = () => {};
        }
    };

    try {
        for await (const item of iterable) {
            await waitForCapacity();
            const job = Promise.resolve()
                .then(() => task(item))
                .finally(() => active.delete(job));
            active.add(job);
        }
        while (active.size) await Promise.race(active);
    } finally {
        clearInterval(growthTimer);
    }
}
