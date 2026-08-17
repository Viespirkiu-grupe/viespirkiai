import { describe, expect, it } from "vitest";
import { contentHash, stableMd5 } from "../modules/teisekura/upsertDokumentas.js";

describe("teisekura identity", () => {
    it("keeps stable md5 independent of document contents", () => {
        expect(stableMd5("source", "abc")).toBe(stableMd5("source", "abc"));
        expect(stableMd5("source", "abc")).not.toBe(stableMd5("source", "def"));
        expect(contentHash({ text: "a" })).not.toBe(contentHash({ text: "b" }));
    });
});
