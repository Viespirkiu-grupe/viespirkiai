import { describe, expect, it, vi } from "vitest";

vi.mock("../utils/log.js", () => ({ log: () => {} }));

import { runPipeline } from "../modules/eSeimas/eSeimasScrape.js";

/**
 * Netikras DB šaltinis, elgiantis kaip `pickActsToScrape`: rikiuota eilė,
 * `LIMIT take` ir `exclude` filtras PAČIOJE užklausoje. Atlikti elementai iš
 * eilės dingsta, kaip dingtų uždėjus DB žymą.
 */
function makeSource(items: string[], { limitWindow = 10, delayMs = 0 } = {}) {
    const pending = new Set(items);
    return {
        pending,
        pick: async (take: number, exclude: string[]) => {
            // Momentinė nuotrauka PAĖMIMO metu, kaip ir tikroje užklausoje: kol
            // ji keliauja, dirbami elementai dar be DB žymos, tad į ją patenka.
            const skip = new Set(exclude);
            const snapshot = [...pending].filter(item => !skip.has(item)).slice(0, Math.min(take, limitWindow));
            await new Promise(resolve => setTimeout(resolve, delayMs));
            return snapshot;
        },
        finish: (item: string) => pending.delete(item),
    };
}

describe("runPipeline", () => {
    it("nesustoja anksčiau laiko, kol eilėje dar yra darbo", async () => {
        const source = makeSource(Array.from({ length: 500 }, (_, i) => `item-${i}`));
        const done: string[] = [];

        const result = await runPipeline({
            documents: {
                label: "dokumentai",
                batchSize: 10,
                key: (item: string) => item,
                pick: source.pick,
                work: async (item: string) => {
                    // Skirtingos trukmės darbai – kad buferis vis ištuštėtų.
                    await new Promise(resolve => setTimeout(resolve, done.length % 3));
                    source.finish(item);
                    done.push(item);
                },
                onError: () => {},
            },
        }, { concurrency: 8 });

        // Pakartojimų būti gali (užklausa, paimta elementui tebesant ore, jį
        // grąžina) — svarbu, kad nė vienas nebūtų praleistas.
        expect(new Set(done).size).toBe(500);
        expect(source.pending.size).toBe(0);
        expect(result.documents.failed).toBe(0);
    });

    it("neužbaigia darbo dėl porcijos, paimtos elementams tebeesant ore", async () => {
        // `pick` grąžina ir tuos elementus, kurie kaip tik dirbami (DB žymos jie
        // dar neturi) — planuoklis juos atmeta kaip `inFlight`, tad porcija
        // ateina tuščia. Tokia tuštuma NĖRA darbo pabaiga.
        // Lėta užklausa + greitas darbas: kol porcija keliauja, visi darbininkai
        // spėja pabaigti, tad ji grįžta tuščia (viskas atmesta kaip `inFlight`)
        // į baseiną, kuriame `busy === 0`.
        const source = makeSource(Array.from({ length: 40 }, (_, i) => `item-${i}`), { limitWindow: 40, delayMs: 20 });
        const result = await runPipeline({
            documents: {
                label: "dokumentai",
                batchSize: 5,
                key: (item: string) => item,
                pick: source.pick,
                work: async (item: string) => {
                    await Promise.resolve();
                    source.finish(item);
                },
                onError: () => {},
            },
        }, { concurrency: 4 });

        expect(source.pending.size).toBe(0);
        expect(result.documents.done).toBeGreaterThanOrEqual(40);
        expect(result.documents.failed).toBe(0);
    });

    it("nuolat lūžtantys elementai neužkemša pick lango", async () => {
        // Nulūžusių daugiau, nei telpa į vieną `LIMIT` langą: be `exclude` jie
        // amžinai stovėtų priekyje ir porcija ateitų tuščia.
        const items = Array.from({ length: 60 }, (_, i) => `item-${i}`);
        const source = makeSource(items, { limitWindow: 10 });
        const nulūžę = new Set(items.slice(0, 20));

        const result = await runPipeline({
            documents: {
                label: "dokumentai",
                batchSize: 10,
                key: (item: string) => item,
                pick: source.pick,
                work: async (item: string) => {
                    await Promise.resolve();
                    // Klaida DB žymos nepalieka – kaip diena be klaidų skaitiklio.
                    if (nulūžę.has(item)) throw new Error("nepavyko");
                    source.finish(item);
                },
                onError: () => {},
            },
        }, { concurrency: 4 });

        expect(source.pending.size).toBe(20);       // liko tik nuolat lūžtantys
        expect(result.documents.done).toBeGreaterThanOrEqual(40);
        expect(result.documents.failed).toBe(20);
    });

    it("daugiau nei 1000 klaidų neužkemša pick lango", async () => {
        // Ankstesnis 1000 elementų `exclude` limitas leisdavo 1001-am lūžusiam
        // elementui vėl atsistoti SQL lango priekyje. Jį atmetus atmintyje
        // porcija atrodydavo tuščia ir pipeline'as paskelbdavo klaidingą pabaigą.
        const items = Array.from({ length: 1125 }, (_, i) => `item-${i}`);
        const source = makeSource(items, { limitWindow: 50 });
        const nulūžę = new Set(items.slice(0, 1105));

        const result = await runPipeline({
            documents: {
                label: "dokumentai",
                batchSize: 50,
                key: (item: string) => item,
                pick: source.pick,
                work: async (item: string) => {
                    if (nulūžę.has(item)) throw new Error("nepavyko");
                    source.finish(item);
                },
                onError: () => {},
            },
        }, { concurrency: 8 });

        expect([...source.pending].filter(item => !nulūžę.has(item))).toEqual([]);
        expect(result.documents.done).toBeGreaterThanOrEqual(20);
        expect(result.documents.failed).toBe(1105);
    });

    it("laikina pick klaida darbo nenutraukia", async () => {
        const source = makeSource(Array.from({ length: 30 }, (_, i) => `item-${i}`));
        let calls = 0;

        const result = await runPipeline({
            documents: {
                label: "dokumentai",
                batchSize: 5,
                key: (item: string) => item,
                pick: async (take: number, exclude: string[]) => {
                    if (++calls === 3) throw new Error("DB nutrūko");
                    return source.pick(take, exclude);
                },
                work: async (item: string) => {
                    await Promise.resolve();
                    source.finish(item);
                },
                onError: () => {},
            },
        }, { concurrency: 4 });

        expect(source.pending.size).toBe(0);
        expect(result.documents.done).toBeGreaterThanOrEqual(30);
        expect(result.documents.failed).toBe(0);
    });
});
