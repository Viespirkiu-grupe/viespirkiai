import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("cvpp", { operation: "scrapeNotice" });
import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import {
    irasytiFailus,
    skaidytiSaltinioId,
    sujungtiSaltinioId,
} from "../failai/failuIrasymas.js";
import { Logger } from "../../utils/log.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
const logger = new Logger();

const NUSKAITYMO_VERSIJA = 2;
const KLAIDOS_BUSENA = -1;
const VPT_BUSENA = -69;
const CVPP_LINK_SELECTOR = 'a[href^="javascript:DownloadPublicDocument("]';
const CVPP_DOWNLOAD_RE = /DownloadPublicDocument\('(\w+)','(\w+)','(\w+)'\)/;

async function setNoticeStatus(skelbimoKodas, status) {
    await postgres.query(
        `UPDATE "cvppViesiejiPirkimai" SET nuskaitymas = $1 WHERE "skelbimoKodas" = $2;`,
        [status, skelbimoKodas],
    );
}

async function fetchHtmlWithCookies(url) {
    let firstRes = await scrapeFetch(url, { redirect: "manual" });
    const cookies =
        firstRes.headers.getSetCookie?.() ??
        (firstRes.headers.get("set-cookie")
            ? [firstRes.headers.get("set-cookie")]
            : []);
    const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

    firstRes = await scrapeFetch(url, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });

    if (!firstRes.ok) {
        throw new Error(
            `Nepavyko gauti CVPP dokumentų puslapio: ${firstRes.status}`,
        );
    }

    return firstRes.text();
}

function getCvppPidFromDocsLink(dokumentaiLink) {
    try {
        const pid = new URL(String(dokumentaiLink)).searchParams.get("PID");
        return pid ? String(pid).trim() : null;
    } catch {
        return null;
    }
}

function extractCvppFiles(document, pid) {
    let invalidLinkCount = 0;

    const files = [...document.querySelectorAll(CVPP_LINK_SELECTOR)]
        .map((a) => {
            const match = a.href.match(CVPP_DOWNLOAD_RE);
            if (!match) {
                invalidLinkCount += 1;
                return null;
            }

            const [, dvid, , lid] = match;
            const oldSaltinioId = `${dvid}/${lid}`;
            const saltinioId = pid ? `${pid}/${oldSaltinioId}` : oldSaltinioId;
            const pavadinimas = a.textContent.trim();
            const extMatch = pavadinimas.match(/\.([^.]+)$/);
            const extension = extMatch ? extMatch[1].toLowerCase() : "";

            return {
                saltinis: "cvpp",
                saltinioId,
                oldSaltinioId,
                pavadinimas,
                extension,
            };
        })
        .filter(Boolean);

    // Keep one entry per legacy ID so repeated links on the page do not create churn.
    const map = new Map();
    for (const file of files) {
        if (file.oldSaltinioId) map.set(file.oldSaltinioId, file);
    }

    return {
        merged: Array.from(map.values()),
        invalidLinkCount,
    };
}

function buildIdsToCheck(files) {
    return Array.from(
        new Set(
            files.flatMap((f) =>
                f.oldSaltinioId === f.saltinioId
                    ? [f.saltinioId]
                    : [f.oldSaltinioId, f.saltinioId],
            ),
        ),
    );
}

async function getExistingCvppIdSet(idsToCheck) {
    if (!idsToCheck.length) return new Set();

    // `files` laiko cvpp raktą trimis stulpeliais (pid, dvid, lid), o senoje formoje
    // be pid vietoje jo yra -1. Ieškom pagal stabilią (dvid, lid) porą ir atkuriam
    // saltinioId, kad likusi scraperio logika liktų nepakitusi.
    const poros = idsToCheck.map((id) => skaidytiSaltinioId("cvpp", id));

    const existsResult = await postgres.query(
        `SELECT f."sourceId0", f."sourceId1", f."sourceId2"
         FROM public.files f
         JOIN public."filesSourceTitles" st ON st.id = f."sourceTitleId"
         JOIN unnest($1::text[], $2::text[]) AS x(dvid, lid)
           ON f."sourceId1" = x.dvid AND f."sourceId2" = x.lid
         WHERE st.title = 'cvpp'`,
        [poros.map((p) => p[1]), poros.map((p) => p[2])],
    );

    return new Set(
        existsResult.rows.map((r) =>
            sujungtiSaltinioId("cvpp", [r.sourceId0, r.sourceId1, r.sourceId2, null]),
        ),
    );
}

function getUpdateCandidates(files, existingSet) {
    return files.filter(
        (f) =>
            f.oldSaltinioId !== f.saltinioId &&
            existingSet.has(f.oldSaltinioId) &&
            !existingSet.has(f.saltinioId),
    );
}

/**
 * Senos formos (be pid) įrašui priskiria tikrą pid — vietoj -1, kurį naudoja
 * skaidymas, kai pid nežinomas. Praleidžia, jei naujos formos įrašas jau yra.
 */
