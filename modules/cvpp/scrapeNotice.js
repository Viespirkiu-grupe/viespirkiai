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
        const failaiValues = [];
        const failaiPlaceholders = [];
        merged.forEach((f, i) => {
            const idx = i * 4;
            failaiPlaceholders.push(
                `($${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4})`,
            );
            failaiValues.push(
                f.saltinis,
                f.saltinioId,
                f.pavadinimas,
                f.extension,
            );
        });
        const failaiQuery = `
            INSERT INTO public."failai"
            ("saltinis", "saltinioId", "pavadinimas", "extension")
            VALUES ${failaiPlaceholders.join(",")}
            ON CONFLICT ("saltinis", "saltinioId") WHERE (saltinis IS NOT NULL AND saltinis <> 'archive' AND "saltinioId" IS NOT NULL) DO NOTHING;
        `;
        await postgres.query(failaiQuery, failaiValues);
        console.log(`Inserted ${merged.length} rows into public.failai`);
    }

    await postgres.query(
        `UPDATE "cvppViesiejiPirkimai" SET nuskaitymas = $1 WHERE "skelbimoKodas" = $2;`,
        [NUSKAITYMO_VERSIJA, notice.skelbimoKodas],
    );
    return true;
}

while (await scrapeCvppNotice()) {}
