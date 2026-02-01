// importAtviriDuomenysImp.js
import path from "node:path";
import { parseCSV } from "../../utils/csv.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BATCH_SIZE = 1000;

function normalizeRow(row) {
    return {
        dokId: row["﻿DOK_ID"] ? BigInt(row["﻿DOK_ID"]) : null,
        dokSysRegData: row.DOK_SYS_REG_DATA || null,
        dokSutNumeris: row.DOK_SUT_NUMERIS || null,
        dokPirkNumeris: row.DOK_PIRK_NUMERIS || null,
        dokSutObjPav: row.DOK_SUT_OBJ_PAV || null,
        dokSutObjRusis: row.DOK_SUT_OBJ_RUSIS || null,
        mcpvKodas: row.MCPV_KODAS || null,
        mcpvPav: row.MCPV_PAV || null,
        pvKodas: row.PV_KODAS || null,
        pvPav: row.PV_PAV || null,
        tiekKodas: row.TIEK_KODAS || null,
        tiekPav: row.TIEK_PAV || null,
        tiekSbjPatikslinimas: row.TIEK_SBJ_PATIKSLINIMAS || null,
        tiekSalis: row.TIEK_SALIS === "NULL" ? null : row.TIEK_SALIS,
        dokSutVerte:
            row.DOK_SUT_VERTE === "NULL" ? null : String(row.DOK_SUT_VERTE),
        dokSudarymoData: row.DOK_SUDARYMO_DATA || null,
        dokSutGaliojimoData: row.DOK_SUT_GALIOJIMO_DATA || null,
        dokSutTipas: row.DOK_SUT_TIPAS ? Number(row.DOK_SUT_TIPAS) : null,
        dokFormosTipas: row.DOK_FORMOS_TIPAS
            ? Number(row.DOK_FORMOS_TIPAS)
            : null,
        dokFaktSutIvykVerte:
            row.DOK_FAKT_SUT_IVYK_VERTE === "NULL"
                ? null
                : Number(row.DOK_FAKT_SUT_IVYK_VERTE),
        dokFaktSutIvykData: row.DOK_FAKT_SUT_IVYK_DATA || null,
    };
}

let inserted = 0;

async function insertBatch(batch) {
    if (batch.length === 0) return;

    const values = [];
    const placeholders = batch
        .map((row, i) => {
            const offset = i * 21;
            values.push(
                row.dokId,
                row.dokSysRegData,
                row.dokSutNumeris,
                row.dokPirkNumeris,
                row.dokSutObjPav,
                row.dokSutObjRusis,
                row.mcpvKodas,
                row.mcpvPav,
                row.pvKodas,
                row.pvPav,
                row.tiekKodas,
                row.tiekPav,
                row.tiekSbjPatikslinimas,
                row.tiekSalis,
                row.dokSutVerte,
                row.dokSudarymoData,
                row.dokSutGaliojimoData,
                row.dokSutTipas,
                row.dokFormosTipas,
                row.dokFaktSutIvykVerte,
                row.dokFaktSutIvykData,
            );
            const params = Array.from(
                { length: 21 },
                (_, j) => `$${offset + j + 1}`,
            );
            return `(${params.join(",")})`;
        })
        .join(",");

    const sql = `
        INSERT INTO public."sutartysAtviriDuomenysImp" (
            "dokId","dokSysRegData","dokSutNumeris","dokPirkNumeris","dokSutObjPav",
            "dokSutObjRusis","mcpvKodas","mcpvPav","pvKodas","pvPav",
            "tiekKodas","tiekPav","tiekSbjPatikslinimas","tiekSalis",
            "dokSutVerte","dokSudarymoData","dokSutGaliojimoData","dokSutTipas",
            "dokFormosTipas","dokFaktSutIvykVerte","dokFaktSutIvykData"
        )
        VALUES ${placeholders}
        ON CONFLICT ("dokId") DO UPDATE SET
            "dokSysRegData" = EXCLUDED."dokSysRegData",
            "dokSutNumeris" = EXCLUDED."dokSutNumeris",
            "dokPirkNumeris" = EXCLUDED."dokPirkNumeris",
            "dokSutObjPav" = EXCLUDED."dokSutObjPav",
            "dokSutObjRusis" = EXCLUDED."dokSutObjRusis",
            "mcpvKodas" = EXCLUDED."mcpvKodas",
            "mcpvPav" = EXCLUDED."mcpvPav",
            "pvKodas" = EXCLUDED."pvKodas",
            "pvPav" = EXCLUDED."pvPav",
            "tiekKodas" = EXCLUDED."tiekKodas",
            "tiekPav" = EXCLUDED."tiekPav",
            "tiekSbjPatikslinimas" = EXCLUDED."tiekSbjPatikslinimas",
            "tiekSalis" = EXCLUDED."tiekSalis",
            "dokSutVerte" = EXCLUDED."dokSutVerte",
            "dokSudarymoData" = EXCLUDED."dokSudarymoData",
            "dokSutGaliojimoData" = EXCLUDED."dokSutGaliojimoData",
            "dokSutTipas" = EXCLUDED."dokSutTipas",
            "dokFormosTipas" = EXCLUDED."dokFormosTipas",
            "dokFaktSutIvykVerte" = EXCLUDED."dokFaktSutIvykVerte",
            "dokFaktSutIvykData" = EXCLUDED."dokFaktSutIvykData"
    `;

    inserted += batch.length;
    log(`Inserted/Updated: ${inserted}`);

    await postgres.query(sql, values);
}

if (process.argv[1] === path.resolve(process.argv[1])) {
    const file = process.argv[2];
    if (!file) {
        console.error("Usage: node importAtviriDuomenysImp.js <file.csv>");
        process.exit(1);
    }

    const batch = [];
    for await (const row of parseCSV(file)) {
        batch.push(normalizeRow(row));
        if (batch.length >= BATCH_SIZE) {
            await insertBatch(batch.splice(0, BATCH_SIZE));
        }
    }

    if (batch.length > 0) {
        await insertBatch(batch);
    }

    console.log("Import finished.");
}
