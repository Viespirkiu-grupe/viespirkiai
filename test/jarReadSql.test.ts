import { describe, expect, it } from "vitest";
import { JAR_ADDRESS_JOINS } from "../modules/juridiniai/jarReadSql.js";

describe("normalizuoto JAR adreso SQL", () => {
    it("patalpos geometriją ima iš jos pirminio pastato AOB kodo", () => {
        expect(JAR_ADDRESS_JOINS).toContain(
            'jar_ar."kodas" = COALESCE(jar_room."aobKodas", jar_address."aobKodas")',
        );
    });
});
