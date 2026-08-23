// Integration test for the Procurement Reader (modules/risk/procurementReader.ts):
// proves ProcurementReader against the real v_pirkimas_v2/v_pirkimo_dalis_v2/
// v_dalyviai_v2 views, in the local risk-dev Postgres's test-only `public`
// schema. See docs/indicators-story/risk-service-architecture-v2.md §1.2.
//
// Named `.it.ts` to match this repo's integration-test convention
// (vitest.integration.config.ts); run via `npm run test:integration`, which
// requires the local Docker Postgres from docker/risk/compose.yml to be up.
//
// Also covers the two consolidated participation queries (formerly each
// deployed indicator's own collect.sql) and orphan-lot dropping, both moved
// here since they are now the Reader's own concern, shared by every
// procurement/lot indicator rather than tested once per indicator.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/log.js", () => ({ log: vi.fn() }));

import { riskDb } from "../../postgres/riskDb.js";
import { log } from "../../utils/log.js";
import { ensurePublicTestSchema, truncateTestPublicTables } from "./testPublicDb.ts";
import {
    insertAtaskaita,
    insertAtmestasPasiulymas,
    insertDalyvis,
    insertPasiulymas,
    WITHDRAWN_STATUS,
} from "../../modules/risk/indicators/test/xlsxPPAFixtures.ts";
import { PostgresRiskDataSource } from "../../modules/risk/riskDataSource.ts";
import { ProcurementReader } from "../../modules/risk/procurementReader.ts";
import type { Procurement } from "../../modules/risk/types.ts";

const facts = new PostgresRiskDataSource(riskDb);
const DATA_AS_OF = "2026-08-12T00:00:00.000Z";

async function insertViesiejiPirkimai(pirkimoId: number, pirkimoBudas = "Atviras konkursas"): Promise<void> {
    await riskDb.query(
        `INSERT INTO public."viesiejiPirkimai" ("pirkimoId", "pavadinimas", "pirkimoBudas") VALUES ($1, $2, $3)`,
        [pirkimoId, `Fixture ${pirkimoId}`, pirkimoBudas],
    );
}

async function insertDeclaredLot(pirkimoId: number, numeris: number, pavadinimas: string): Promise<void> {
    await riskDb.query(
        `INSERT INTO public."viesiejiPirkimaiDalys" ("pirkimoId", rusis, numeris, pavadinimas)
         VALUES ($1, 'dalis', $2, $3)`,
        [pirkimoId, numeris, pavadinimas],
    );
}

function reader(subjects: readonly string[] | null = null, dataAsOf = DATA_AS_OF): ProcurementReader {
    return new ProcurementReader(facts, subjects, dataAsOf);
}

async function loadAll(r: ProcurementReader, pageSize = 50): Promise<Procurement[]> {
    const items: Procurement[] = [];
    let cursor: string | null = null;
    do {
        const page = await r.loadProcurements(cursor, pageSize);
        items.push(...page.items);
        cursor = page.nextCursor;
    } while (cursor !== null);
    return items;
}

beforeAll(async () => {
    await ensurePublicTestSchema();
});

beforeEach(async () => {
    await truncateTestPublicTables();
    vi.mocked(log).mockClear();
});

afterAll(async () => {
    await riskDb.end();
});

describe("ProcurementReader.loadProcurements", () => {
    it("groups declared lots under their parent Procurement.lots, keyed by pirkimoNumeris", async () => {
        await insertViesiejiPirkimai(910001);
        await insertDeclaredLot(910001, 1, "Dalis 1");
        await insertDeclaredLot(910001, 2, "Dalis 2");

        const procurements = await loadAll(reader());
        const procurement = procurements.find((p) => p.pirkimoNumeris === "910001");

        expect(procurement).toBeDefined();
        expect(procurement!.lots.map((l) => l.daliesNumeris).sort()).toEqual(["1", "2"]);
        const first = procurement!.lots.find((l) => l.daliesNumeris === "1");
        expect(first).toMatchObject({
            pirkimoNumeris: "910001",
            daliesPavadinimas: "Dalis 1",
            deklaruota: true,
            stebeta: false,
            participation: null,
        });
        expect(first!.subjektoRaktas).toBe("cvpis:910001:1");
    });

    it("honors the subjects filter, and returns everything when it is null", async () => {
        await insertViesiejiPirkimai(910003);
        await insertViesiejiPirkimai(910004);

        const filtered = await loadAll(reader(["910003"]));
        expect(filtered.map((p) => p.pirkimoNumeris)).toEqual(["910003"]);

        const all = await loadAll(reader(null));
        expect(all.map((p) => p.pirkimoNumeris).sort()).toEqual(["910003", "910004"]);
    });
});

