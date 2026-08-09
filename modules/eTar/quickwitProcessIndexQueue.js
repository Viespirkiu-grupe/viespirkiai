import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";
import { drainIndexQueue, runShardedDrain } from "../../quickwit/indexQueueDrainer.js";
import { Logger } from "../../utils/log.js";
import { foldLithuanian } from "../../utils/text.js";
import { toRfc3339 } from "../../utils/time.js";
import { openETarSidecar, readResponse } from "./eTarSidecar.js";

// `eTarIndexQueue` → Quickwit. Karkasas (tranzakcija, dedup, shard'inimas,
// quickwitEilutes žemėlapis) gyvena quickwit/indexQueueDrainer.js — čia tik tai,
// kas specifiška: SELECT, sidecar skaitymas ir dokumento sudėliojimas.
//
// Eilę pildo modules/eTar/eTarStore.js toje pačioje tranzakcijoje kaip duomenis
// (ne trigger'iu), tad čia matom tik realiai pasikeitusius dokumentus.

const logger = new Logger();
const LENTELE = "eTar";
const BATCH_SIZE = 1000;
const SHARD_SIZE = 1_000_000;
const INDEX_CONFIG_URL = new URL("./quickwitIndexConfig.yaml", import.meta.url);

let configRegistered = false;

export async function ensureETarQuickwitConfig() {
    if (configRegistered) return;
    const indexConfig = await fs.readFile(INDEX_CONFIG_URL, "utf8");
    await postgres.query(
        `INSERT INTO public."quickwitLenteles"
            ("lentele", "defaultShardSize", "indexConfig")
         VALUES ($1, $2, $3)
         ON CONFLICT ("lentele") DO UPDATE SET
            "defaultShardSize" = EXCLUDED."defaultShardSize",
            "indexConfig" = EXCLUDED."indexConfig"
         WHERE ROW(
            "quickwitLenteles"."defaultShardSize",
            "quickwitLenteles"."indexConfig"
         ) IS DISTINCT FROM ROW(
            EXCLUDED."defaultShardSize",
            EXCLUDED."indexConfig"
         )`,
        [LENTELE, SHARD_SIZE, indexConfig],
    );
    configRegistered = true;
}

// Sidecar'as atidaromas kartą procesui (readonly → keli darbininkai lygiagrečiai).
let sidecar = null;
function getSidecar() {
    if (!sidecar) sidecar = openETarSidecar({ readonly: true });
    return sidecar;
}

/**
 * Nusausina vieną `eTarIndexQueue` porciją į Quickwit.
 * @param {{ shard?: number, shardCount?: number }} [opts]
 * @returns {Promise<boolean>} `true`, jei buvo apdorota eilučių.
 */
export async function processETarIndexQueue(opts = {}) {
    await ensureETarQuickwitConfig();
    return drainIndexQueue(
        {
            lentele: LENTELE,
            queueTable: "eTarIndexQueue",
            keyColumn: "documentId",
            batchSize: BATCH_SIZE,
            commit: "auto",
            rowId: (row) => row.documentId,
            buildDoc: (row) => buildDoc(row, row.md5 ? readResponse(getSidecar(), row.md5) : null),
            fetchRows: async (client, ids) => {
                const { rows } = await client.query(
                    `SELECT
                        d."documentId", d."legalActId", d."md5", d."sourceUrl",
                        d."title", d."editionToken",
                        v."code"  AS "variantas",
                        p."code"  AS "turinioBusena",
                        (SELECT count(*) FROM "eTarEdition" e WHERE e."legalActId" = d."legalActId")
                            AS "redakcijuSkaicius"
                     FROM "eTarLegalActDocument" d
                     JOIN "eTarDocumentVariant" v USING ("documentVariantId")
                     JOIN "eTarPresenceState"  p ON p."presenceStateId" = d."contentPresenceId"
                     WHERE d."documentId" = ANY($1::bigint[])`,
                    [ids],
                );
                return rows;
            },
            logger,
        },
        opts,
    );
}

/** „Nėra" e-TAR informacinėje lentelėje reiškia tuščią reikšmę, ne turinį. */
function value(field) {
    const raw = field?.value;
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    return trimmed === "" || trimmed === "Nėra" ? null : trimmed;
}

/** e-TAR duomenų pradžia — dugnas dokumentams be jokios datos. */
const ETAR_EPOCH = "2013-01-01T00:00:00Z";

/** Data „yyyy-mm-dd" → RFC3339 vidurnaktis UTC. */
function toDate(value) {
    return value ? toRfc3339(`${value}T00:00:00Z`) : null;
}

export function buildDoc(row, payload) {
    // Postgres eilutė duoda tapatybę ir filtrus, sidecar — turinį. Sidecar'o
    // nebuvimas neturi blokuoti indeksavimo: dokumentas vis tiek randamas pagal
    // pavadinimą ir metaduomenis, tik be pilno teksto.
    const metadata = payload?.metadata ?? {};
    const fields = metadata.fields ?? {};
    const registration = fields.registration_details?.value ?? {};

    const susijeAktai = new Set();
    const rysiuTipai = new Set();
    const priedai = [];
    for (const section of Object.values(payload?.related_information ?? {})) {
        for (const item of section?.items ?? []) {
            if (item.kind === "attachment") {
                priedai.push(item.attachment_name ?? item.filename);
            } else {
                if (item.legal_act_id) susijeAktai.add(item.legal_act_id);
                if (item.relation_type) rysiuTipai.add(item.relation_type);
            }
        }
    }

    const priemimoData = toDate(value(fields.adopted_at));
    const registracijosData = toDate(registration.date);

    return {
        documentId: Number(row.documentId),
        legalActId: row.legalActId,
        variantas: row.variantas,
        redakcijosTokenas: row.editionToken,
        md5: row.md5,
        url: row.sourceUrl,

        pavadinimas: row.title,
        // foldLithuanian — kaip kituose indeksuose: paieška be diakritikų.
        tekstas: payload?.official_text?.text ? foldLithuanian(payload.official_text.text) : null,
        turinioBusena: row.turinioBusena,

        aktoRusis: value(fields.act_type),
        statusas: metadata.status ?? null,
        prieme: value(fields.adopted_by),
        istaigosNr: value(fields.institution_number),
        registracijosNr: registration.number ?? null,
        eli: value(fields.eli),
        publikuota: value(fields.published),
        eurovoc: fields.eurovoc_terms?.value ?? [],

        susijeAktai: [...susijeAktai],
        rysiuTipai: [...rysiuTipai],
        priedai,
        prieduSkaicius: priedai.length,
        redakcijuSkaicius: Number(row.redakcijuSkaicius ?? 0),

        // timestamp_field negali būti null. Grandinė sudėliota taip, kad reikšmė
        // būtų STABILI tarp perindeksavimų — `fetchedAt` čia sąmoningai nedalyvauja,
        // kitaip kiekvienas pakartotinis indeksavimas duotų kitą reikšmę. Jei akto
        // datų nėra visai, imam e-TAR pradžią (2013-01-01) kaip neutralų dugną.
        priemimoData: priemimoData ?? registracijosData ?? toDate(metadata.effective_from) ?? ETAR_EPOCH,
        registracijosData,
        isigaliojoNuo: toDate(metadata.effective_from),
        galiojaIki: toDate(metadata.effective_to),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    await runShardedDrain({
        work: processETarIndexQueue,
        label: "eTar",
        logger,
    });
    await postgres.end();
    process.exit(0);
}