async function updateLegacyIds(toUpdate) {
    if (!toUpdate.length) return 0;

    const nauji = toUpdate.map((f) => skaidytiSaltinioId("cvpp", f.saltinioId));

    const result = await postgres.query(
        `UPDATE public.files AS f
         SET "sourceId0" = m.pid
         FROM unnest($1::text[], $2::text[], $3::text[]) AS m(pid, dvid, lid)
         JOIN public."filesSourceTitles" st ON st.title = 'cvpp'
         WHERE f."sourceTitleId" = st.id
           AND f."sourceId0" = '-1'
           AND f."sourceId1" = m.dvid
           AND f."sourceId2" = m.lid
           AND NOT EXISTS (
               SELECT 1 FROM public.files AS x
               WHERE x."sourceTitleId" = st.id
                 AND x."sourceId0" = m.pid
                 AND x."sourceId1" = m.dvid
                 AND x."sourceId2" = m.lid
           )`,
        [nauji.map((p) => p[0]), nauji.map((p) => p[1]), nauji.map((p) => p[2])],
    );

    if (result.rowCount > 0) {
        signalWork(WORK_SIGNALS.FILES_DOCUMENTS_READY, {
            source: "cvpp-updateLegacyIds",
            count: result.rowCount,
        });
    }

    return result.rowCount ?? 0;
}

function getInsertCandidates(files, existingSet) {
    return files.filter(
        (f) =>
            !existingSet.has(f.saltinioId) && !existingSet.has(f.oldSaltinioId),
    );
}

async function insertCvppFiles(toInsert) {
    if (!toInsert.length) return 0;

    const ids = await irasytiFailus(toInsert);
    return ids.length;
}

async function syncCvppFiles(files, notice) {
    if (!files.length) {
        logger.log(`[CVPP] ${notice.skelbimoKodas}: dokumentų įrašų nerasta`);
        return;
    }

    const idsToCheck = buildIdsToCheck(files);
    let existingSet = await getExistingCvppIdSet(idsToCheck);

    const toUpdate = getUpdateCandidates(files, existingSet);
    const updatedCount = await updateLegacyIds(toUpdate);
    if (toUpdate.length > 0) {
        logger.log(
            `[CVPP] ${notice.skelbimoKodas}: ID migracijos kandidatai=${toUpdate.length}, atnaujinta=${updatedCount}`,
        );
    }

    // Refresh after update to compute inserts against current DB state.
    existingSet = await getExistingCvppIdSet(idsToCheck);
    const toInsert = getInsertCandidates(files, existingSet);
    const insertedCount = await insertCvppFiles(toInsert);

    if (toInsert.length > 0) {
        logger.log(
            `[CVPP] ${notice.skelbimoKodas}: insert kandidatai=${toInsert.length}, įterpta=${insertedCount}`,
        );
    } else {
        logger.log(`[CVPP] ${notice.skelbimoKodas}: naujų failų nėra`);
    }
}

async function scrapeCvppNotice() {
    const noticeResult = await postgres.query(
        `SELECT * FROM "cvppViesiejiPirkimai" WHERE (nuskaitymas < $1 AND nuskaitymas >= 0) OR nuskaitymas IS NULL LIMIT 1;`,
        [NUSKAITYMO_VERSIJA],
    );

    if (noticeResult.rows.length < 1) {
        return false;
    }

    const notice = noticeResult.rows[0];
    logger.log(`[CVPP] Apdorojamas skelbimas ${notice.skelbimoKodas}`);

    try {
        if (!notice.dokumentaiLink) {
            logger.log(`[CVPP] ${notice.skelbimoKodas}: dokumentaiLink nėra`);
            await setNoticeStatus(notice.skelbimoKodas, NUSKAITYMO_VERSIJA);
            return true;
        }

        if (String(notice.dokumentaiLink).includes("vpt.lrv.lt")) {
            logger.log(`[CVPP] ${notice.skelbimoKodas}: vpt.lrv.lt šaltinis, praleidžiama`);
            await setNoticeStatus(notice.skelbimoKodas, VPT_BUSENA);
            return true;
        }

        const failaiPage = await fetchHtmlWithCookies(notice.dokumentaiLink);
        const { document } = parseHTML(failaiPage);
        const pid = getCvppPidFromDocsLink(notice.dokumentaiLink);

        const { merged, invalidLinkCount } = extractCvppFiles(document, pid);
        if (invalidLinkCount > 0) {
            logger.log(
                `[CVPP] ${notice.skelbimoKodas}: praleista netinkamų dokumentų nuorodų=${invalidLinkCount}`,
            );
        }

        logger.log(
            `[CVPP] ${notice.skelbimoKodas}: rasta failų=${merged.length}, pid=${pid || "nėra"}`,
        );
        await syncCvppFiles(merged, notice);

        await setNoticeStatus(notice.skelbimoKodas, NUSKAITYMO_VERSIJA);
        return true;
    } catch (error) {
        logger.log(
            `[CVPP] ${notice.skelbimoKodas}: klaida apdorojant skelbimą - ${error.message}`,
        );

        try {
            await setNoticeStatus(notice.skelbimoKodas, KLAIDOS_BUSENA);
            logger.log(`[CVPP] ${notice.skelbimoKodas}: pažymėta klaidos būsena`);
        } catch (updateError) {
            logger.log(
                `[CVPP] ${notice.skelbimoKodas}: nepavyko pažymėti klaidos būsenos - ${updateError.message}`,
            );
        }

        return true;
    }
}

while (await scrapeCvppNotice()) {}
