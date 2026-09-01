import path from "node:path";
import { parseCSV } from "../../utils/csv.js";
import { log } from "../../utils/log.js";
import { irasytiAtvirusDuomenisImp, tuscia } from "./atviriDuomenysIrasymas.js";

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
        tiekSalis: tuscia(row.TIEK_SALIS === "NULL" ? null : row.TIEK_SALIS),
        verte: row.DOK_SUT_VERTE === "NULL" ? null : tuscia(String(row.DOK_SUT_VERTE)),
        dokSudarymoData: row.DOK_SUDARYMO_DATA || null,
        dokSutGaliojimoData: row.DOK_SUT_GALIOJIMO_DATA || null,
        dokSutTipas: row.DOK_SUT_TIPAS ? Number(row.DOK_SUT_TIPAS) : null,
        dokFormosTipas: row.DOK_FORMOS_TIPAS
            ? Number(row.DOK_FORMOS_TIPAS)
            : null,
        faktineVerte:
            row.DOK_FAKT_SUT_IVYK_VERTE === "NULL"
                ? null
                : tuscia(String(row.DOK_FAKT_SUT_IVYK_VERTE)),
        dokFaktSutIvykData: row.DOK_FAKT_SUT_IVYK_DATA || null,
    };
}

let inserted = 0;

async function insertBatch(batch) {
    if (batch.length === 0) return;

    await irasytiAtvirusDuomenisImp(batch);
    inserted += batch.length;
    log(`Inserted/Updated: ${inserted}`);
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

    log("Import finished.");
}
