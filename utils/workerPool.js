// Paprasčiausias „N darbininkų traukia iš bendros eilės" pool'as. Toks pat ciklas
// (`let next = 0; while (i < items.length)`) buvo perrašinėjamas kiekviename batch'inį
// darbą darančiame scripte — čia viena vieta.

/**
 * Paleidžia `task(item, index)` ne daugiau `concurrency` vienu metu.
 * Rezultatus grąžina originalia `items` tvarka (ne užbaigimo).
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} task
 * @param {number} concurrency
 * @returns {Promise<R[]>}
 */
export async function runPool(items, task, concurrency) {
    const results = new Array(items.length);
    let next = 0;

    async function worker() {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await task(items[i], i);
        }
    }

    const workers = Math.max(1, Math.min(concurrency, items.length));
    await Promise.all(Array.from({ length: workers }, worker));
    return results;
}

/**
 * Kaip `runPool`, tik darbininkai patys traukia kitą porciją iš `nextItem()` –
 * be barjero tarp „batch'ų", tad lėtas backend'as stabdo tik savo darbininką.
 * `nextItem()` turi būti sinchroniška (be await) → atomiška vienoje JS gijoje.
 * @template T
 * @param {() => T|null} nextItem - grąžina `null` kai daugiau nebėra
 * @param {(item: T) => Promise<void>} task
 * @param {number} concurrency
 */
export async function runStream(nextItem, task, concurrency) {
    async function worker() {
        for (;;) {
            const item = nextItem();
            if (item == null) return;
            await task(item);
        }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
}

/**
 * libuv threadpool'o dydis pagal norimą concurrency. fs skaitymai, zstd ir native
 * tokenizeris sukasi tame pačiame pool'e, kurio default = 4 → be šito tik 4
 * branduoliai nepaisant concurrency. Turi būti iškviesta PRIEŠ pirmą pool'o naudojimą.
 * @param {number} concurrency
 */
export function setUvThreadpoolSize(concurrency) {
    process.env.UV_THREADPOOL_SIZE = String(Math.max(4, Math.min(128, Math.round(concurrency))));
}
