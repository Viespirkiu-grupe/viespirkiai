import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

export async function enqueueAddressLinkedJuridiniai(db, source) {
    const result = await db.query(
        `INSERT INTO public."juridiniaiRefreshQueue" ("jarKodas", "saltiniai")
         SELECT DISTINCT "jarKodas", ARRAY[$1::text]
         FROM "rcJar"."asmenuAdresai"
         ON CONFLICT ("jarKodas") DO UPDATE SET
            "saltiniai" = ARRAY(
                SELECT DISTINCT value
                FROM unnest(
                    public."juridiniaiRefreshQueue"."saltiniai" ||
                    EXCLUDED."saltiniai"
                ) value ORDER BY value
            ),
            "atnaujinta" = now()`,
        [source],
    );
    if (result.rowCount > 0) {
        signalWork(WORK_SIGNALS.JURIDINIAI_REFRESH_READY, {
            source,
            count: result.rowCount,
        });
    }
    return result.rowCount;
}
