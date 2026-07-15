import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashFailai, prepareFailaiFs } from "../modules/failai/failaiFs.js";

describe("prepareFailaiFs", () => {
    it("uses one canonical serialization for the existing content hash", () => {
        const content = {
            tekstas: "[\"ąžuolas\",\"test\"]",
            metaduomenys: { author: "Test" },
            iban: [],
            jarKodai: [{ jarKodas: "123" }],
        };

        const prepared = prepareFailaiFs(content);

        expect(prepared.json).toBe(JSON.stringify(content));
        expect(prepared.hash).toBe(hashFailai(content));
        expect(prepared.hash).toBe(
            createHash("md5").update(prepared.json).digest("hex"),
        );
    });
});
