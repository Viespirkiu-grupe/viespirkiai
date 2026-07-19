import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
    buildCanonicalSutartis,
    prepareCanonicalSutartis,
} from "../modules/sutartys/canonicalSutartis.js";

const schema = JSON.parse(
    readFileSync(
        new URL("../schemas/sutartis.schema.json", import.meta.url),
        "utf8",
    ),
);

describe("canonical sutartis", () => {
    const item = {
        sutartiesUnikalusID: 2005349637,
        pavadinimas: "Mokomosios programos",
        sudarymoData: "2022-02-18",
        galiojimoData: "2022-03-31",
        faktineIvykdimoData: "2022-03-31",
        paskelbimoData: new Date("2022-04-19T00:00:00Z"),
        paskutinioRedagavimoData: new Date("2022-04-19T11:11:33Z"),
        perkanciosiosOrganizacijosKodas: "305607530",
        perkanciojiOrganizacija: "Vilniaus Gabijos gimnazija",
        sutartiesNumeris: "Žodinė sutartis",
        pirkimoNumeris: null,
        verte: 200,
        faktineIvykdimoVerte: null,
        tiekejoKodas: "302612796",
        tiekejas: "Gyvenimo universitetas LT",
        papildomiTiekejai: ["Papildomas tiekėjas"],
        papildomiTiekejaiKodai: ["123456789"],
        tipas: " SP ",
        kategorija: "Prekės",
        bvpzKodas: "48190000-6",
        papildomiBvpzKodai: ["48190000-6", "72212190-7"],
        dokumentai: [{
            pavadinimas: "sutartis.pdf",
            url: "https://eviesiejipirkimai.lt/download.php?dok_id=1&file_id=42",
        }],
    };

    it("builds every field required by the JSON schema", () => {
        const sutartis = buildCanonicalSutartis(item);

        expect(Object.keys(sutartis).sort()).toEqual(
            [...schema.required].sort(),
        );
        expect(sutartis).toMatchObject({
            bvpzKodas: 48190000,
            papildomiBvpzKodai: [48190000, 72212190],
            papildomiTiekejai: [{
                kodas: "123456789",
                pavadinimas: "Papildomas tiekėjas",
            }],
            dokumentai: [{ pavadinimas: "sutartis.pdf", fileId: 42 }],
            istrinta: false,
            pakeitimas: true,
        });
    });

    it("serializes recursively sorted minified JSON and hashes those exact bytes", () => {
        const prepared = prepareCanonicalSutartis(item);

        expect(prepared.json).not.toMatch(/\n|\s{2}/);
        expect(Object.keys(JSON.parse(prepared.json))).toEqual(
            [...schema.required].sort(),
        );
        expect(prepared.json).toContain(
            '"papildomiTiekejai":[{"kodas":"123456789","pavadinimas":"Papildomas tiekėjas"}]',
        );
        expect(prepared.md5).toBe(
            createHash("md5").update(prepared.json).digest("hex"),
        );
    });

    it("išlaiko šaltinio timestamp laiką be UTC poslinkio", () => {
        const prepared = prepareCanonicalSutartis({
            ...item,
            paskelbimoData: "2026-07-19 23:07:28",
            paskutinioRedagavimoData: "2026-07-19 23:07:28",
        });

        expect(prepared.sutartis.paskelbimoData)
            .toBe("2026-07-19T23:07:28.000");
        expect(prepared.sutartis.redagavimoData)
            .toBe("2026-07-19T23:07:28.000");
        expect(prepared.json).not.toContain("20:07:28.000Z");
    });
});
