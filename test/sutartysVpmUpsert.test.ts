import { describe, expect, it, vi } from "vitest";
import {
    buildVpmSutartisSearchText,
    UPSERT_SQL,
    upsertVpmSutartis,
} from "../modules/sutartys/upsertVpmSutartis.js";

describe("VPM sutartis upsert", () => {
    it("writes only on hash change, archives only an old changed version, and always tracks now", async () => {
        const query = vi.fn().mockResolvedValue({
            rows: [{ existed: true, written: true, archived: true, tracked: true }],
        });
        const contract = {
            unikalusId: 1,
            pavadinimas: "Sutartis",
            bvpzKodas: 12345678,
            kategorija: "Prekės",
            perkanciosiosOrganizacijosPavadinimas: "Pirkėjas",
            perkanciosiosOrganizacijosKodas: "111",
            sutartiesNumeris: "S-1",
            pirmoTiekejoPavadinimas: "Tiekėjas",
            pirmoTiekejoKodas: "222",
            tipas: "SP",
            pirkimoNumeris: "P-1",
            papildomiTiekejai: [],
            papildomiBvpzKodai: [],
        };
        const prepared = {
            json: JSON.stringify(contract),
            md5: "c4ca4238a0b923820dcc509a6f75849b",
        };
        const searchText = buildVpmSutartisSearchText(prepared.json);

        await expect(upsertVpmSutartis(prepared, { query })).resolves.toEqual({
            existed: true,
            written: true,
            archived: true,
            tracked: true,
        });
        // Paruošta (prepared) užklausa – vienas konfigūracijos objektas.
        expect(query).toHaveBeenCalledWith({
            name: "vpmSutartisUpsert",
            text: UPSERT_SQL,
            values: [prepared.json, prepared.md5, searchText],
        });
        expect(UPSERT_SQL).toContain(
            'WHERE "sutartys".hash IS DISTINCT FROM EXCLUDED.hash',
        );
        expect(UPSERT_SQL).toMatch(
            /JOIN old_document old ON old\.hash IS DISTINCT FROM i\.hash/,
        );
        expect(UPSERT_SQL).toMatch(/matyta = now\(\),\s+atnaujinta = now\(\)/);
        expect(UPSERT_SQL).toContain("FROM main_upsert changed");
        expect(UPSERT_SQL).toContain("to_tsvector('simple', $3)");
        expect(UPSERT_SQL).toContain("(i.doc->>'paskelbimoData')::timestamp");
        expect(UPSERT_SQL).toContain("'YYYY-MM-DD\"T\"HH24:MI:SS.MS'");
        expect(UPSERT_SQL).not.toContain('HH24:MI:SS.MS\"Z\"');
        expect(UPSERT_SQL).toMatch(
            /JOIN main_upsert changed\s+ON changed\."unikalusId"/,
        );
        expect(UPSERT_SQL).toContain(
            "COALESCE(\n            (o.doc->>'faktineVerte')::numeric,\n"
            + "            (o.doc->>'numatomaVerte')::numeric\n        ) AS verte",
        );
        expect(UPSERT_SQL).toMatch(
            /agg_events AS MATERIALIZED[\s\S]*?FROM old_document o\s+JOIN main_upsert changed/,
        );
        expect(UPSERT_SQL).toMatch(
            /agg_events AS MATERIALIZED[\s\S]*?FROM incoming i\s+JOIN main_upsert changed/,
        );
        expect(UPSERT_SQL).toContain(
            "WHERE NULLIF(supplier->>'kodas', '') IS NOT NULL",
        );
        expect(UPSERT_SQL).toContain("WHERE e.pirkejas IS NOT NULL");
        expect(UPSERT_SQL).toContain(
            'ON CONFLICT ("pirkejoKodas", "tiekejoKodas") DO UPDATE SET',
        );
        expect(UPSERT_SQL.match(
            /INSERT INTO "vpmSutartys"\."sumos"/g,
        )).toHaveLength(1);
        expect(UPSERT_SQL.match(
            /INSERT INTO "vpmSutartys"\."sumosMetai"/g,
        )).toHaveLength(1);
    });

    it("builds search text in field order and omits null or empty values", () => {
        expect(buildVpmSutartisSearchText({
            unikalusId: 42,
            pavadinimas: " Sutarties pavadinimas ",
            bvpzKodas: 12345678,
            kategorija: "",
            perkanciosiosOrganizacijosPavadinimas: "Pirkėjas",
            perkanciosiosOrganizacijosKodas: null,
            sutartiesNumeris: "S-42",
            pirmoTiekejoPavadinimas: "Tiekėjas",
            pirmoTiekejoKodas: "222",
            tipas: "SP",
            pirkimoNumeris: null,
            papildomiTiekejai: [
                { pavadinimas: "Papildomas", kodas: "333" },
                { pavadinimas: "", kodas: null },
            ],
            papildomiBvpzKodai: [87654321, 11223344],
        })).toBe(
            "42 Sutarties pavadinimas 12345678 Pirkėjas S-42 "
            + "Tiekėjas 222 SP Papildomas 333 87654321 11223344",
        );
    });
});
