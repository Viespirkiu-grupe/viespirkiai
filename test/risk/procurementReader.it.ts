// Integration test for the Procurement Reader (modules/risk/procurementReader.ts):
// proves loadProcurements() against the real v_pirkimas/v_pirkimo_dalis views,
// in the local risk-dev Postgres's test-only `public` schema. See
// docs/indicators-story/risk-service-architecture-v2.md §1.
//
// Named `.it.ts` to match this repo's integration-test convention
// (vitest.integration.config.ts); run via `npm run test:integration`, which
// requires the local Docker Postgres from docker/risk/compose.yml to be up.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { riskDb } from "../../postgres/riskDb.js";
import { ensurePublicTestSchema, truncateTestPublicTables } from "./testPublicDb.ts";
import { insertAtaskaita, insertDalyvis, insertPasiulymas } from "../../modules/risk/indicators/test/xlsxPPAFixtures.ts";
import { PostgresRiskDataSource } from "../../modules/risk/riskDataSource.ts";
import { loadProcurements } from "../../modules/risk/procurementReader.ts";

const facts = new PostgresRiskDataSource(riskDb);

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

beforeAll(async () => {
    await ensurePublicTestSchema();
});

beforeEach(async () => {
    await truncateTestPublicTables();
});

afterAll(async () => {
    await riskDb.end();
});

describe("loadProcurements", () => {
    it("groups declared lots under their parent Procurement.lots, keyed by pirkimoNumeris", async () => {
        await insertViesiejiPirkimai(910001);
        await insertDeclaredLot(910001, 1, "Dalis 1");
        await insertDeclaredLot(910001, 2, "Dalis 2");

        const { procurementSubjects } = await loadProcurements(facts, null);
        const subject = procurementSubjects.find((s) => s.procurementId === "910001");

        expect(subject).toBeDefined();
        expect(subject!.procurement.lots.map((l) => l.daliesNumeris).sort()).toEqual(["1", "2"]);
        const first = subject!.procurement.lots.find((l) => l.daliesNumeris === "1");
        expect(first).toMatchObject({
            pirkimoNumeris: "910001",
            daliesPavadinimas: "Dalis 1",
            deklaruota: true,
            stebeta: false,
        });
        expect(first!.subjektoRaktas).toBe("cvpis:910001:1");
    });

    // A lot observed only through ATN-1 participation (public.v_dalyviai),
    // whose pirkimoNumeris has no matching viesiejiPirkimai row — the same
    // ingestion-lag gap the indicators' "unmatched procurement" fixtures
    // exercise. See contracts.ts's LotSubject (procurement: Procurement | null).
    it("produces a LotSubject with procurement: null for an orphan lot", async () => {
        const ataskaitaId = await insertAtaskaita({
            pirkimoNumeris: "910002",
            pirkimoBudas: "Atviras konkursas",
            daliuSkaicius: 1,
            sukurtaAt: "2026-05-04T09:30:00Z",
        });
        await insertDalyvis({ ataskaitaId, kodas: "B1" });
        await insertPasiulymas({ ataskaitaId, daliesNumeris: null, dalyvioKodas: "B1" });

        const { procurementSubjects, lotSubjects } = await loadProcurements(facts, null);

        expect(procurementSubjects.find((s) => s.procurementId === "910002")).toBeUndefined();
        const orphan = lotSubjects.find((s) => s.procurementId === "910002");
        expect(orphan).toBeDefined();
        expect(orphan!.procurement).toBeNull();
        expect(orphan!.subjectKey).toBe("unknown:910002:0");
    });

    it("honors the subjects filter, and returns everything when it is null", async () => {
        await insertViesiejiPirkimai(910003);
        await insertViesiejiPirkimai(910004);

        const filtered = await loadProcurements(facts, ["910003"]);
        expect(filtered.procurementSubjects.map((s) => s.procurementId)).toEqual(["910003"]);

        const all = await loadProcurements(facts, null);
        expect(all.procurementSubjects.map((s) => s.procurementId).sort()).toEqual(["910003", "910004"]);
    });
});
