import { describe, expect, it } from "vitest";
import { parseArgs, parseInteractiveSelection } from "../quickwit/requeueLiveRows.js";

const indexes = [
  { indeksas: "dokumentai_1", mirusiosEilutes: 100, deadRatio: 10 },
  { indeksas: "dokumentai_2", mirusiosEilutes: 50, deadRatio: 90 },
  { indeksas: "dokumentai_3", mirusiosEilutes: 200, deadRatio: 40 },
] as any[];

describe("requeueLiveRows CLI", () => {
  it("parses explicit indexes and filters", () => {
    expect(parseArgs(["dokumentai_2", "dokumentai_3", "--min-dead", "25", "--dry-run"])).toMatchObject({
      dryRun: true, indexes: ["dokumentai_2", "dokumentai_3"], minDead: 25,
    });
  });

  it("rejects conflicting selectors", () => {
    expect(() => parseArgs(["dokumentai_2", "--top", "2"])).toThrow(/tik vieną pasirinkimo būdą/);
  });

  it("parses interactive ranges", () => {
    expect(parseInteractiveSelection("1,3-3", indexes).map((index) => index.indeksas))
      .toEqual(["dokumentai_1", "dokumentai_3"]);
  });

  it("selects interactive top dead rows or ratio", () => {
    expect(parseInteractiveSelection("top 2", indexes).map((index) => index.indeksas))
      .toEqual(["dokumentai_3", "dokumentai_1"]);
    expect(parseInteractiveSelection("ratio 2", indexes).map((index) => index.indeksas))
      .toEqual(["dokumentai_2", "dokumentai_3"]);
  });
});
