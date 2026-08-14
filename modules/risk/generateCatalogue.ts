import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { riskIndicatorRegistry } from "./deployedIndicators.ts";

// Generates catalogue.generated.json: the public metadata of every deployed
// Risk Indicator version, built from the definitions and committed alongside
// them. CI verifies this artefact matches the definitions (§4.2, §8) — no
// Astro consumer exists yet (out of scope for this slice), but the
// generation step and its "matches the definitions" check are cheap to build
// now and are what CI will enforce once the web catalogue page exists.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(HERE, "catalogue.generated.json");

export function buildCatalogue() {
    return riskIndicatorRegistry.all().map((indicator) => ({
        id: indicator.key.id,
        version: indicator.key.version,
        lifecycle: indicator.lifecycle,
        stage: indicator.stage,
        subjectType: indicator.subjectType,
        references: indicator.references,
        standard: indicator.standard,
        public: indicator.public,
        parameters: indicator.parameters,
    }));
}

function main() {
    const catalogue = buildCatalogue();
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(catalogue, null, 4)}\n`, "utf8");
    console.log(`Wrote ${catalogue.length} indicator version(s) to ${OUTPUT_PATH}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
