import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("viesiejiPirkimai", { operation: "viesiejiPirkimaiVykdytojaiScrape" });
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import { isVptWorkingHours } from "../sutartys/isWorkingHours.js";
import { log } from "../../utils/log.js";
import { findSingleJuridinis } from "../juridiniai/search.js";
import config from "../../utils/config.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";

const HOST = config.viesiejiPirkimaiUrl;
const NUSKAITYMO_VERSIJA = 9;
const NUSKAITYMO_INTERVAL = "7 days";

/**
 * Parses an organisation page into a flat object.
 * @param {string} html
 * @returns {Record<string, string | null> | null}
 */
function parseOrganisation(html) {
    const { document } = parseHTML(html);
    const dl = document.querySelector("dl.row");
    if (!dl) return null;

    const map = {
        "organizacijos pavadinimas": "pavadinimas",
        "organizacijos pavadinimo trumpinys": "trumpinys",
        "pirkimo vykdytojo tipas": "tipas",
        adresas: "adresas",
        "pašto kodas": "pastoKodas",
        miestas: "miestas",
        valstybė: "valstybe",
        "el. paštas": "elPastas",
        "telefono numeris": "telefonas",
        faksas: "faksas",
        svetainė: "svetaine",
    };

    const result = {};
    const dts = dl.querySelectorAll("dt");
    const dds = dl.querySelectorAll("dd");

    for (let i = 0; i < dts.length; i++) {
        const label = dts[i].textContent.trim().replace(/:$/, "").toLowerCase();
        const value = dds[i].textContent.trim() || null;
        const key = map[label];
        if (key) result[key] = value;
    }

    return result;
}

/**
 * Fetches and updates a single organisation record.
 * @param {{ id: string }} org
 * @returns {Promise<void>}
 */
async function processOrganisation(org) {
    try {
        const url = `${HOST}/epps/prepareViewCAOrganisation.do?id=${org.id}`;
        const response = await scrapeFetch(url);
        const html = await response.text();

        const data = parseOrganisation(html);
        if (!data) {
            log(`Nepavyko nuskaityti organizacijos ID ${org.id}`);
            await postgres.query(
                `
                UPDATE "eppsViesiejiPirkimai"."vykdytojai"
                SET "nuskaitymoData"    = NOW(),
                    "nuskaitymoVersija" = ${NUSKAITYMO_VERSIJA}
                WHERE id = $1
                `,
                [org.id],
            );
            return;
        }

        if (data.pavadinimas) {
            data.pavadinimas = data.pavadinimas
                .replace(/\s*\(?\s*pv\s*\)?\s*$/i, "")
                .trim();
        }

        const juridinis = data.pavadinimas
            ? await findSingleJuridinis(data.pavadinimas)
            : null;

        await postgres.query(
            `
            UPDATE "eppsViesiejiPirkimai"."vykdytojai"
            SET pavadinimas         = $2,
                trumpinys           = $3,
                tipas               = $4,
                adresas             = $5,
                "pastoKodas"        = $6,
                miestas             = $7,
                valstybe            = $8,
                "elPastas"          = $9,
                telefonas           = $10,
                faksas              = $11,
                svetaine            = $12,
                "jarKodas"          = $13,
                "nuskaitymoData"    = NOW(),
                "nuskaitymoVersija" = ${NUSKAITYMO_VERSIJA}
            WHERE id = $1
            `,
            [
                org.id,
                data.pavadinimas ?? null,
                data.trumpinys ?? null,
                data.tipas ?? null,
                data.adresas ?? null,
                data.pastoKodas ?? null,
                data.miestas ?? null,
                data.valstybe ?? null,
                data.elPastas ?? null,
                data.telefonas ?? null,
                data.faksas ?? null,
                data.svetaine ?? null,
                juridinis?.jarKodas ?? null,
            ],
        );

        const updated = await postgres.query(
            `
            UPDATE "eppsViesiejiPirkimai"."pirkimai"
            SET "jarKodas" = $1
            WHERE "pirkimoVykdytojasId" = $2
            `,
            [juridinis?.jarKodas ?? null, org.id],
        );
        if (updated.rowCount > 0) {
            signalWork(WORK_SIGNALS.VIESIEJI_PIRKIMAI_CHANGED, {
                source: "eppsViesiejiPirkimai.vykdytojai",
                count: updated.rowCount,
            });
        }

        log(
            `Nuskaitytas vykdytojas ID ${org.id}: ${data.pavadinimas} t.y. ${juridinis?.pavadinimas} (${juridinis?.jarKodas})`,
        );
    } catch (error) {
        log(`Klaida nuskaitant vykdytoją ID ${org.id}: ${error.message}`);
    }
}

/**
 * Reserves and returns the next organisation to process.
 * @returns {Promise<object | null>}
 */
async function getNextVykdytojas() {
    const { rows } = await postgres.query(
        `
        WITH candidate AS (
            SELECT id
            FROM "eppsViesiejiPirkimai"."vykdytojai"
            WHERE "nuskaitymoVersija" IS NULL
               OR "nuskaitymoVersija" < ${NUSKAITYMO_VERSIJA}
               OR "nuskaitymoData" <= NOW() - interval '${NUSKAITYMO_INTERVAL}'
            ORDER BY "nuskaitymoData" ASC NULLS FIRST
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        )
        UPDATE "eppsViesiejiPirkimai"."vykdytojai"
        SET "nuskaitymoData" = NOW()
        FROM candidate
        WHERE "eppsViesiejiPirkimai"."vykdytojai".id = candidate.id
        RETURNING "eppsViesiejiPirkimai"."vykdytojai".*;
        `,
    );
    return rows[0] ?? null;
}

/**
 * Processes the next organisation regardless of working hours.
 * @returns {Promise<boolean>}
 */
export async function processNextVykdytojas() {
    const org = await getNextVykdytojas();
    if (!org) return false;
    await processOrganisation(org);
    return true;
}

/**
 * Processes the next organisation only outside VPT working hours.
 * @returns {Promise<boolean>}
 */
export async function processNextVykdytojasOffHours() {
    if (isVptWorkingHours()) return false;
    return processNextVykdytojas();
}

const WORKERS = 8;

if (import.meta.url === `file://${process.argv[1]}`) {
    try {
        await Promise.all(
            Array.from({ length: WORKERS }, async () => {
                while (await processNextVykdytojas()) {}
            }),
        );
    } finally {
        await postgres.end();
    }
}
