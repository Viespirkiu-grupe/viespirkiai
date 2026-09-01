async function insertJson(client, table, rows, columns) {
    if (!rows.length) return;
    await client.query(
        `INSERT INTO kotis."${table}" SELECT x.* FROM jsonb_to_recordset($1::jsonb) AS x(${columns})`,
        [JSON.stringify(rows)],
    );
}

async function clearByAidIds(client, table, ids) {
    await client.query(`DELETE FROM kotis."${table}" WHERE "pagalbosId" = ANY($1)`, [ids]);
}

async function replaceOneToOne(client, records) {
    const ids = records.map((row) => row.id);
    const state = records.filter((row) => Object.values(row.valstybesPagalbosDetales).some((v) => v != null))
        .map((row) => ({ pagalbosId: row.id, priemonesTipoId: row.priemonesTipoId, ...row.valstybesPagalbosDetales }));
    const financial = records.filter((row) => Object.values(row.finansinesDetales).some((v) => v != null))
        .map((row) => ({ pagalbosId: row.id, ...row.finansinesDetales }));
    const deMinimis = records.filter((row) => Object.values(row.deMinimisDetales).some((v) => v != null))
        .map((row) => ({ pagalbosId: row.id, ...row.deMinimisDetales }));
    await clearByAidIds(client, "valstybesPagalbosDetales", ids);
    await clearByAidIds(client, "finansinesDetales", ids);
    await clearByAidIds(client, "deMinimisDetales", ids);
    await insertJson(client, "valstybesPagalbosDetales", state,
        '"pagalbosId" bigint, "priemonesTipoId" integer, "schemosPavadinimas" text, "intensyvumasProc" numeric, "taikomosLaikinosTaisykles" boolean');
    await insertJson(client, "finansinesDetales", financial,
        '"pagalbosId" bigint, "patiriaFinansiniuSunkumu" boolean, "paskolosSuma" numeric, "garantuojamaPaskolosDaliesSuma" numeric');
    await insertJson(client, "deMinimisDetales", deMinimis,
        '"pagalbosId" bigint, "yraSusijusiuSubjektu" boolean, "vertinimoPagrindas" text, "velavimoRegistruotiPriezastis" text');
}

async function replaceLegalActs(client, records) {
    const acts = [...new Map(records.flatMap((row) => row.teisesAktai ?? [])
        .map((act) => [`${act.registracijosKodas ?? ""}\u0000${act.pavadinimas}`, act])).values()];
    if (acts.length) {
        await client.query(
            `INSERT INTO kotis."teisesAktai" ("registracijosKodas", "pavadinimas", "url")
             SELECT x."registracijosKodas", x."pavadinimas", x."url"
             FROM jsonb_to_recordset($1::jsonb) AS x("registracijosKodas" text, "pavadinimas" text, "url" text)
             ON CONFLICT ("registracijosKodas", "pavadinimas") DO UPDATE SET
                "url" = coalesce(EXCLUDED."url", kotis."teisesAktai"."url")`,
            [JSON.stringify(acts)],
        );
    }
    const { rows: stored } = acts.length
        ? await client.query(
            `SELECT "id", "registracijosKodas", "pavadinimas" FROM kotis."teisesAktai"
             WHERE "pavadinimas" = ANY($1)`,
            [acts.map((act) => act.pavadinimas)],
        )
        : { rows: [] };
    const ids = new Map(stored.map((act) => [
        `${act.registracijosKodas ?? ""}\u0000${act.pavadinimas}`, act.id,
    ]));
    const links = records.flatMap((row) => (row.teisesAktai ?? []).map((act) => ({
        pagalbosId: row.id,
        teisesAktoId: ids.get(`${act.registracijosKodas ?? ""}\u0000${act.pavadinimas}`),
        tipas: act.tipas,
    })));
    await clearByAidIds(client, "pagalbuTeisesAktai", records.map((row) => row.id));
    await insertJson(client, "pagalbuTeisesAktai", links,
        '"pagalbosId" bigint, "teisesAktoId" bigint, "tipas" kotis."teisesAktoTipas"');
}

export async function replaceRelations(client, records, dictionaries, subjectId) {
    const ids = records.map((row) => row.id);
    await clearByAidIds(client, "pagalbuTikslai", ids);
    await clearByAidIds(client, "pagalbuTaisykles", ids);
    await clearByAidIds(client, "susijeSubjektai", ids);
    const targets = records.flatMap((row) => [
        row.pagrindinisTikslas && { pagalbosId: row.id, tiksloId: dictionaries.pagrindinisTikslas.get(row.pagrindinisTikslas), tipas: "primary" },
        row.antrinisTikslas && { pagalbosId: row.id, tiksloId: dictionaries.antrinisTikslas.get(row.antrinisTikslas), tipas: "secondary" },
    ].filter(Boolean));
    const rules = records.flatMap((row) => (row.taisykles ?? []).map((value) => ({
        pagalbosId: row.id, taisyklesId: dictionaries.taisykles.get(value),
    })));
    const related = records.flatMap((row) => (row.susijeSubjektai ?? []).map((item) => ({
        pagalbosId: row.id, subjektoId: subjectId(item),
        rysioTipas: item.rysioTipas, eilesNumeris: item.eilesNumeris,
    })));
    await insertJson(client, "pagalbuTikslai", targets,
        '"pagalbosId" bigint, "tiksloId" integer, "tipas" kotis."tiksloTipas"');
    await insertJson(client, "pagalbuTaisykles", rules,
        '"pagalbosId" bigint, "taisyklesId" integer');
    await insertJson(client, "susijeSubjektai", related,
        '"pagalbosId" bigint, "subjektoId" bigint, "rysioTipas" text, "eilesNumeris" integer');
    await replaceLegalActs(client, records);
    await replaceOneToOne(client, records);
    await client.query(
        `INSERT INTO kotis."busenuIstorija" ("pagalbosId", "busenosId", "suteikimoData", "versija")
         SELECT x."id", x."busenosId", x."busenosSuteikimoData", x."versija"
         FROM jsonb_to_recordset($1::jsonb) AS x(
            "id" bigint, "busenosId" integer, "busenosSuteikimoData" date, "versija" integer
         ) WHERE x."busenosSuteikimoData" IS NOT NULL
         ON CONFLICT ("pagalbosId", "busenosId", "suteikimoData", "versija") DO NOTHING`,
        [JSON.stringify(records)],
    );
}
