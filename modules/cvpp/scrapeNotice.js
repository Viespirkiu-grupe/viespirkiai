import { postgres } from "../../postgres/postgres.js";
import { parseHTML } from "linkedom";

const NUSKAITYMO_VERSIJA = 1;

async function scrapeCvppNotice() {
    let notice = await postgres.query(
        `SELECT * FROM "cvppViesiejiPirkimai" WHERE (nuskaitymas < $1 AND nuskaitymas >= 0) OR nuskaitymas IS NULL LIMIT 1;`,
        [NUSKAITYMO_VERSIJA],
    );

    if (notice.rows.length < 1) {
        return false;
    }

    notice = notice.rows[0];
    console.log(notice);

    if (!notice.dokumentaiLink) {
        console.log("no documents link");
        await postgres.query(
            `
          UPDATE "cvppViesiejiPirkimai" SET nuskaitymas = $1 WHERE "skelbimoKodas" = $2;`,
            [NUSKAITYMO_VERSIJA, notice.skelbimoKodas],
        );
        return true;
    }

    if (String(notice.dokumentaiLink).includes("vpt.lrv.lt")) {
        await postgres.query(
            `UPDATE "cvppViesiejiPirkimai" SET nuskaitymas = $1 WHERE "skelbimoKodas" = $2;`,
            [-69, notice.skelbimoKodas],
        );
        return true;
    }
    let failaiPageRes = await fetch(notice.dokumentaiLink, {
        redirect: "manual",
    });
    const cookies =
        failaiPageRes.headers.getSetCookie?.() ??
        (failaiPageRes.headers.get("set-cookie")
            ? [failaiPageRes.headers.get("set-cookie")]
            : []);
    const cookieHeader = cookies.map((c) => c.split(";")[0]).join("; ");
    failaiPageRes = await fetch(notice.dokumentaiLink, {
        headers: cookieHeader ? { cookie: cookieHeader } : undefined,
    });
    let failaiPage = await failaiPageRes.text();

    let { document } = parseHTML(failaiPage);

    const filesList = [
        ...document.querySelectorAll(
            'a[href^="javascript:DownloadPublicDocument("]',
        ),
    ].map((a) => {
        const [, dvid, , lid] = a.href.match(
            /DownloadPublicDocument\('(\w+)','(\w+)','(\w+)'\)/,
        );
        const saltinioId = `${dvid}/${lid}`;
        const pavadinimas = a.textContent.trim();
        const extMatch = pavadinimas.match(/\.([^.]+)$/);
        const extension = extMatch ? extMatch[1].toLowerCase() : "";
        return { saltinis: "cvpp", saltinioId, pavadinimas, extension };
    });

    const map = new Map();
    for (const f of filesList) {
        if (f.saltinioId) map.set(f.saltinioId, f);
    }
    const merged = Array.from(map.values());

    if (merged.length > 0) {
        const existsResult = await postgres.query(
            `SELECT "saltinis", "saltinioId" FROM failai
         WHERE ("saltinis", "saltinioId") IN (${merged.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')})
           AND saltinis IS NOT NULL AND saltinis <> 'archive' AND "saltinioId" IS NOT NULL`,
            merged.flatMap(f => [f.saltinis, f.saltinioId])
        );

        const existingSet = new Set(existsResult.rows.map(r => `${r.saltinis}:${r.saltinioId}`));
        const toInsert = merged.filter(f => !existingSet.has(`${f.saltinis}:${f.saltinioId}`));

        if (toInsert.length > 0) {
            const placeholders = toInsert.map((_, i) =>
                `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
            );
            await postgres.query(
                `INSERT INTO failai ("saltinis", "saltinioId", "pavadinimas", "extension")
             VALUES ${placeholders.join(', ')}
             ON CONFLICT ("saltinis", "saltinioId") WHERE (saltinis IS NOT NULL AND saltinis <> 'archive' AND "saltinioId" IS NOT NULL) DO NOTHING`,
                toInsert.flatMap(f => [f.saltinis, f.saltinioId, f.pavadinimas, f.extension])
            );
            console.log(`Inserted ${toInsert.length} rows into public.failai`);
        } else {
            console.log('No new rows to insert into public.failai');
        }
    }

    await postgres.query(
        `UPDATE "cvppViesiejiPirkimai" SET nuskaitymas = $1 WHERE "skelbimoKodas" = $2;`,
        [NUSKAITYMO_VERSIJA, notice.skelbimoKodas],
    );
    return true;
}

while (await scrapeCvppNotice()) { }
