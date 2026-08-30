const ZODYNAI = Object.freeze({
    teisinisPagrindas: "teisiniaiPagrindai",
    ataskaitosTipas: "ataskaitosTipai",
    pirkimoVerte: "pirkimoVertes",
    perkanciosiosOrganizacijosTipas: "perkanciosiosOrganizacijosTipai",
    igaliotosiosTipas: "igaliotosiosTipai",
    pirkimoBudas: "pirkimoBudai",
    atmestoPasiulymoStatusas: "atmestuPasiulymuStatusai",
    atmetimoTeisinisPagrindas: "atmetimoTeisiniaiPagrindai",
    atmetimoPriezastys: "atmetimoPriezastys",
    kainosIsraiska: "kainosIsraiskos",
    salis: "salys",
    centralizacijosTipas: "centralizacijosTipai",
    pirkimoObjektoRusis: "pirkimoObjektoRusys",
});

function zodynoReiksme(rawValue) {
    return rawValue == null ? null : String(rawValue).trim() || null;
}

async function zodynoIds(client, lentele, rawValues) {
    const pavadinimai = [...new Set(rawValues.map(zodynoReiksme).filter(Boolean))].sort();
    if (!pavadinimai.length) return new Map();

    await client.query(
        `INSERT INTO ppa."${lentele}" (pavadinimas)
         SELECT value FROM unnest($1::text[]) AS u(value)
         ORDER BY value
         ON CONFLICT (pavadinimas) DO NOTHING`,
        [pavadinimai],
    );
    const result = await client.query(
        `SELECT id, pavadinimas FROM ppa."${lentele}"
         WHERE pavadinimas = ANY($1::text[])`,
        [pavadinimai],
    );
    return new Map(result.rows.map((row) => [row.pavadinimas, row.id]));
}

async function zodynoId(client, lentele, rawValue) {
    const pavadinimas = zodynoReiksme(rawValue);
    if (pavadinimas == null) return null;

    const existing = await client.query(
        `SELECT id FROM ppa."${lentele}" WHERE pavadinimas = $1`,
        [pavadinimas],
    );
    if (existing.rowCount) return existing.rows[0].id;

    // ON CONFLICT ... DO UPDATE patikimai grąžina id ir tada, kai tą pačią
    // naują žodyno reikšmę vienu metu pirmą kartą pamato keli workeriai.
    const inserted = await client.query(
        `INSERT INTO ppa."${lentele}" (pavadinimas)
         VALUES ($1)
         ON CONFLICT (pavadinimas) DO UPDATE
         SET pavadinimas = EXCLUDED.pavadinimas
         RETURNING id`,
        [pavadinimas],
    );
    return inserted.rows[0].id;
}

