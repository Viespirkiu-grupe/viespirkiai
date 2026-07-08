import { beforeEach, describe, expect, it, vi } from "vitest";

const makeClient = (
  events: string[],
  opts: {
    existingRows?: { eilutesId: string | number; indeksaiId: number; indeksas: string }[];
    nextIds?: (string | number)[];
    currentShardRows?: { id: number; indeksas: string }[];
  } = {},
) => ({
  release: vi.fn(() => events.push("release")),
  query: vi.fn(async (sql: string, params?: any[]) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    events.push(normalized);

    if (normalized.startsWith("SELECT e.\"eilutesId\", e.\"indeksaiId\", i.\"indeksas\"")) {
      return { rows: opts.existingRows ?? [] };
    }
    if (normalized.startsWith("SELECT id FROM \"quickwitLenteles\"")) {
      return { rows: [{ id: 7 }] };
    }
    if (normalized.startsWith("SELECT nextval")) {
      const count = params?.[0] ?? 0;
      const nextIds = opts.nextIds ?? Array.from({ length: count }, (_, i) => i + 101);
      return { rows: nextIds.slice(0, count).map((id) => ({ id })) };
    }
    if (normalized.startsWith("SELECT id, \"indeksas\" FROM \"quickwitIndeksai\"")) {
      return { rows: opts.currentShardRows ?? [] };
    }
    if (normalized.startsWith("INSERT INTO \"quickwitIndeksai\"")) {
      return { rows: [{ id: 1, indeksas: "test_1" }] };
    }
    if (normalized.startsWith("SELECT \"defaultShardSize\"")) {
      return {
        rows: [{
          defaultShardSize: 1000,
          indexConfig: "index_id: template\n",
          indexConfigHash: "hash",
        }],
      };
    }
    if (normalized.startsWith("SELECT COALESCE(MAX(\"seq\"), 0) + 1")) {
      return { rows: [{ nextSeq: 1 }] };
    }
    return { rows: [] };
  }),
});

async function loadQuickwit(
  events: string[],
  fetchMock: ReturnType<typeof vi.fn>,
  opts: {
    existingRows?: { eilutesId: string | number; indeksaiId: number; indeksas: string }[];
    nextIds?: (string | number)[];
    currentShardRows?: { id: number; indeksas: string }[];
    poolQuery?: (sql: string, params?: any[]) => Promise<{ rows: any[] }>;
  } = {},
) {
  vi.resetModules();
  const client = makeClient(events, opts);

  vi.doMock("../postgres/postgres.js", () => ({
    postgres: {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string, params?: any[]) => {
        events.push(`pool:${sql.replace(/\s+/g, " ").trim()}`);
        if (opts.poolQuery) return opts.poolQuery(sql, params);
        return { rows: [] };
      }),
    },
  }));
  vi.doMock("../utils/config.js", () => ({
    default: { quickwitUrl: "http://quickwit.test", quickwitTimeoutMs: 5000 },
  }));
  vi.doMock("../utils/log.js", () => ({
    Logger: class {
      log() {}
    },
  }));

  vi.stubGlobal("fetch", fetchMock);

  const mod = await import("../quickwit/quickwit.js");
  return {
    indexDocs: mod.indexDocs as typeof import("../quickwit/quickwit.js").indexDocs,
    filterLive: mod.filterLive as typeof import("../quickwit/quickwit.js").filterLive,
    client,
  };
}

