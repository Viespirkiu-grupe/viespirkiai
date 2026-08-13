import { describe, expect, it } from "vitest";
import { metadataUnchanged } from "../modules/juridiniai/updateJarCsv.js";

describe("RC JAR metadata check", () => {
    it("prefers a matching ETag", () => {
        expect(metadataUnchanged(
            { etag: '"abc"', lastModified: null, size: null },
            { etag: '"abc"', lastModified: null, size: null },
        )).toBe(true);
        expect(metadataUnchanged(
            { etag: '"abc"' },
            { etag: '"def"' },
        )).toBe(false);
    });

    it("falls back to Last-Modified and size", () => {
        const previous = {
            etag: null,
            lastModified: new Date("2026-08-01T00:00:00Z"),
            size: "123",
        };
        expect(metadataUnchanged(previous, {
            etag: null,
            lastModified: "Fri, 01 Aug 2026 00:00:00 GMT",
            size: 123,
        })).toBe(true);
        expect(metadataUnchanged(previous, {
            etag: null,
            lastModified: "Fri, 01 Aug 2026 00:00:00 GMT",
            size: 124,
        })).toBe(false);
    });
});
