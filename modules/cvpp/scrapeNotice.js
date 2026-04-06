import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";
import { log } from "../../utils/log.js";

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
    let firstRes = await fetch(url, { redirect: "manual" });
    const cookies =
        firstRes.headers.getSetCookie?.() ??
        (firstRes.headers.get("set-cookie")
            ? [firstRes.headers.get("set-cookie")]
            : []);
    const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");

    firstRes = await fetch(url, {
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

    const existsResult = await postgres.query(
        `SELECT "saltinioId" FROM failai
         WHERE saltinis = 'cvpp'
           AND "saltinioId" = ANY($1)
           AND "saltinioId" IS NOT NULL`,
        [idsToCheck],
    );

    return new Set(existsResult.rows.map((r) => String(r.saltinioId)));
}

function getUpdateCandidates(files, existingSet) {
    return files.filter(
        (f) =>
            f.oldSaltinioId !== f.saltinioId &&
            existingSet.has(f.oldSaltinioId) &&
            !existingSet.has(f.saltinioId),
    );
}

async function updateLegacyIds(toUpdate) {
    if (!toUpdate.length) return 0;

    const placeholders = toUpdate.map(
        (_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`,
    );
    const result = await postgres.query(
        `UPDATE failai AS f
         SET "saltinioId" = m.new_id
         FROM (VALUES ${placeholders.join(", ")}) AS m(old_id, new_id)
         WHERE f.saltinis = 'cvpp'
           AND f."saltinioId" = m.old_id
           AND NOT EXISTS (
               SELECT 1
               FROM failai AS x
               WHERE x.saltinis = 'cvpp'
                 AND x."saltinioId" = m.new_id
           )`,
        toUpdate.flatMap((f) => [f.oldSaltinioId, f.saltinioId]),
    );

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

    const placeholders = toInsert.map(
        (_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`,
    );

    const result = await postgres.query(
        `INSERT INTO failai ("saltinis", "saltinioId", "pavadinimas", "extension")
         VALUES ${placeholders.join(", ")}
         ON CONFLICT ("saltinis", "saltinioId")
         WHERE (
             saltinis IS NOT NULL
             AND saltinis <> 'archive'
             AND "saltinioId" IS NOT NULL
         ) DO NOTHING`,
        toInsert.flatMap((f) => [
            f.saltinis,
            f.saltinioId,
            f.pavadinimas,
            f.extension,
        ]),
    );

    return result.rowCount ?? 0;
}

async function syncCvppFiles(files, notice) {
    if (!files.length) {
        log(`[CVPP] ${notice.skelbimoKodas}: dokumentų įrašų nerasta`);
        return;
    }

    const idsToCheck = buildIdsToCheck(files);
    let existingSet = await getExistingCvppIdSet(idsToCheck);

    const toUpdate = getUpdateCandidates(files, existingSet);
    const updatedCount = await updateLegacyIds(toUpdate);
    if (toUpdate.length > 0) {
        log(
            `[CVPP] ${notice.skelbimoKodas}: ID migracijos kandidatai=${toUpdate.length}, atnaujinta=${updatedCount}`,
        );
    }

    // Refresh after update to compute inserts against current DB state.
    existingSet = await getExistingCvppIdSet(idsToCheck);
    const toInsert = getInsertCandidates(files, existingSet);
    const insertedCount = await insertCvppFiles(toInsert);

    if (toInsert.length > 0) {
        log(
            `[CVPP] ${notice.skelbimoKodas}: insert kandidatai=${toInsert.length}, įterpta=${insertedCount}`,
        );
    } else {
        log(`[CVPP] ${notice.skelbimoKodas}: naujų failų nėra`);
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
    log(`[CVPP] Apdorojamas skelbimas ${notice.skelbimoKodas}`);

    try {
        if (!notice.dokumentaiLink) {
            log(`[CVPP] ${notice.skelbimoKodas}: dokumentaiLink nėra`);
            await setNoticeStatus(notice.skelbimoKodas, NUSKAITYMO_VERSIJA);
            return true;
        }

        if (String(notice.dokumentaiLink).includes("vpt.lrv.lt")) {
            log(`[CVPP] ${notice.skelbimoKodas}: vpt.lrv.lt šaltinis, praleidžiama`);
            await setNoticeStatus(notice.skelbimoKodas, VPT_BUSENA);
            return true;
        }

        const failaiPage = await fetchHtmlWithCookies(notice.dokumentaiLink);
        const { document } = parseHTML(failaiPage);
        const pid = getCvppPidFromDocsLink(notice.dokumentaiLink);

        const { merged, invalidLinkCount } = extractCvppFiles(document, pid);
        if (invalidLinkCount > 0) {
            log(
                `[CVPP] ${notice.skelbimoKodas}: praleista netinkamų dokumentų nuorodų=${invalidLinkCount}`,
            );
        }

        log(
            `[CVPP] ${notice.skelbimoKodas}: rasta failų=${merged.length}, pid=${pid || "nėra"}`,
        );
        await syncCvppFiles(merged, notice);

        await setNoticeStatus(notice.skelbimoKodas, NUSKAITYMO_VERSIJA);
        return true;
    } catch (error) {
        log(
            `[CVPP] ${notice.skelbimoKodas}: klaida apdorojant skelbimą - ${error.message}`,
        );

        try {
            await setNoticeStatus(notice.skelbimoKodas, KLAIDOS_BUSENA);
            log(`[CVPP] ${notice.skelbimoKodas}: pažymėta klaidos būsena`);
        } catch (updateError) {
            log(
                `[CVPP] ${notice.skelbimoKodas}: nepavyko pažymėti klaidos būsenos - ${updateError.message}`,
            );
        }

        return true;
    }
}

while (await scrapeCvppNotice()) {}