describe("indexDocs", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("publishes quickwitEilutes only after Quickwit ingest succeeds", async () => {
    const events: string[] = [];
    const fetchMock = vi.fn(async (url: string, options?: any) => {
      if (url.endsWith("/api/v1/indexes/test_1")) {
        events.push("fetch:index-get");
        return { ok: false, status: 404, text: async () => "missing", json: async () => ({}) };
      }
      if (url.endsWith("/api/v1/indexes")) {
        events.push("fetch:index-create");
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith("/api/v1/test_1/ingest")) {
        events.push("fetch:ingest");
        expect(options.body).toContain("\"quickwitId\"");
        expect(JSON.parse(options.body).quickwitId).toBe("101");
        return {
          ok: true,
          json: async () => ({ num_rejected_docs: 0, num_docs_for_processing: 1 }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { indexDocs } = await loadQuickwit(events, fetchMock);

    await indexDocs("test", [{ eilutesId: "10", doc: { title: "ok" } }]);

    const ingestAt = events.indexOf("fetch:ingest");
    const insertAt = events.findIndex((event) => event.startsWith("INSERT INTO \"quickwitEilutes\""));
    const iterptosAt = events.findIndex((event) => event.startsWith("UPDATE \"quickwitIndeksai\" i SET \"iterptosEilutes\""));
    const commitAt = events.indexOf("COMMIT");

    expect(ingestAt).toBeGreaterThan(-1);
    expect(insertAt).toBeGreaterThan(ingestAt);
    expect(events[insertAt]).toContain("\"indeksaiId\"");
    expect(events[insertAt]).not.toContain("\"indeksas\"");
    expect(events[insertAt]).toContain("\"quickwitIdInt\"");
    expect(events[insertAt]).not.toContain("\"quickwitId\")");
    expect(iterptosAt).toBeGreaterThan(insertAt);
    expect(commitAt).toBeGreaterThan(iterptosAt);
    expect(events.some((event) => event.startsWith("pool:UPDATE \"quickwitIndeksai\""))).toBe(false);
  });

  it("rolls back without publishing quickwitEilutes when ingest fails", async () => {
    const events: string[] = [];
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/v1/indexes/test_1")) {
        events.push("fetch:index-get");
        return { ok: false, status: 404, text: async () => "missing", json: async () => ({}) };
      }
      if (url.endsWith("/api/v1/indexes")) {
        events.push("fetch:index-create");
        return { ok: true, json: async () => ({}) };
      }
      if (url.endsWith("/api/v1/test_1/ingest")) {
        events.push("fetch:ingest");
        return { ok: false, status: 500, text: async () => "boom" };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { indexDocs } = await loadQuickwit(events, fetchMock);

    await expect(indexDocs("test", [{ eilutesId: "10", doc: { title: "bad" } }]))
      .rejects.toThrow(/Quickwit ingest test_1/);

    expect(events.some((event) => event.startsWith("INSERT INTO \"quickwitEilutes\""))).toBe(false);
    expect(events.some((event) => event.startsWith("UPDATE \"quickwitIndeksai\" i SET \"iterptosEilutes\""))).toBe(false);
    expect(events).toContain("ROLLBACK");
    expect(events).not.toContain("COMMIT");
  });

  it("rotates existing UUID mappings to integer ids", async () => {
    const events: string[] = [];
    const fetchMock = vi.fn(async (url: string, options?: any) => {
      if (url.endsWith("/api/v1/test_2/ingest")) {
        events.push("fetch:ingest");
        expect(JSON.parse(options.body).quickwitId).toBe("501");
        return {
          ok: true,
          json: async () => ({ num_rejected_docs: 0, num_docs_for_processing: 1 }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { indexDocs } = await loadQuickwit(events, fetchMock, {
      existingRows: [{ eilutesId: "10", indeksaiId: 2, indeksas: "test_2" }],
      currentShardRows: [{ id: 2, indeksas: "test_2" }],
      nextIds: [501],
    });

    await indexDocs("test", [{ eilutesId: "10", doc: { title: "updated" } }]);

    const update = events.find((event) => event.startsWith("UPDATE \"quickwitEilutes\" AS qe"));
    expect(update).toContain("\"quickwitId\" = NULL");
    expect(update).toContain("\"quickwitIdInt\" = v.\"quickwitIdInt\"");
  });

  it("filters live hits across integer and legacy UUID ids", async () => {
    const events: string[] = [];
    const uuid = "018f0f8e-0e7a-7c0a-9b44-28dfc5ce0a21";
    const fetchMock = vi.fn();

    const { filterLive } = await loadQuickwit(events, fetchMock, {
      poolQuery: async (sql, params) => {
        if (sql.includes("\"quickwitIdInt\"")) {
          expect(params).toEqual([7, ["101", "303"]]);
          return { rows: [{ quickwitIdInt: "303" }] };
        }
        if (sql.includes("\"quickwitId\"")) {
          expect(params).toEqual([7, [uuid]]);
          return { rows: [{ quickwitId: uuid }] };
        }
        if (sql.includes("FROM \"quickwitLenteles\"")) {
          expect(params).toEqual(["test"]);
          return { rows: [{ id: 7 }] };
        }
        return { rows: [] };
      },
    });

    const hits = [
      { quickwitId: "101", title: "stale-int" },
      { quickwitId: uuid, title: "live-uuid" },
      { quickwitId: "303", title: "live-int" },
    ];

    await expect(filterLive("test", hits)).resolves.toEqual([
      { quickwitId: uuid, title: "live-uuid" },
      { quickwitId: "303", title: "live-int" },
    ]);
  });
});
