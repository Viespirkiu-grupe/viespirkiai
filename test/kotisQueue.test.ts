import { describe, expect, it, vi } from "vitest";
import { claimDetail, failDetail } from "../modules/kotis/detailQueue.js";
import { storeDiscoveredPage } from "../modules/kotis/discoveryStore.js";

describe("KOTIS patvari kortelių eilė", () => {
    it("atominiu SKIP LOCKED veiksmu pasiima vieną kortelę", async () => {
        const job = { pagalbosId: "123", atradimoVersija: "2", claimToken: "token" };
        const db = { query: vi.fn().mockResolvedValue({ rows: [job] }) };

        await expect(claimDetail({ maxAttempts: 5, leaseMinutes: 20 }, db as never)).resolves.toBe(job);

        expect(db.query.mock.calls[0][0]).toContain("FOR UPDATE SKIP LOCKED");
        expect(db.query.mock.calls[0][1][0]).toBe(5);
        expect(db.query.mock.calls[0][1][2]).toBe(20);
    });

    it("po klaidos atlaisvina lease ir suplanuoja kitą bandymą", async () => {
        const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        await failDetail(
            { pagalbosId: 123, claimToken: "claim" },
            new Error("network"),
            db as never,
        );

        expect(db.query.mock.calls[0][0]).toContain('"claimToken" = NULL');
        expect(db.query.mock.calls[0][1]).toEqual([123, "claim", expect.stringContaining("network")]);
    });

    it("sąrašo eilutes saugo tiesiai į saltinioIrasai", async () => {
        const db = { query: vi.fn().mockResolvedValue({ rows: [] }) };
        await storeDiscoveredPage(7, 2, [{
            id: 123,
            url: "https://example.test/paraiskos/view_item/id.123",
            suteikimoData: "2026-08-31",
            gavejas: "Gavėjas",
            teikejas: "Teikėjas",
            suma: 10,
            teisinisPagrindas: "Aktas",
            pagalbosRusis: "Individuali",
            busena: "Registruota",
        }], db as never);

        expect(db.query.mock.calls[0][0]).toContain('INSERT INTO kotis."saltinioIrasai"');
        const payload = JSON.parse(db.query.mock.calls[0][1][1]);
        expect(payload[0]).toEqual(expect.objectContaining({ pagalbosId: 123, puslapis: 2 }));
    });
});
