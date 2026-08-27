// Integration test for the Procurement Reader (modules/risk/procurementReader.ts):
// proves ProcurementReader against the real v_pirkimas_v2/v_pirkimo_dalis_v2/
// v_dalyviai_v2/v_pirkimo_pabaiga_v2/v_pirkimo_sutartys_v2 views, in the
// local risk-dev Postgres's test-only `public` schema. See
// docs/indicators-story/risk-service-architecture-v2.md §1.2.
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
    insertProceduruPabaiga,
    insertVpmSutartis,
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
        await insertPasiulymas({ ataskaitaId, daliesNumeris: "1", dalyvioKodas: "B1", eileNumeris: 1, kaina: "5000" });
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

describe("ProcurementReader procedure-outcome (LT-OTH-05)", () => {
    it("collects the single lot's outcome label", async () => {
        await insertViesiejiPirkimai(970001);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970001",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
            sprendimoPriemimoData: "2026-05-10",
        });

        const [procurement] = await loadAll(reader(["970001"]));
        expect(procurement.procedureOutcome).toEqual({
            lotOutcomes: [
                "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
            ],
            lots: [
                {
                    daliesNumeris: "0",
                    proceduruPabaiga:
                        "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
                    sprendimoPriemimoData: "2026-05-10",
                    sprendimoPriezastys: null,
                },
            ],
            reportedAt: "2026-05-10",
            isFramework: null,
            complaintFiled: null,
            courtChallenged: null,
        });
    });

    it("collects every distinct outcome label across a multi-lot procedure, and the latest decision date", async () => {
        await insertViesiejiPirkimai(970002);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970002",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 2,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: "1",
            proceduruPabaiga: "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
            sprendimoPriemimoData: "2026-05-10",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: "2",
            proceduruPabaiga: "Nutraukus pirkimo ar projekto konkurso procedūras",
            sprendimoPriemimoData: "2026-05-20",
        });

        const [procurement] = await loadAll(reader(["970002"]));
        expect(procurement.procedureOutcome!.lotOutcomes.sort()).toEqual(
            [
                "Nutraukus pirkimo ar projekto konkurso procedūras",
                "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
            ].sort(),
        );
        expect(procurement.procedureOutcome!.reportedAt).toBe("2026-05-20");
        // Each lot's own outcome stays paired with its own decision date —
        // the correlation lotOutcomes/reportedAt collapse away, which
        // LT-OTH-03 depends on (a lot's evaluation period is undefined
        // without knowing which decision date belongs to which lot).
        expect([...procurement.procedureOutcome!.lots].sort((a, b) => a.daliesNumeris.localeCompare(b.daliesNumeris))).toEqual([
            {
                daliesNumeris: "1",
                proceduruPabaiga:
                    "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
                sprendimoPriemimoData: "2026-05-10",
                sprendimoPriezastys: null,
            },
            {
                daliesNumeris: "2",
                proceduruPabaiga: "Nutraukus pirkimo ar projekto konkurso procedūras",
                sprendimoPriemimoData: "2026-05-20",
                sprendimoPriezastys: null,
            },
        ]);
    });

    it("carries the lot's stated decision reason (LT-TRA-06), and null when the report leaves it blank", async () => {
        await insertViesiejiPirkimai(970010);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970010",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 2,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: "1",
            proceduruPabaiga: "Sudarius pirkimo sutartį",
            sprendimoPriemimoData: "2026-05-10",
            sprendimoPriezastys: "Ekonomiškai naudingiausias pasiūlymas",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: "2",
            proceduruPabaiga: "Nutraukus pirkimo ar projekto konkurso procedūras",
            sprendimoPriemimoData: "2026-05-20",
        });

        const [procurement] = await loadAll(reader(["970010"]));
        const lots = [...procurement.procedureOutcome!.lots].sort((a, b) => a.daliesNumeris.localeCompare(b.daliesNumeris));
        expect(lots[0].sprendimoPriezastys).toBe("Ekonomiškai naudingiausias pasiūlymas");
        expect(lots[1].sprendimoPriezastys).toBeNull();
    });

    it("is null when no procedure-ending decision was observed at all", async () => {
        await insertViesiejiPirkimai(970003);

        const [procurement] = await loadAll(reader(["970003"]));
        expect(procurement.procedureOutcome).toBeNull();
    });

    it("is still collected when a report has no participant rows — the 'no bids received' case", async () => {
        // No insertDalyvis call: this is exactly the case v_dalyviai/v_dalyviai_v2
        // cannot see (their JOIN on xlsxPPAdalyviai drops it), and the reason
        // v_pirkimo_pabaiga_v2 reads xlsxPPAataskaitos/xlsxPPAproceduruPabaiga
        // directly instead.
        await insertViesiejiPirkimai(970004);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970004",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Per nustatytą terminą tiekėjams nepateikus nė vienos paraiškos, pasiūlymo, projekto konkurso plano ar projekto",
        });

        const [procurement] = await loadAll(reader(["970004"]));
        expect(procurement.procedureOutcome!.lotOutcomes).toEqual([
            "Per nustatytą terminą tiekėjams nepateikus nė vienos paraiškos, pasiūlymo, projekto konkurso plano ar projekto",
        ]);
    });

    it("hides an outcome recorded after the cutoff, and shows it at a later one", async () => {
        await insertViesiejiPirkimai(970005);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970005",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-09-01T00:00:00Z",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Atmetus visas paraiškas, pasiūlymus, projekto konkurso planus ar projektus",
        });

        const [beforeCutoff] = await loadAll(reader(["970005"], DATA_AS_OF));
        expect(beforeCutoff.procedureOutcome).toBeNull();

        const [afterCutoff] = await loadAll(reader(["970005"], "2026-10-01T00:00:00.000Z"));
        expect(afterCutoff.procedureOutcome!.lotOutcomes).toEqual([
            "Atmetus visas paraiškas, pasiūlymus, projekto konkurso planus ar projektus",
        ]);
    });

    it("carries isFramework: true (LT-PRI-06) from xlsxPPAataskaitos.preliminariSutartis", async () => {
        await insertViesiejiPirkimai(970006);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970006",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            preliminariSutartis: true,
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
        });

        const [procurement] = await loadAll(reader(["970006"]));
        expect(procurement.procedureOutcome!.isFramework).toBe(true);
    });

    it("carries isFramework: false when the report positively says this is not a framework agreement", async () => {
        await insertViesiejiPirkimai(970007);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970007",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            preliminariSutartis: false,
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970007"]));
        expect(procurement.procedureOutcome!.isFramework).toBe(false);
    });

    it("isFramework is true if any report revision under the same pirkimoNumeris says so (bool_or)", async () => {
        await insertViesiejiPirkimai(970008);
        const falseAtaskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970008",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            preliminariSutartis: false,
        });
        await insertProceduruPabaiga({
            ataskaitaId: falseAtaskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });
        const trueAtaskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970008",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-06-01T09:30:00Z",
            preliminariSutartis: true,
        });
        await insertProceduruPabaiga({
            ataskaitaId: trueAtaskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį (preliminariąją sutartį), sukūrus dinaminę pirkimų sistemą arba nustačius projekto konkurso laimėtoją",
        });

        const [procurement] = await loadAll(reader(["970008"]));
        expect(procurement.procedureOutcome!.isFramework).toBe(true);
    });

    it("isFramework is null when no report revision ever populated the field", async () => {
        await insertViesiejiPirkimai(970009);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970009",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970009"]));
        expect(procurement.procedureOutcome!.isFramework).toBeNull();
    });

    it("carries complaintFiled: true (LT-TRA-07) from xlsxPPAataskaitos.pretenzijaPateikta", async () => {
        await insertViesiejiPirkimai(970011);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970011",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            pretenzijaPateikta: true,
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970011"]));
        expect(procurement.procedureOutcome!.complaintFiled).toBe(true);
    });

    it("carries complaintFiled: false when the report positively says no complaint was filed", async () => {
        await insertViesiejiPirkimai(970012);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970012",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            pretenzijaPateikta: false,
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970012"]));
        expect(procurement.procedureOutcome!.complaintFiled).toBe(false);
    });

    it("complaintFiled is true if any report revision under the same pirkimoNumeris says so (bool_or)", async () => {
        await insertViesiejiPirkimai(970013);
        const falseAtaskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970013",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            pretenzijaPateikta: false,
        });
        await insertProceduruPabaiga({
            ataskaitaId: falseAtaskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });
        const trueAtaskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970013",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-06-01T09:30:00Z",
            pretenzijaPateikta: true,
        });
        await insertProceduruPabaiga({
            ataskaitaId: trueAtaskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970013"]));
        expect(procurement.procedureOutcome!.complaintFiled).toBe(true);
    });

    it("complaintFiled is null when no report revision ever populated the field", async () => {
        await insertViesiejiPirkimai(970014);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970014",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970014"]));
        expect(procurement.procedureOutcome!.complaintFiled).toBeNull();
    });

    it("carries courtChallenged: true (LT-TRA-08) from xlsxPPAataskaitos.ieskinysTeismui", async () => {
        await insertViesiejiPirkimai(970015);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970015",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            ieskinysTeismui: true,
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970015"]));
        expect(procurement.procedureOutcome!.courtChallenged).toBe(true);
    });

    it("carries courtChallenged: false when the report positively says no lawsuit was filed", async () => {
        await insertViesiejiPirkimai(970016);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970016",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            ieskinysTeismui: false,
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970016"]));
        expect(procurement.procedureOutcome!.courtChallenged).toBe(false);
    });

    it("courtChallenged is true if any report revision under the same pirkimoNumeris says so (bool_or)", async () => {
        await insertViesiejiPirkimai(970017);
        const falseAtaskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970017",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
            ieskinysTeismui: false,
        });
        await insertProceduruPabaiga({
            ataskaitaId: falseAtaskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });
        const trueAtaskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970017",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-06-01T09:30:00Z",
            ieskinysTeismui: true,
        });
        await insertProceduruPabaiga({
            ataskaitaId: trueAtaskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970017"]));
        expect(procurement.procedureOutcome!.courtChallenged).toBe(true);
    });

    it("courtChallenged is null when no report revision ever populated the field", async () => {
        await insertViesiejiPirkimai(970018);
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "970018",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertProceduruPabaiga({
            ataskaitaId,
            daliesNumeris: null,
            proceduruPabaiga: "Sudarius pirkimo sutartį",
        });

        const [procurement] = await loadAll(reader(["970018"]));
        expect(procurement.procedureOutcome!.courtChallenged).toBeNull();
    });
});

