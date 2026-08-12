import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildCatalogue } from "../../modules/risk/generateCatalogue.ts";

// CI check per risk-service-architecture.md §11: catalogue.generated.json is
// regenerated and compared against the definitions; a stale artefact fails
// the build. Run `npm run risk:catalogue` to regenerate after changing an
// indicator's public wording, lifecycle or parameters.
describe("catalogue.generated.json", () => {
    it("matches the deployed indicator definitions", () => {
        const root = path.dirname(fileURLToPath(import.meta.url));
        const catalogueFile = path.join(root, "../../modules/risk/catalogue.generated.json");
        const onDisk = JSON.parse(fs.readFileSync(catalogueFile, "utf8"));
        expect(onDisk).toEqual(buildCatalogue());
    });
});
