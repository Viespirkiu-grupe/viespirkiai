import { describe, expect, it } from "vitest";
import { toLithuanianTime } from "../utils/time.js";

describe("toLithuanianTime", () => {
    it("converts PostgreSQL timestamp strings", () => {
        expect(toLithuanianTime("2024-01-15 10:30:00")).toBe(
            "2024-01-15 12:30:00",
        );
    });

    it("does not turn invalid values into Invalid Date", () => {
        expect(toLithuanianTime("not-a-date")).toBe("not-a-date");
    });
});