describe("ProcurementReader pagination", () => {
    it("splits a run into pages of at most pageSize, covering every procurement exactly once", async () => {
        const ids = [920001, 920002, 920003, 920004, 920005];
        for (const id of ids) await insertViesiejiPirkimai(id);

        const r = reader();
        const seen: string[] = [];
        let cursor: string | null = null;
        let pageCount = 0;
        do {
            const page = await r.loadProcurements(cursor, 2);
            expect(page.items.length).toBeLessThanOrEqual(2);
            seen.push(...page.items.map((p) => p.pirkimoNumeris));
            cursor = page.nextCursor;
            pageCount++;
            expect(pageCount).toBeLessThan(10); // guards against an infinite loop on a cursor bug
        } while (cursor !== null);

        expect(seen.sort()).toEqual(ids.map(String).sort());
        expect(new Set(seen).size).toBe(ids.length); // no duplicates across pages
    });

    it("keeps cursor semantics independent of reader instance state", async () => {
        const ids = [920101, 920102, 920103, 920104];
        for (const id of ids) await insertViesiejiPirkimai(id);

        const readerA = reader();
        const page1 = await readerA.loadProcurements(null, 2);
        const page2FromA = await readerA.loadProcurements(page1.nextCursor, 2);

        const readerB = reader();
        const page2FromB = await readerB.loadProcurements(page1.nextCursor, 2);

        expect(page2FromB.items.map((p) => p.pirkimoNumeris)).toEqual(page2FromA.items.map((p) => p.pirkimoNumeris));
    });
});

