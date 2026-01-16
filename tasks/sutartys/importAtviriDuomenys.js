// importAtviriDuomenys.js
import path from "node:path";
import { parseCSV } from "../../utils/csv.js";
import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

const BATCH_SIZE = 1000;

function normalizeRow(row) {
    return {
        dokId:
            row["DOK_ID"] && /^\d+$/.test(row["DOK_ID"])
                ? BigInt(row["DOK_ID"])
                : null,
        dokRegNr: row.DOK_REG_NR || null,
        dokSysRegData: row.DOK_SYS_REG_DATA || null,
        dokSutNumeris: row.DOK_SUT_NUMERIS || null,
        pkPirkimoKodas: row.PK_PIRKIMO_KODAS || null,
        pirkVykdomasCvpIs: row.PIRK_VYKDOMAS_CVP_IS || null,
        dokPirkimoNumeris: row.DOK_PIRKIMO_NUMERIS || null,
        dokPirkimoBudas: row.DOK_PIRKIMO_BUDAS || null,
        pirkPreliminary: row.PIRK_PRELIMINARY || null,
        dokSutObjPav: row.DOK_SUT_OBJ_PAV || null,
        dokSutObjRusis: row.DOK_SUT_OBJ_RUSIS || null,
        mcpvKodas: row.MCPV_KODAS || null,
        mcpvPav: row.MCPV_PAV || null,
        pvKodas: row.PV_KODAS || null,
        pvPav: row.PV_PAV || null,
        tiekKodas: row.TIEK_KODAS || null,
        tiekPav: row.TIEK_PAV || null,
        tiekPavPatikslinimas: row.TIEK_PAV_PATIKSLINIMAS || null,
        tiekSalis: row.TIEK_SALIS === "NULL" ? null : row.TIEK_SALIS,
        dokSutVerte:
            row.DOK_SUT_VERTE === "NULL" ? null : String(row.DOK_SUT_VERTE),
        dokSudarymoData: row.DOK_SUDARYMO_DATA || null,
        dokSutGaliojimoData: row.DOK_SUT_GALIOJIMO_DATA || null,
        dokSutTipas: row.DOK_SUT_TIPAS ? Number(row.DOK_SUT_TIPAS) : null,
        dokFormosTipas: row.DOK_FORMOS_TIPAS
            ? Number(row.DOK_FORMOS_TIPAS)
            : null,
        ppsZodSut: row.PPS_ZOD_SUT ? Number(row.PPS_ZOD_SUT) : null,
        dokFaktSutIvykVerte:
            row.DOK_FAKT_SUT_IVYK_VERTE === "NULL" ||
            row.DOK_FAKT_SUT_IVYK_VERTE === ""
                ? null
                : String(row.DOK_FAKT_SUT_IVYK_VERTE),
        dokFaktSutIvykData: row.DOK_FAKT_SUT_IVYK_DATA || null,
        pirkSusijesSuTiriamaSituacija:
            row.PIRK_SUSIJES_SU_TIRIAMA_SITUACIJA || null,
        situacijaTipas1: row.SITUACIJA_TIPAS_1 || null,
        situacijaTipas2: row.SITUACIJA_TIPAS_2 || null,
        situacijaTipas3: row.SITUACIJA_TIPAS_3 || null,
        dokArTaikomi: row.DOK_AR_TAIKOMI === "1",
        dokArNotNeededReason: row.DOK_AR_NOT_NEEDED_REASON === "1",
    };
}

let inserted = 0;

