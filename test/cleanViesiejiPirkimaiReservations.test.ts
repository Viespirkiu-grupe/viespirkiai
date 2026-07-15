import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../postgres/postgres.js", () => ({
    postgres: {
        query: vi.fn(),
        end: vi.fn(),
    },
}));

vi.mock("../utils/log.js", () => ({
    log: vi.fn(),
}));

import { postgres } from "../postgres/postgres.js";
import {
    cleanReservations,
    cleanReservationsHasMore,
} from "../modules/viesiejiPirkimai/cleanReservations.js";

describe("cleanReservations", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("filters reservations by typeId and returns counts under type names", async () => {
        vi.mocked(postgres.query).mockResolvedValue({
            rows: [
                { typeId: 1, count: 2 },
                { typeId: 3, count: 1 },
            ],
        } as never);

        const result = await cleanReservations({
            maxAgeMinutes: 30,
            types: ["CfTWS", "CfTDPSWS"],
        });

        expect(postgres.query).toHaveBeenCalledOnce();
        const [sql, params] = vi.mocked(postgres.query).mock.calls[0];
        expect(sql).toContain('v."typeId" = ANY($1::int[])');
        expect(sql).toContain('RETURNING v."typeId"');
        expect(sql).not.toContain("v.type");
        expect(params).toEqual([[1, 3], "30"]);
        expect(result).toEqual({
            total: 3,
            perType: { CfTWS: 2, CfTDPSWS: 1 },
        });
    });

    it("does not query when none of the requested types are known", async () => {
        await expect(cleanReservations({ types: ["Unknown"] })).resolves.toEqual({
            total: 0,
            perType: {},
        });
        expect(postgres.query).not.toHaveBeenCalled();
    });

    it("returns TaskRunner has-more semantics instead of an always-truthy result object", async () => {
        vi.mocked(postgres.query)
            .mockResolvedValueOnce({ rows: [] } as never)
            .mockResolvedValueOnce({ rows: [{ typeId: 1, count: 2 }] } as never);

        await expect(cleanReservationsHasMore()).resolves.toBe(false);
        await expect(cleanReservationsHasMore()).resolves.toBe(true);
    });
});