describe("ProcurementReader orphan lots", () => {
    it("drops a lot whose pirkimoNumeris has no matching procurement, and logs it, without dropping others", async () => {
        // Orphan: ATN-1 participation with no viesiejiPirkimai registration.
        const orphanAtaskaitaId = await insertAtaskaita({
            pirkimoNumeris: "930001",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertDalyvis({ ataskaitaId: orphanAtaskaitaId, kodas: "B1" });
        await insertPasiulymas({ ataskaitaId: orphanAtaskaitaId, daliesNumeris: null, dalyvioKodas: "B1" });

        // A normal, registered procurement with its own declared lot.
        await insertViesiejiPirkimai(930002);
        await insertDeclaredLot(930002, 1, "Dalis 1");

        const procurements = await loadAll(reader());

        expect(procurements.find((p) => p.pirkimoNumeris === "930001")).toBeUndefined();
        const normal = procurements.find((p) => p.pirkimoNumeris === "930002");
        expect(normal!.lots.map((l) => l.daliesNumeris)).toEqual(["1"]);
        expect(vi.mocked(log)).toHaveBeenCalled();
    });

    it("never calls log when a run has no orphan lots", async () => {
        await insertViesiejiPirkimai(930003);
        await insertDeclaredLot(930003, 1, "Dalis 1");

        await loadAll(reader());

        expect(vi.mocked(log)).not.toHaveBeenCalled();
    });
});

describe("ProcurementReader lot-grain participation", () => {
    async function insertObservedLot(params: {
        pirkimoId: number;
        daliesNumeris: string | null;
        bidders: readonly { kodas: string | null; valid: boolean }[];
        reportedAt?: string;
    }): Promise<void> {
        const pirkimoNumeris = String(params.pirkimoId);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris,
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: params.reportedAt ?? "2026-05-04T09:30:00Z",
        });
        for (const bidder of params.bidders) {
            await insertDalyvis({ ataskaitaId, kodas: bidder.kodas });
            if (bidder.kodas === null) continue;
            if (bidder.valid) {
                await insertPasiulymas({ ataskaitaId, daliesNumeris: params.daliesNumeris, dalyvioKodas: bidder.kodas });
            } else {
                await insertAtmestasPasiulymas({ ataskaitaId, daliesNumeris: params.daliesNumeris, dalyvioKodas: bidder.kodas });
            }
        }
    }

    it("counts distinct suppliers, excluding rejected ones from validBids", async () => {
        await insertViesiejiPirkimai(940001);
        await insertObservedLot({
            pirkimoId: 940001,
            daliesNumeris: null,
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B2", valid: false },
            ],
        });

        const [procurement] = await loadAll(reader(["940001"]));
        expect(procurement.lots).toHaveLength(1);
        expect(procurement.lots[0].daliesNumeris).toBe("0");
        expect(procurement.lots[0].participation).toEqual({ totalBids: 2, validBids: 1, reportedAt: "2026-05-04T09:30:00Z" });
    });

    it("does not let duplicate participant rows inflate the count", async () => {
        await insertViesiejiPirkimai(940002);
        await insertObservedLot({
            pirkimoId: 940002,
            daliesNumeris: null,
            bidders: [
                { kodas: "B1", valid: true },
                { kodas: "B1", valid: true },
            ],
        });

        const [procurement] = await loadAll(reader(["940002"]));
        expect(procurement.lots[0].participation).toMatchObject({ totalBids: 1, validBids: 1 });
    });

    it("distinguishes no participation observed (null) from a report with only a null-coded participant (0)", async () => {
        await insertViesiejiPirkimai(940003);
        await insertDeclaredLot(940003, 1, "Dalis 1"); // declared, never observed

        await insertViesiejiPirkimai(940004);
        await insertObservedLot({ pirkimoId: 940004, daliesNumeris: null, bidders: [{ kodas: null, valid: true }] });

        const [declaredOnly] = await loadAll(reader(["940003"]));
        expect(declaredOnly.lots[0].participation).toBeNull();

        const [nullCoded] = await loadAll(reader(["940004"]));
        expect(nullCoded.lots[0].participation).toMatchObject({ totalBids: 0, validBids: 0 });
    });

    it("hides a report recorded after the cutoff, and shows it at a later one", async () => {
        await insertViesiejiPirkimai(940005);
        await insertObservedLot({
            pirkimoId: 940005,
            daliesNumeris: null,
            bidders: [{ kodas: "B1", valid: true }],
            reportedAt: "2026-09-01T00:00:00Z",
        });

        const [beforeCutoff] = await loadAll(reader(["940005"], DATA_AS_OF));
        expect(beforeCutoff.lots[0].participation).toBeNull();

        const [afterCutoff] = await loadAll(reader(["940005"], "2026-10-01T00:00:00.000Z"));
        expect(afterCutoff.lots[0].participation).toMatchObject({ totalBids: 1, validBids: 1 });
    });
});

describe("ProcurementReader procurement-grain participation", () => {
    it("counts the same supplier once when it bids on two lots of the same procurement", async () => {
        await insertViesiejiPirkimai(950001);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "950001",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 2,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertDalyvis({ ataskaitaId, kodas: "B1" });
        await insertPasiulymas({ ataskaitaId, daliesNumeris: "1", dalyvioKodas: "B1" });
        await insertPasiulymas({ ataskaitaId, daliesNumeris: "2", dalyvioKodas: "B1" });

        const [procurement] = await loadAll(reader(["950001"]));
        expect(procurement.participation).toEqual({ totalSuppliers: 1, reportedAt: "2026-05-04T09:30:00Z" });
    });

    it("unions distinct suppliers across different lots", async () => {
        await insertViesiejiPirkimai(950002);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "950002",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 2,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertDalyvis({ ataskaitaId, kodas: "B1" });
        await insertDalyvis({ ataskaitaId, kodas: "B2" });
        await insertPasiulymas({ ataskaitaId, daliesNumeris: "1", dalyvioKodas: "B1" });
        await insertPasiulymas({ ataskaitaId, daliesNumeris: "2", dalyvioKodas: "B2" });

        const [procurement] = await loadAll(reader(["950002"]));
        expect(procurement.participation).toMatchObject({ totalSuppliers: 2 });
    });

    it("is null when no participation was observed for the procurement", async () => {
        await insertViesiejiPirkimai(950003);

        const [procurement] = await loadAll(reader(["950003"]));
        expect(procurement.participation).toBeNull();
    });
});

