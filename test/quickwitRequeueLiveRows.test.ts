import { describe, expect, it } from "vitest";
import {
  formatIndexesTable,
  parseArgs,
  parseInteractiveSelection,
  requeueIndexes,
  requeueSelectedIndexes,
} from "../quickwit/requeueLiveRows.js";

const indexes = [
  { lentele: "dokumentai", indeksas: "dokumentai_1", gyvosEilutes: 900, mirusiosEilutes: 100, deadRatio: 10, current: true },
  { lentele: "dokumentai", indeksas: "dokumentai_2", gyvosEilutes: 5, mirusiosEilutes: 50, deadRatio: 90, current: false },
  { lentele: "dokumentai", indeksas: "dokumentai_3", gyvosEilutes: 300, mirusiosEilutes: 200, deadRatio: 40, current: true },
] as any[];

describe("requeueLiveRows CLI", () => {
  it("parses explicit indexes and filters", () => {
    expect(parseArgs(["dokumentai_2", "dokumentai_3", "--min-dead", "25", "--dry-run"])).toMatchObject({
      dryRun: true, indexes: ["dokumentai_2", "dokumentai_3"], minDead: 25,
    });
  });

  it("accepts sutartys as a table", () => {
    expect(parseArgs(["--lentele", "sutartys", "--top-ratio", "2"])).toMatchObject({
      lentele: "sutartys",
      topRatio: 2,
    });
  });

  it("accepts viesiejiPirkimai as a table", () => {
    expect(parseArgs(["--lentele", "viesiejiPirkimai", "--top-ratio", "2"])).toMatchObject({
      lentele: "viesiejiPirkimai",
      topRatio: 2,
    });
  });

  it("uses all tables when --lentele is omitted", () => {
    expect(parseArgs(["--list"]).lentele).toBeNull();
  });

  it("rejects conflicting selectors", () => {
    expect(() => parseArgs(["dokumentai_2", "--top", "2"])).toThrow(/tik vieną pasirinkimo būdą/);
  });

  it("explains that a positional number is not a database ID or interactive row number", () => {
    expect(() => parseArgs(["32"])).toThrow(/quickwit_indeksas.*dokumentai_32.*interaktyviame/s);
  });

  it("parses interactive ranges", () => {
    expect(parseInteractiveSelection("1,3-3", indexes).map((index: any) => index.indeksas))
      .toEqual(["dokumentai_1", "dokumentai_3"]);
  });

  it("names the selection column in interactive errors", () => {
    expect(() => parseInteractiveSelection("4", indexes)).toThrow(/pasirinkimo_nr.*1-3/);
  });

  it("prints only explicit, unambiguous selection and index columns", () => {
    const table = formatIndexesTable(indexes);
    expect(table).toContain("pasirinkimo_nr  lentele");
    expect(table).toContain("quickwit_indeksas");
    expect(table).toMatch(/\n\s*1\s+dokumentai\s+dokumentai_1/);
    expect(table).not.toContain("(index)");
    expect(table).not.toMatch(/\bid\b/i);
  });

  it("selects interactive top dead rows or ratio", () => {
    expect(parseInteractiveSelection("top 2", indexes).map((index: any) => index.indeksas))
      .toEqual(["dokumentai_3", "dokumentai_1"]);
    expect(parseInteractiveSelection("ratio 2", indexes).map((index: any) => index.indeksas))
      .toEqual(["dokumentai_2", "dokumentai_3"]);
  });
});

describe("requeueLiveRows transaction", () => {
  it("requeues sutartys through the VPM source and queue", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        queries.push(normalized);
        if (normalized.startsWith("SELECT COUNT(*)")) return { rows: [{ total: 1 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const db = { async connect() { return client; } } as any;

    await requeueIndexes(
      [{ id: 2, indeksas: "sutartys_2" }],
      { dryRun: false, lentele: "sutartys" },
      db,
    );

    const sql = queries.join("\n");
    expect(sql).toContain('"vpmSutartysIndexQueue"');
    expect(sql).toContain('JOIN "vpmSutartys"');
    expect(sql).toContain('s."unikalusId"');
    expect(sql).not.toContain('"sutartysIndexQueue"');
  });

  it("groups indexes from different tables into separate transactions", async () => {
    const connectedTables: string[] = [];
    const db = {
      async connect() {
        let table = "";
        return {
          async query(sql: string, params?: any[]) {
            if (sql.includes("pg_advisory_xact_lock")) {
              table = params![0];
              connectedTables.push(table);
            }
            if (sql.replace(/\s+/g, " ").trim().startsWith("SELECT COUNT(*)")) {
              return { rows: [{ total: 1 }], rowCount: 1 };
            }
            return { rows: [], rowCount: sql.startsWith("INSERT") || sql.startsWith("DELETE") ? 0 : null };
          },
          release() {},
        };
      },
    } as any;

    const result = await requeueSelectedIndexes([
      { id: 1, lentele: "dokumentai", indeksas: "dokumentai_1" },
      { id: 2, lentele: "sutartys", indeksas: "sutartys_2" },
    ], { dryRun: true, lentele: null }, db);

    expect(connectedTables).toEqual(["dokumentai", "sutartys"]);
    expect(result.total).toBe(2);
  });

  it("requeues viesiejiPirkimai using numeric IDs without locking the queue table", async () => {
    const queries: string[] = [];
    const client = {
      async query(sql: string) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        queries.push(normalized);
        if (normalized.startsWith("SELECT COUNT(*)")) return { rows: [{ total: 3 }], rowCount: 1 };
        if (normalized.startsWith("DELETE FROM \"viesiejiPirkimaiIndexQueue\"")) return { rows: [], rowCount: 1 };
        if (normalized.startsWith("INSERT INTO \"viesiejiPirkimaiIndexQueue\"")) {
          return { rows: [], rowCount: normalized.includes("LEFT JOIN") ? 1 : 2 };
        }
        return { rows: [], rowCount: null };
      },
      release() {},
    };
    const db = { async connect() { return client; } } as any;

    const result = await requeueIndexes(
      [{ id: 7, indeksas: "viesiejiPirkimai_1" }],
      { dryRun: false, lentele: "viesiejiPirkimai" },
      db,
    );

    expect(result).toEqual({ queuedPatches: 2, queuedDeletes: 1, replacedQueueRows: 1, total: 3 });
    expect(queries.some((sql) => sql.startsWith("LOCK TABLE"))).toBe(false);
    const dataQueries = queries.filter((sql) =>
      sql.includes("\"viesiejiPirkimaiIndexQueue\"") || sql.includes("JOIN \"viesiejiPirkimai\""));
    expect(dataQueries).not.toHaveLength(0);
    expect(dataQueries.every((sql) => !sql.includes('e."eilutesId"::text'))).toBe(true);
    expect(dataQueries.every((sql) => sql.includes('e."eilutesId"::bigint'))).toBe(true);
  });
});
