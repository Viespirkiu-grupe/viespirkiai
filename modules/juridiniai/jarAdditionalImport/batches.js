async function writeFinancialBatch(client, rows) {
    await client.query(
        `WITH input AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                 "ataskaitosTipas" text, "jarKodas" integer, "pavadinimas" text,
                 "formosKodas" integer, "formosPavadinimas" text,
                 "statusoKodas" integer, "statusoPavadinimas" text,
                 "templateId" text, "templateName" text,
                 "standardId" text, "standardName" text,
                 "laikotarpisNuo" date, "laikotarpisIki" date,
                 "registravimoData" date, "saltinioMetai" smallint,
                 "formavimoData" date, "lineTypeId" text,
                 "lineName" text, "reiksme" numeric
             )
         ), resolved AS (
             SELECT input.*,
                    tipas."id" AS "ataskaitosTipasFk",
                    template."id" AS "templateIdFk",
                    standartas."id" AS "standardIdFk",
                    rodiklis."id" AS "lineTypeIdFk"
             FROM input
             JOIN "rcJar"."finansiniuAtaskaituTipai" tipas
               ON tipas."kodas" = input."ataskaitosTipas"
             JOIN "rcJar"."finansiniuAtaskaituTemplate" template
               ON template."kodas" = input."templateId"
             JOIN "rcJar"."finansiniuAtaskaituStandartai" standartas
               ON standartas."kodas" = input."standardId"
             JOIN "rcJar"."finansiniuAtaskaituRodikliuTipai" rodiklis
               ON rodiklis."kodas" = input."lineTypeId"
         ), report_input AS (
             SELECT DISTINCT ON (
                 "ataskaitosTipasFk", "jarKodas", "templateIdFk", "standardIdFk",
                 "laikotarpisNuo", "laikotarpisIki", "registravimoData"
             ) * FROM resolved
         ), reports AS (
             INSERT INTO "rcJar"."finansinesAtaskaitos" AS old (
                 "ataskaitosTipas", "jarKodas", "pavadinimas", "formosKodas",
                 "statusoKodas", "templateId", "standardId",
                 "laikotarpisNuo", "laikotarpisIki", "registravimoData",
                 "saltinioMetai", "formavimoData"
             )
             SELECT "ataskaitosTipasFk", "jarKodas", "pavadinimas", "formosKodas",
                    "statusoKodas", "templateIdFk", "standardIdFk",
                    "laikotarpisNuo", "laikotarpisIki", "registravimoData",
                    "saltinioMetai", "formavimoData"
             FROM report_input
             ON CONFLICT ON CONSTRAINT "finansinesAtaskaitos_natural_key"
             DO UPDATE SET
                 "pavadinimas" = EXCLUDED."pavadinimas",
                 "formosKodas" = EXCLUDED."formosKodas",
                 "statusoKodas" = EXCLUDED."statusoKodas",
                 "saltinioMetai" = EXCLUDED."saltinioMetai",
                 "formavimoData" = EXCLUDED."formavimoData",
                 "importuota" = now()
             RETURNING "id", "ataskaitosTipas", "jarKodas", "templateId",
                       "standardId", "laikotarpisNuo", "laikotarpisIki",
                       "registravimoData"
         ), indicators AS (
             SELECT DISTINCT ON (reports."id", resolved."lineTypeIdFk")
                    reports."id" AS "ataskaitaId",
                    resolved."lineTypeIdFk" AS "lineTypeId",
                    resolved."reiksme"
             FROM resolved
             JOIN reports
               ON reports."ataskaitosTipas" = resolved."ataskaitosTipasFk"
              AND reports."jarKodas" = resolved."jarKodas"
              AND reports."templateId" = resolved."templateIdFk"
              AND reports."standardId" = resolved."standardIdFk"
              AND reports."laikotarpisNuo" = resolved."laikotarpisNuo"
              AND reports."laikotarpisIki" = resolved."laikotarpisIki"
              AND reports."registravimoData" = resolved."registravimoData"
         )
         INSERT INTO "rcJar"."finansiniuAtaskaituRodikliai" AS old
             ("ataskaitaId", "lineTypeId", "reiksme")
         SELECT "ataskaitaId", "lineTypeId", "reiksme"
         FROM indicators
         ON CONFLICT ("ataskaitaId", "lineTypeId") DO UPDATE SET
             "reiksme" = EXCLUDED."reiksme"`,
        [JSON.stringify(rows)],
    );
}

