import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("e-Seimas metadata profile migration", () => {
  it("adds profile and every new OpenAPI metadata key", () => {
    const sql = fs.readFileSync("modules/eSeimas/schema2.sql", "utf8");
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "profile" text');
    expect(sql).toContain("'legal_act_project'");
    for (const key of [
      "document_number", "language", "registration_number", "registration_date",
      "adopting_institution", "project_status", "prepared_by", "coordination",
      "project_participants", "variant_description",
    ]) expect(sql).toContain("('" + key + "', 'scalar')");
    expect(sql).toContain('UPDATE public."eSeimasLegalActScrape"');
  });
});