async function insertBatch(batch) {
    if (!batch.length) return;

    // Deduplicate by dokId, keep last occurrence
    batch = Array.from(
        new Map(
            batch
                .filter((r) => r.dokId != null)
                .map((r) => [r.dokId.toString(), r]),
        ).values(),
    );

    const values = [];
    const placeholders = batch
        .map((row, i) => {
            const offset = i * 33;
            values.push(
                row.dokId,
                row.dokRegNr,
                row.dokSysRegData,
                row.dokSutNumeris,
                row.pkPirkimoKodas,
                row.pirkVykdomasCvpIs,
                row.dokPirkimoNumeris,
                row.dokPirkimoBudas,
                row.pirkPreliminary,
                row.dokSutObjPav,
                row.dokSutObjRusis,
                row.mcpvKodas,
                row.mcpvPav,
                row.pvKodas,
                row.pvPav,
                row.tiekKodas,
                row.tiekPav,
                row.tiekPavPatikslinimas,
                row.tiekSalis,
                row.dokSutVerte,
                row.dokSudarymoData,
                row.dokSutGaliojimoData,
                row.dokSutTipas,
                row.dokFormosTipas,
                row.ppsZodSut,
                row.dokFaktSutIvykVerte,
                row.dokFaktSutIvykData,
                row.pirkSusijesSuTiriamaSituacija,
                row.situacijaTipas1,
                row.situacijaTipas2,
                row.situacijaTipas3,
                row.dokArTaikomi,
                row.dokArNotNeededReason,
            );
            const params = Array.from(
                { length: 33 },
                (_, j) => `$${offset + j + 1}`,
            );
            return `(${params.join(",")})`;
        })
        .join(",");

    const sql = `
        INSERT INTO public."sutartysAtviriDuomenys" (
            "dokId","dokRegNr","dokSysRegData","dokSutNumeris",
            "pkPirkimoKodas","pirkVykdomasCvpIs","dokPirkimoNumeris",
            "dokPirkimoBudas","pirkPreliminary","dokSutObjPav",
            "dokSutObjRusis","mcpvKodas","mcpvPav","pvKodas","pvPav",
            "tiekKodas","tiekPav","tiekPavPatikslinimas","tiekSalis",
            "dokSutVerte","dokSudarymoData","dokSutGaliojimoData",
            "dokSutTipas","dokFormosTipas","ppsZodSut",
            "dokFaktSutIvykVerte","dokFaktSutIvykData",
            "pirkSusijesSuTiriamaSituacija","situacijaTipas1",
            "situacijaTipas2","situacijaTipas3","dokArTaikomi",
            "dokArNotNeededReason"
        )
        VALUES ${placeholders}
        ON CONFLICT ("dokId") DO UPDATE SET
            "dokRegNr" = EXCLUDED."dokRegNr",
            "dokSysRegData" = EXCLUDED."dokSysRegData",
            "dokSutNumeris" = EXCLUDED."dokSutNumeris",
            "pkPirkimoKodas" = EXCLUDED."pkPirkimoKodas",
            "pirkVykdomasCvpIs" = EXCLUDED."pirkVykdomasCvpIs",
            "dokPirkimoNumeris" = EXCLUDED."dokPirkimoNumeris",
            "dokPirkimoBudas" = EXCLUDED."dokPirkimoBudas",
            "pirkPreliminary" = EXCLUDED."pirkPreliminary",
            "dokSutObjPav" = EXCLUDED."dokSutObjPav",
            "dokSutObjRusis" = EXCLUDED."dokSutObjRusis",
            "mcpvKodas" = EXCLUDED."mcpvKodas",
            "mcpvPav" = EXCLUDED."mcpvPav",
            "pvKodas" = EXCLUDED."pvKodas",
            "pvPav" = EXCLUDED."pvPav",
            "tiekKodas" = EXCLUDED."tiekKodas",
            "tiekPav" = EXCLUDED."tiekPav",
            "tiekPavPatikslinimas" = EXCLUDED."tiekPavPatikslinimas",
            "tiekSalis" = EXCLUDED."tiekSalis",
            "dokSutVerte" = EXCLUDED."dokSutVerte",
            "dokSudarymoData" = EXCLUDED."dokSudarymoData",
            "dokSutGaliojimoData" = EXCLUDED."dokSutGaliojimoData",
            "dokSutTipas" = EXCLUDED."dokSutTipas",
            "dokFormosTipas" = EXCLUDED."dokFormosTipas",
            "ppsZodSut" = EXCLUDED."ppsZodSut",
            "dokFaktSutIvykVerte" = EXCLUDED."dokFaktSutIvykVerte",
            "dokFaktSutIvykData" = EXCLUDED."dokFaktSutIvykData",
            "pirkSusijesSuTiriamaSituacija" = EXCLUDED."pirkSusijesSuTiriamaSituacija",
            "situacijaTipas1" = EXCLUDED."situacijaTipas1",
            "situacijaTipas2" = EXCLUDED."situacijaTipas2",
            "situacijaTipas3" = EXCLUDED."situacijaTipas3",
            "dokArTaikomi" = EXCLUDED."dokArTaikomi",
            "dokArNotNeededReason" = EXCLUDED."dokArNotNeededReason"
    `;

    inserted += batch.length;
    log(`Inserted/Updated: ${inserted}`);

    await postgres.query(sql, values);
}

if (process.argv[1] === path.resolve(process.argv[1])) {
    const file = process.argv[2];
    if (!file) {
        console.error("Usage: node importAtviriDuomenys.js <file.csv>");
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