describe("ProcurementReader bid-grain rows (Lot.bids)", () => {
    it("loads one Bid per bidder, carrying its ranking and rejection outcome", async () => {
        await insertViesiejiPirkimai(960001);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "960001",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertDalyvis({ ataskaitaId, kodas: "B1" });
        await insertPasiulymas({ ataskaitaId, daliesNumeris: "1", dalyvioKodas: "B1", kaina: "5000" });
        await insertDalyvis({ ataskaitaId, kodas: "B2" });
        await insertAtmestasPasiulymas({ ataskaitaId, daliesNumeris: "1", dalyvioKodas: "B2", statusas: WITHDRAWN_STATUS });

        const [procurement] = await loadAll(reader(["960001"]));
        const bids = [...procurement.lots[0].bids].sort((a, b) => a.tiekejoKodas.localeCompare(b.tiekejoKodas));

        expect(bids).toHaveLength(2);
        expect(bids[0]).toMatchObject({ tiekejoKodas: "B1", eileNumeris: 1, pasiulymoKaina: 5000, atmetimoStatusas: null });
        expect(bids[1]).toMatchObject({ tiekejoKodas: "B2", atmetimoStatusas: WITHDRAWN_STATUS });
    });

    it("excludes a null-coded participant — no durable key to attach a Bid subject to", async () => {
        await insertViesiejiPirkimai(960002);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "960002",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertDalyvis({ ataskaitaId, kodas: null });

        const [procurement] = await loadAll(reader(["960002"]));
        expect(procurement.lots[0].bids).toEqual([]);
        // Still visible in the aggregate participation count, just not as a Bid.
        expect(procurement.lots[0].participation).toMatchObject({ totalBids: 0 });
    });

    it("collapses a duplicate rejection row for the same bidder to one Bid, preferring the one carrying an outcome", async () => {
        await insertViesiejiPirkimai(960003);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "960003",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertDalyvis({ ataskaitaId, kodas: "B1" });
        // Same bidder rejected twice under the same lot — a real data-quality
        // issue observed in the warehouse (duplicate xlsxPPAatmestiPasiulymai
        // rows with identical ataskaitosData).
        await insertAtmestasPasiulymas({ ataskaitaId, daliesNumeris: "1", dalyvioKodas: "B1", statusas: WITHDRAWN_STATUS });
        await insertAtmestasPasiulymas({ ataskaitaId, daliesNumeris: "1", dalyvioKodas: "B1", statusas: WITHDRAWN_STATUS });

        const [procurement] = await loadAll(reader(["960003"]));
        expect(procurement.lots[0].bids).toHaveLength(1);
        expect(procurement.lots[0].bids[0]).toMatchObject({ tiekejoKodas: "B1", atmetimoStatusas: WITHDRAWN_STATUS });
    });

    it("hides a bid recorded after the cutoff, and shows it at a later one", async () => {
        await insertViesiejiPirkimai(960004);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "960004",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-09-01T00:00:00Z",
        });
        await insertDalyvis({ ataskaitaId, kodas: "B1" });
        await insertPasiulymas({ ataskaitaId, daliesNumeris: "1", dalyvioKodas: "B1" });

        const [beforeCutoff] = await loadAll(reader(["960004"], DATA_AS_OF));
        expect(beforeCutoff.lots[0].bids).toEqual([]);

        const [afterCutoff] = await loadAll(reader(["960004"], "2026-10-01T00:00:00.000Z"));
        expect(afterCutoff.lots[0].bids).toHaveLength(1);
    });
});
