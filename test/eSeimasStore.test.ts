import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("../postgres/postgres.js", () => ({ postgres: mocks }));

import { saveDocument, saveEditionList, upsertDiscoveredActs } from "../modules/eSeimas/eSeimasStore.js";

describe("e-Seimas store identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("discovers by the composite category/id key and deduplicates one response page", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [
        { category: "TAD", legalActId: "SAME" },
        { category: "TAK", legalActId: "SAME" },
      ], rowCount: 2 });

    await expect(upsertDiscoveredActs([
      { category: "TAD", id: "SAME", title: "Pirmas" },
      { category: "TAD", id: "SAME", title: "Pakartotas" },
      { category: "TAK", id: "SAME", title: "Kita kategorija" },
      { id: "NO_CATEGORY", title: "Praleidžiamas" },
    ])).resolves.toBe(2);

    const [upsertSql, upsertParams] = mocks.query.mock.calls[0];
    expect(upsertSql).toContain('ON CONFLICT ("category", "legalActId")');
    expect(upsertParams).toEqual([
      ["TAD", "TAK"], ["SAME", "SAME"], ["Pakartotas", "Kita kategorija"],
    ]);
    const [queueSql, queueParams] = mocks.query.mock.calls[1];
    expect(queueSql).toContain('RETURNING "category", "legalActId"');
    expect(queueParams).toEqual([["TAD", "TAK"], ["SAME", "SAME"]]);
  });

  it("refuses document payloads without the route category", async () => {
    await expect(saveDocument({ id: "ABC" }, { md5: "0".repeat(32) } as any))
      .rejects.toThrow("trūksta category");
    await expect(saveEditionList({ id: "ABC" }, { md5: "0".repeat(32) } as any))
      .rejects.toThrow("trūksta category");
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.connect).not.toHaveBeenCalled();
  });
});
