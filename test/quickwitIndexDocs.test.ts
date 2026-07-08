import { beforeEach, describe, expect, it, vi } from "vitest";

const makeClient = (events: string[]) => ({
  release: vi.fn(() => events.push("release")),
  query: vi.fn(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, " ").trim();
    events.push(normalized);

    if (normalized.startsWith("SELECT \"eilutesId\", \"indeksas\"")) {
      return { rows: [] };
    }
    if (normalized.startsWith("SELECT \"indeksas\" FROM \"quickwitIndeksai\"")) {
      return { rows: [] };
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

async function loadQuickwit(events: string[], fetchMock: ReturnType<typeof vi.fn>) {
  vi.resetModules();
  const client = makeClient(events);

  vi.doMock("../postgres/postgres.js", () => ({
    postgres: {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string) => {
        events.push(`pool:${sql.replace(/\s+/g, " ").trim()}`);
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
  return { indexDocs: mod.indexDocs as typeof import("../quickwit/quickwit.js").indexDocs, client };
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
});
