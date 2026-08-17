import { postgres } from "../../postgres/postgres.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
import { upsertDictionaries } from "./backfill.js";

export async function syncJuridiniaiDictionaries(db = postgres, source = "juridiniai-dictionaries") {
    await upsertDictionaries(db);
    signalWork(WORK_SIGNALS.JURIDINIAI_INDEX_READY, { source });
}