describe("ProcurementReader contract signature dates (LT-OTH-04)", () => {
    it("collects a single contract's signature date", async () => {
        await insertViesiejiPirkimai(980001);
        await insertVpmSutartis({ pirkimoNumeris: "980001", sudarymoData: "2026-05-15" });

        const [procurement] = await loadAll(reader(["980001"]));
        expect(procurement.contractSignatureDates).toEqual(["2026-05-15"]);
    });

    it("collects every distinct signature date across the procurement's own contracts", async () => {
        await insertViesiejiPirkimai(980002);
        await insertVpmSutartis({ pirkimoNumeris: "980002", sudarymoData: "2026-05-15" });
        await insertVpmSutartis({ pirkimoNumeris: "980002", sudarymoData: "2026-06-20" });

        const [procurement] = await loadAll(reader(["980002"]));
        expect(procurement.contractSignatureDates!.slice().sort()).toEqual(["2026-05-15", "2026-06-20"]);
    });

    it("is null when no contract resolves to this procurement's pirkimoNumeris at all", async () => {
        await insertViesiejiPirkimai(980003);

        const [procurement] = await loadAll(reader(["980003"]));
        expect(procurement.contractSignatureDates).toBeNull();
    });

    it("ignores a deleted contract", async () => {
        await insertViesiejiPirkimai(980004);
        await insertVpmSutartis({ pirkimoNumeris: "980004", sudarymoData: "2026-05-15", istrinta: true });

        const [procurement] = await loadAll(reader(["980004"]));
        expect(procurement.contractSignatureDates).toBeNull();
    });

    it("ignores a contract with no signature date", async () => {
        await insertViesiejiPirkimai(980005);
        await insertVpmSutartis({ pirkimoNumeris: "980005", sudarymoData: null });

        const [procurement] = await loadAll(reader(["980005"]));
        expect(procurement.contractSignatureDates).toBeNull();
    });
});