const BATCH_SQL = {
    anuliavimai: `
        WITH input AS (
            SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
                "statusoKodas" integer, "templateId" text, "laikotarpisNuo" date,
                "laikotarpisIki" date, "anuliavimoRegistravimoData" date, "formavimoData" date)
        ), resolved AS (
            SELECT input."jarKodas", input."pavadinimas", input."formosKodas",
                   input."statusoKodas", template."id" AS "templateId",
                   input."laikotarpisNuo", input."laikotarpisIki",
                   input."anuliavimoRegistravimoData", input."formavimoData"
            FROM input
            JOIN "rcJar"."finansiniuAtaskaituTemplate" template
              ON template."kodas" = input."templateId"
        )
        INSERT INTO "rcJar"."finansiniuAtaskaituAnuliavimai" AS old
            ("jarKodas", "pavadinimas", "formosKodas",
             "statusoKodas", "templateId",
             "laikotarpisNuo", "laikotarpisIki", "anuliavimoRegistravimoData", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "templateId", "laikotarpisNuo", "laikotarpisIki", "anuliavimoRegistravimoData") *
        FROM resolved
        ON CONFLICT ON CONSTRAINT "finansiniuAtaskaituAnuliavimai_natural_key" DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    velavimai: `
        INSERT INTO "rcJar"."finansiniuAtaskaituVelavimai" AS old
            ("jarKodas", "pavadinimas", "formosKodas", "statusoKodas", "paskutineAtaskaitaIki", "formavimoData")
        SELECT DISTINCT ON ("jarKodas") * FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
            "statusoKodas" integer, "paskutineAtaskaitaIki" date, "formavimoData" date)
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas", "paskutineAtaskaitaIki" = EXCLUDED."paskutineAtaskaitaIki",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    nepateikimai: `
        INSERT INTO "rcJar"."finansiniuAtaskaituNepateikimai" AS old
            ("jarKodas", "nepateiktaUzMetus", "pavadinimas", "registravimoData",
             "formosKodas", "statusoKodas", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "nepateiktaUzMetus") *
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "nepateiktaUzMetus" smallint, "pavadinimas" text,
            "registravimoData" date, "formosKodas" integer, "statusoKodas" integer, "formavimoData" date)
        ON CONFLICT ("jarKodas", "nepateiktaUzMetus") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "registravimoData" = EXCLUDED."registravimoData",
            "formosKodas" = EXCLUDED."formosKodas", "statusoKodas" = EXCLUDED."statusoKodas",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    zymos: `
        INSERT INTO "rcJar"."zymuStatusai" AS old
            ("jarKodas", "zymosTipas", "pavadinimas", "formosKodas",
             "statusasNuo", "statusasIki", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "zymosTipas", "statusasNuo") *
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "zymosTipas" text, "pavadinimas" text,
            "formosKodas" integer, "statusasNuo" date, "statusasIki" date,
            "formavimoData" date)
        ON CONFLICT ON CONSTRAINT "zymuStatusai_natural_key" DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusasIki" = EXCLUDED."statusasIki",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    savanoryste: `
        INSERT INTO "rcJar"."savanoryste" AS old
            ("jarKodas", "pavadinimas", "formosKodas",
             "savanoriuSkaicius", "savanorystesValanduSkaicius", "laikotarpisNuo",
             "laikotarpisIki", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "laikotarpisNuo", "laikotarpisIki") *
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
            "savanoriuSkaicius" integer, "savanorystesValanduSkaicius" bigint,
            "laikotarpisNuo" date,
            "laikotarpisIki" date, "formavimoData" date)
        ON CONFLICT ON CONSTRAINT "savanoryste_natural_key" DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "savanoriuSkaicius" = EXCLUDED."savanoriuSkaicius",
            "savanorystesValanduSkaicius" = EXCLUDED."savanorystesValanduSkaicius",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    jangis: `
        INSERT INTO "rcJar"."jangisTeikimai" AS old
            ("jarKodas", "pavadinimas", "registravimoData", "formosKodas",
             "statusoKodas", "sarasasPateiktas", "sarasoBusena",
             "sarasoPateikimoData", "formavimoData")
        SELECT DISTINCT ON ("jarKodas") * FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "registravimoData" date,
            "formosKodas" integer, "statusoKodas" integer,
            "sarasasPateiktas" boolean, "sarasoBusena" text,
            "sarasoPateikimoData" date, "formavimoData" date)
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "registravimoData" = EXCLUDED."registravimoData",
            "formosKodas" = EXCLUDED."formosKodas", "statusoKodas" = EXCLUDED."statusoKodas",
            "sarasasPateiktas" = EXCLUDED."sarasasPateiktas", "sarasoBusena" = EXCLUDED."sarasoBusena",
            "sarasoPateikimoData" = EXCLUDED."sarasoPateikimoData", "formavimoData" = EXCLUDED."formavimoData",
            "importuota" = now()`,
    jadisSarasai: `
        INSERT INTO jadis."dalyviuSarasai" AS old
            ("jarKodas", "pavadinimas", "formosKodas", "statusoKodas",
             "registravimoData", "sarasasPateiktas", "sarasoData", "formavimoData")
        SELECT DISTINCT ON ("jarKodas") "jarKodas", "pavadinimas", "formosKodas",
               "statusoKodas", "registravimoData", "sarasasPateiktas",
               "sarasoData", "formavimoData"
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
            "statusoKodas" integer, "registravimoData" date,
            "sarasasPateiktas" boolean, "sarasoData" date, "formavimoData" date)
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas", "registravimoData" = EXCLUDED."registravimoData",
            "sarasasPateiktas" = EXCLUDED."sarasasPateiktas", "sarasoData" = EXCLUDED."sarasoData",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    jadisDalyviai: `
        INSERT INTO jadis."dalyviuSkaiciai" AS old
            ("jarKodas", "pavadinimas", "formosKodas", "statusoKodas",
             "lrFiziniai", "lrJuridiniai", "uzsienioFiziniai", "uzsienioJuridiniai",
             "formavimoData")
        SELECT DISTINCT ON ("jarKodas") "jarKodas", "pavadinimas", "formosKodas",
               "statusoKodas", "lrFiziniai", "lrJuridiniai", "uzsienioFiziniai",
               "uzsienioJuridiniai", "formavimoData"
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
            "statusoKodas" integer, "lrFiziniai" integer, "lrJuridiniai" integer,
            "uzsienioFiziniai" integer, "uzsienioJuridiniai" integer,
            "formavimoData" date)
        ON CONFLICT ("jarKodas") DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas",
            "lrFiziniai" = EXCLUDED."lrFiziniai", "lrJuridiniai" = EXCLUDED."lrJuridiniai",
            "uzsienioFiziniai" = EXCLUDED."uzsienioFiziniai",
            "uzsienioJuridiniai" = EXCLUDED."uzsienioJuridiniai",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    jadisValstybe: `
        INSERT INTO jadis."valstybesDalyviai" AS old
            ("jarKodas", "pavadinimas", "formosKodas", "statusoKodas",
             "registravimoData", "njaKodas", "njaPavadinimas", "dalis", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "njaKodas") "jarKodas", "pavadinimas",
               "formosKodas", "statusoKodas", "registravimoData", "njaKodas",
               "njaPavadinimas", "dalis", "formavimoData"
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "pavadinimas" text, "formosKodas" integer,
            "statusoKodas" integer, "registravimoData" date, "njaKodas" integer,
            "njaPavadinimas" text, "dalis" numeric, "formavimoData" date)
        ON CONFLICT ON CONSTRAINT "valstybesDalyviai_natural_key" DO UPDATE SET
            "pavadinimas" = EXCLUDED."pavadinimas", "formosKodas" = EXCLUDED."formosKodas",
            "statusoKodas" = EXCLUDED."statusoKodas", "registravimoData" = EXCLUDED."registravimoData",
            "njaPavadinimas" = EXCLUDED."njaPavadinimas", "dalis" = EXCLUDED."dalis",
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
    dokumentai: `
        INSERT INTO "rcJar"."dokumentai" AS old
            ("jarKodas", "dokumentoTipas", "dokumentoPotipis",
             "dokumentoData", "dokumentoRegistravimoData", "formavimoData")
        SELECT DISTINCT ON ("jarKodas", "dokumentoTipas", "dokumentoPotipis", "dokumentoData", "dokumentoRegistravimoData") *
        FROM jsonb_to_recordset($1::jsonb) AS x(
            "jarKodas" integer, "dokumentoTipas" integer, "dokumentoPotipis" integer,
            "dokumentoData" date, "dokumentoRegistravimoData" date,
            "formavimoData" date)
        ON CONFLICT ON CONSTRAINT "dokumentai_natural_key" DO UPDATE SET
            "formavimoData" = EXCLUDED."formavimoData", "importuota" = now()`,
};

async function upsertDictionaries(client, rows) {
    await client.query(
        `WITH input AS (
             SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(
                 "formosKodas" integer, "formosPavadinimas" text,
                 "statusoKodas" integer, "statusoPavadinimas" text,
                 "templateId" text, "templateName" text,
                 "standardId" text, "standardName" text,
                 "lineTypeId" text, "lineName" text,
                 "sarasoBusena" text, "dokumentoTipas" integer,
                 "dokumentoPotipis" integer, "dokumentoPotipioPavadinimas" text
             )
         ), forms AS (
             INSERT INTO "rcJar"."formos" ("_id", "_revision", "kodas", "pavadinimas")
             SELECT gen_random_uuid(), gen_random_uuid(), "formosKodas", max("formosPavadinimas")
             FROM input
             WHERE "formosKodas" IS NOT NULL AND "formosPavadinimas" IS NOT NULL
             GROUP BY "formosKodas"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), statuses AS (
             INSERT INTO "rcJar"."statusai" ("kodas", "pavadinimas")
             SELECT "statusoKodas", max("statusoPavadinimas") FROM input
             WHERE "statusoKodas" IS NOT NULL AND "statusoPavadinimas" IS NOT NULL
             GROUP BY "statusoKodas"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), templates AS (
             INSERT INTO "rcJar"."finansiniuAtaskaituTemplate" ("kodas", "pavadinimas")
             SELECT "templateId", COALESCE(max("templateName"), "templateId") FROM input
             WHERE "templateId" IS NOT NULL
             GROUP BY "templateId"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), standards AS (
             INSERT INTO "rcJar"."finansiniuAtaskaituStandartai" ("kodas", "pavadinimas")
             SELECT "standardId", COALESCE(max("standardName"), "standardId") FROM input
             WHERE "standardId" IS NOT NULL
             GROUP BY "standardId"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), lines AS (
             INSERT INTO "rcJar"."finansiniuAtaskaituRodikliuTipai" ("kodas", "pavadinimas")
             SELECT "lineTypeId", COALESCE(max("lineName"), "lineTypeId") FROM input
             WHERE "lineTypeId" IS NOT NULL
             GROUP BY "lineTypeId"
             ON CONFLICT ("kodas") DO UPDATE SET "pavadinimas" = EXCLUDED."pavadinimas"
         ), jangis_statuses AS (
             INSERT INTO "rcJar"."jangisBusenos" ("kodas", "pavadinimas")
             SELECT "sarasoBusena", initcap(lower("sarasoBusena")) FROM input
             WHERE "sarasoBusena" IS NOT NULL
             GROUP BY "sarasoBusena"
             ON CONFLICT ("kodas") DO NOTHING
         ), document_subtypes AS (
             INSERT INTO "rcJar"."dokumentuPotipiai"
                 ("dokumentoTipas", "dokumentoPotipis", "pavadinimas")
             SELECT "dokumentoTipas", "dokumentoPotipis",
                    max("dokumentoPotipioPavadinimas")
             FROM input
             WHERE "dokumentoTipas" IS NOT NULL
               AND "dokumentoPotipis" IS NOT NULL
               AND "dokumentoPotipioPavadinimas" IS NOT NULL
             GROUP BY "dokumentoTipas", "dokumentoPotipis"
             ON CONFLICT ("dokumentoTipas", "dokumentoPotipis") DO UPDATE
             SET "pavadinimas" = EXCLUDED."pavadinimas"
         )
         SELECT 1`,
        [JSON.stringify(rows)],
    );
}

export async function writeBatch(client, source, rows) {
    await upsertDictionaries(client, rows);
    if (source.kind === "finansai") return writeFinancialBatch(client, rows);
    const sql = BATCH_SQL[source.kind];
    if (!sql) throw new Error(`Nežinomas RC rinkinys: ${source.kind}`);
    await client.query(sql, [JSON.stringify(rows)]);
}