export async function upsertPpa(
    client,
    failasId,
    ppa,
    { manageTransaction = true } = {},
) {
    if (manageTransaction) await client.query("begin");
    try {
        // delete existing (cascades to all child tables)
        await client.query(
            `delete from ppa."ataskaitos" where "failasId" = $1`,
            [failasId],
        );

        const bi = ppa.bendraInformacija;
        const bud = ppa.pirkimoBudas;
        const sk = ppa.skundai;
        const ki = ppa.kitaInformacija;

        // Visada ta pačia tvarka: taip lygiagretūs workeriai nekuria ciklinių
        // laukimų, kai vienu metu atsiranda kelios naujos žodyno reikšmės.
        const teisinisPagrindasId = await zodynoId(
            client,
            ZODYNAI.teisinisPagrindas,
            bi.teisinisPagrindas,
        );
        const ataskaitosTipasId = await zodynoId(
            client,
            ZODYNAI.ataskaitosTipas,
            bi.ataskaitosTipas,
        );
        const pirkimoVerteId = await zodynoId(
            client,
            ZODYNAI.pirkimoVerte,
            bi.pirkimoVerte,
        );
        const perkanciosiosOrganizacijosTipasId = await zodynoId(
            client,
            ZODYNAI.perkanciosiosOrganizacijosTipas,
            bi.perkanciosiosOrganizacijosTipas,
        );
        const igaliotosiosTipasId = await zodynoId(
            client,
            ZODYNAI.igaliotosiosTipas,
            bi.igaliotosiosTipas,
        );
        const pirkimoBudasId = await zodynoId(
            client,
            ZODYNAI.pirkimoBudas,
            bud.pirkimoBudas,
        );
        const pirkimoObjektoRusisId = await zodynoId(
            client,
            ZODYNAI.pirkimoObjektoRusis,
            bi.pirkimoObjektoRusis,
        );

        const ataskaitaResult = await client.query(
            `
            insert into ppa."ataskaitos" (
                "failasId",
                "teisinisPagrindasId", "ataskaitosTipasId", "pirkimoNumeris",
                "pirkimoObjektoPavadinimas", "pirkimoVerteId",
                "finansuojamasEsLesomis", "sfmisRegistruotas", "sfmisProjektoKodasIrPav",
                "elektroninisPirkimas", "neElektroninisPriežastys",
                "perkanciosiosOrganizacijosKodas", "perkanciosiosOrganizacijosPavadinimas",
                "perkanciosiosOrganizacijosAdresas", "perkanciosiosOrganizacijosTipasId",
                "kitaInformacija",
                "igaliojimasKitaiPO", "igaliotosiosKodas", "igaliotosiosPavadinimas",
                "igaliotosiosAdresas", "igaliotosiosTipasId", "igaliotosiosKitaInformacija",
                "preliminariSutartis", "dinamineSistema",
                "pirkimoObjektoRusisId", "pagrindinisKodasBvpz", "papildomiKodaiBvpz", "daliuSkaicius",
                "pirkimoBudasId", "pirkimoBudoPagrindimas", "ankstesnioNumeris",
                "pajamosReikalavimas", "pajamosReikalavimasPriezastys",
                "pretenzijaPateikta", "ieskinysTeismui",
                "interesuKonfliktasNustatytas", "interesuKonfliktoPriemones",
                "konkurencijaIskreipiantisAsmuo", "konkurencijosPriemones",
                "atsakingasAsmuo", "telefonas", "elpastas",
                "pasirasantisAsmuo", "pasirasantisPareigos"
            ) values (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
                $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44
            )
            ON CONFLICT ("failasId") DO NOTHING
            returning id`,
            [
                failasId,
                teisinisPagrindasId,
                ataskaitosTipasId,
                bi.pirkimoNumeris,
                bi.pirkimoObjektoPavadinimas,
                pirkimoVerteId,
                bi.finansuojamasEsLesomis,
                bi.sfmisRegistruotas,
                bi.sfmisProjektoKodasIrPav,
                bi.elektroninisPirkimas,
                bi.neElektroninisPriežastys,
                bi.perkanciosiosOrganizacijosKodas,
                bi.perkanciosiosOrganizacijosPavadinimas,
                bi.perkanciosiosOrganizacijosAdresas,
                perkanciosiosOrganizacijosTipasId,
                bi.kitaInformacija,
                bi.igaliojimasKitaiPO,
                bi.igaliotosiosKodas,
                bi.igaliotosiosPavadinimas,
                bi.igaliotosiosAdresas,
                igaliotosiosTipasId,
                bi.igaliotosiosKitaInformacija,
                bi.preliminariSutartis,
                bi.dinamineSistema,
                pirkimoObjektoRusisId,
                bi.pagrindinisKodasBvpz,
                bi.papildomiKodaiBvpz,
                bi.daliuSkaicius,
                pirkimoBudasId,
                bud.pirkimoBudoPagrindimas,
                bud.ankstesnioNumeris,
                bud.pajamosReikalavimas,
                bud.pajamosReikalavimasPriezastys,
                sk.pretenzijaPateikta,
                sk.ieskinysTeismui,
                sk.interesuKonfliktasNustatytas,
                sk.interesuKonfliktoPriemones,
                sk.konkurencijaIskreipiantisAsmuo,
                sk.konkurencijosPriemones,
                ki.atsakingasAsmuo,
                ki.telefonas,
                ki.elpastas,
                ki.pasirasantisAsmuo,
                ki.pasirasantisPareigos,
            ],
        );
        // Kitas (pvz., dar neužgesintas senas) procesas galėjo įrašyti failą
        // tarp DELETE ir INSERT. Jo pilną transakciją paliekame kaip laimėtoją.
        if (ataskaitaResult.rowCount === 0) {
            if (manageTransaction) await client.query("commit");
            return;
        }
        const ataskaitaId = ataskaitaResult.rows[0].id;

        const atmestuStatusai = await zodynoIds(
            client,
            ZODYNAI.atmestoPasiulymoStatusas,
            ppa.atmestiPasiulymai.map((d) => d.statusas),
        );
        const atmetimoTeisiniaiPagrindai = await zodynoIds(
            client,
            ZODYNAI.atmetimoTeisinisPagrindas,
            ppa.atmestiPasiulymai.map((d) => d.atmetimoTeisinisPagrindas),
        );
        const atmetimoPriezastys = await zodynoIds(
            client,
            ZODYNAI.atmetimoPriezastys,
            ppa.atmestiPasiulymai.map((d) => d.atmetimoPriezastys),
        );
        const kainosIsraiskos = await zodynoIds(
            client,
            ZODYNAI.kainosIsraiska,
            [
                ...ppa.atmestiPasiulymai.map((d) => d.kainosSanauduIsraiska),
                ...ppa.pasiulymuEile.map((d) => d.kainosSanauduIsraiska),
            ],
        );
        const salys = await zodynoIds(
            client,
            ZODYNAI.salis,
            ppa.dalyviai.map((d) => d.salis),
        );
        const centralizacijosTipai = await zodynoIds(
            client,
            ZODYNAI.centralizacijosTipas,
            ppa.sutartys.map((d) => d.centralizacijosTipas),
        );

        if (ppa.pirkimoDalys.length) {
            const vals = ppa.pirkimoDalys
                .map((_, i) => {
                    const b = i * 5;
                    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
                })
                .join(",");
            await client.query(
                `insert into ppa."pirkimoDalys" ("ataskaitaId","daliesNumeris","daliesPavadinimas","pagrindinisKodasBvpz","papildomiKodaiBvpz") values ${vals}`,
                ppa.pirkimoDalys.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeris,
                    d.daliesPavadinimas,
                    d.pagrindinisKodasBvpz,
                    d.papildomiKodaiBvpz,
                ]),
            );
        }

        if (ppa.dalyviai.length) {
            const vals = ppa.dalyviai
                .map((_, i) => {
                    const b = i * 9;
                    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9})`;
                })
                .join(",");
            await client.query(
                `insert into ppa."dalyviai" ("ataskaitaId","fizinisAsmuo","kodas","pavadinimas","pavadinimoPatikslinimas","adresas","salisId","grupe","atrinktoPasirinkomoPriezastys") values ${vals}`,
                ppa.dalyviai.flatMap((d) => [
                    ataskaitaId,
                    d.fizinisAsmuo,
                    d.kodas,
                    d.pavadinimas,
                    d.pavadinimoPatikslinimas,
                    d.adresas,
                    salys.get(zodynoReiksme(d.salis)) ?? null,
                    d.grupe,
                    d.pasirinkimoPriezastis,
                ]),
            );
        }

        if (ppa.vertinimoKriterjai.length) {
            const vals = ppa.vertinimoKriterjai
                .map((_, i) => `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`)
                .join(",");
            await client.query(
                `insert into ppa."vertinimoKriterijai" ("ataskaitaId","daliesNumeris","vertinimoKriterijus") values ${vals}`,
                ppa.vertinimoKriterjai.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeris,
                    d.vertinimoKriterijus,
                ]),
            );
        }

        if (ppa.atmestiPasiulymai.length) {
            const vals = ppa.atmestiPasiulymai
                .map((_, i) => {
                    const b = i * 11;
                    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11})`;
                })
                .join(",");
            await client.query(
                `insert into ppa."atmestiPasiulymai" ("ataskaitaId","daliesNumeris","dalyvioKodas","dalyvioPavadinimas","statusasId","nepakviestoPriezastys","atsiemimoPriezastys","atmetimoTeisinisPagrindasId","atmetimoPriezastysId","pasiulymoKaina","kainosIsraiskaId") values ${vals}`,
                ppa.atmestiPasiulymai.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeris,
                    d.dalyvioKodas,
                    d.dalyvioPavadinimas,
                    atmestuStatusai.get(zodynoReiksme(d.statusas)) ?? null,
                    d.nepakviestoPriezastys,
                    d.atsiemimoPriezastys,
                    atmetimoTeisiniaiPagrindai.get(zodynoReiksme(d.atmetimoTeisinisPagrindas)) ?? null,
                    atmetimoPriezastys.get(zodynoReiksme(d.atmetimoPriezastys)) ?? null,
                    d.pasiulymoKainaSanaudos
                        ? parseFloat(
                              d.pasiulymoKainaSanaudos.replace(/,/g, ""),
                          )
                        : null,
                    kainosIsraiskos.get(zodynoReiksme(d.kainosSanauduIsraiska)) ?? null,
                ]),
            );
        }

        if (ppa.pasiulymuEile.length) {
            const vals = ppa.pasiulymuEile
                .map((_, i) => {
                    const b = i * 8;
                    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8})`;
                })
                .join(",");
            await client.query(
                `insert into ppa."pasiulymuEile" ("ataskaitaId","daliesNumeris","eileNumeris","dalyvioKodas","dalyvioPavadinimas","kainosSantykis","kaina","kainosIsraiskaId") values ${vals}`,
                ppa.pasiulymuEile.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeris,
                    d.eilesNumeris,
                    d.dalyvioKodas,
                    d.dalyvioPavadinimas,
                    d.kainosKokybesSantykis,
                    d.kainaSanaudos
                        ? parseFloat(d.kainaSanaudos.replace(/,/g, ""))
                        : null,
                    kainosIsraiskos.get(zodynoReiksme(d.kainosSanauduIsraiska)) ?? null,
                ]),
            );
        }

        if (ppa.proceduruPabaiga.length) {
            const vals = ppa.proceduruPabaiga
                .map((_, i) => {
                    const b = i * 6;
                    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
                })
                .join(",");
            await client.query(
                `insert into ppa."proceduruPabaiga" ("ataskaitaId","daliesNumeris","proceduruPabaiga","sprendimoPriemimoData","sprendimoPriezastys","nutraukimoPriezastys") values ${vals}`,
                ppa.proceduruPabaiga.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeris,
                    d.proceduruPabaiga,
                    d.sprendimoPriemimoData ?? null,
                    d.sprendimoPriezastys,
                    d.nutraukimoPriezastys,
                ]),
            );
        }

        if (ppa.sutartys.length) {
            const vals = ppa.sutartys
                .map((_, i) => {
                    const b = i * 18;
                    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},$${b + 16},$${b + 17},$${b + 18})`;
                })
                .join(",");
            await client.query(
                `insert into ppa."ataskaituSutartys" ("ataskaitaId","daliesNumeriai","tiekejosKodas","teikejoPavadinimas","sutartisSudarymoData","sutartiesGaliojimas","sutartiesGaliojimoPastaba","sutartiesVerte","orientacineVerte","subrangosKetinama","subrangosInfo","centralizuotasPirkimas","centralizacijosTipasId","zaliasisPirkimas","energetiniaiReikalavimai","energetikosPriemones","inovatyvusProduktas","kelioTransportoPriemones") values ${vals}`,
                ppa.sutartys.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeris,
                    d.tiekejoKodas,
                    d.tiekejoPavadinimas,
                    d.sutartiesSudarymoData ?? null,
                    d.sutartiesGaliojimoTerminas,
                    d.sutartiesGaliojimoPastaba,
                    d.sutartiesVerte
                        ? parseFloat(d.sutartiesVerte.replace(/,/g, ""))
                        : null,
                    d.arOrientacineVerte,
                    d.arKetinamaSubranga,
                    d.subrangosInfo,
                    d.centralizuotasPirkimas,
                    centralizacijosTipai.get(zodynoReiksme(d.centralizacijosTipas)) ?? null,
                    d.zaliasisPirkimas,
                    d.energetiniaiReikalavimai,
                    d.energetikosPriemones,
                    d.inovatyvusProduktas,
                    d.kelioTransportoPriemones,
                ]),
            );
        }

        if (manageTransaction) await client.query("commit");
    } catch (err) {
        if (manageTransaction) await client.query("rollback");
        throw err;
    }
}
