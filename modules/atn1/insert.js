export async function upsertAtn1(client, failasId, ppa) {
    await client.query("begin");
    try {
        // delete existing (cascades to all child tables)
        await client.query(
            `delete from "atn1ataskaitos" where "failasId" = $1`,
            [failasId],
        );

        const bi = ppa.bendraInformacija;
        const bud = ppa.pirkimoBudas;
        const sk = ppa.skundai;
        const ki = ppa.kitaInformacija;

        const {
            rows: [{ id: ataskaitaId }],
        } = await client.query(
            `
            insert into "atn1ataskaitos" (
                "failasId",
                "teisinisPageindas", "ataskaitosTipas", "pirkimoNumeris",
                "pirkimoObjektoPavadinimas", "pirkimoVerte",
                "finansuojamasEsLesomis", "sfmisRegistruotas", "sfmisProjektoKodasIrPav",
                "elektroninisPirkimas", "neElektroninisPriežastys",
                "perkanciosiosOrganizacijosKodas", "perkanciosiosOrganizacijosPavadinimas",
                "perkanciosiosOrganizacijosAdresas", "perkanciosiosOrganizacijosTipas",
                "kitaInformacija",
                "igaliojimasKitaiPO", "igaliotosiosKodas", "igaliotosiosPavadinimas",
                "igaliotosiosAdresas", "igaliotosiosTipas", "igaliotosiosKitaInformacija",
                "preliminariSutartis", "dinamineSistema",
                "pirkimoObjektoRusis", "pagrindinisKodasBvpz", "papildomiKodaiBvpz", "daliuSkaicius",
                "pirkimoBudas", "pirkimoBudoPagrindimas", "ankstesnioNumeris",
                "pajamosReikalavimas", "pajamosReikalavimasPriezastys",
                "pretenzijaPateikta", "ieskinysTeismui",
                "interesuKonfliktasNustatytas", "interesuKonfliktoPriemones",
                "konkurencijaIskreipiantisAsmuo", "konkurencijosPriemones",
                "atsakingasAsmuo", "telefonas", "elpastas",
                "pasirasantisAsmuo", "pasirasantisPareigos"
            ) values (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
                $23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44
            ) returning id`,
            [
                failasId,
                bi.teisinisPageindas,
                bi.ataskaitosTipas,
                bi.pirkimoNumeris,
                bi.pirkimoObjektoPavadinimas,
                bi.pirkimoVerte,
                bi.finansuojamasEsLesomis,
                bi.sfmisRegistruotas,
                bi.sfmisProjektoKodasIrPav,
                bi.elektroninisPirkimas,
                bi.neElektroninisPriežastys,
                bi.perkanciosiosOrganizacijosKodas,
                bi.perkanciosiosOrganizacijosPavadinimas,
                bi.perkanciosiosOrganizacijosAdresas,
                bi.perkanciosiosOrganizacijosTipas,
                bi.kitaInformacija,
                bi.igaliojimasKitaiPO,
                bi.igaliotosiosKodas,
                bi.igaliotosiosPavadinimas,
                bi.igaliotosiosAdresas,
                bi.igaliotosiosTipas,
                bi.igaliotosiosKitaInformacija,
                bi.preliminariSutartis,
                bi.dinamineSistema,
                bi.pirkimoObjektoRusis,
                bi.pagrindinisKodasBvpz,
                bi.papildomiKodaiBvpz,
                bi.daliuSkaicius,
                bud.pirkimoBudas,
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

        if (ppa.pirkimoDalys.length) {
            const vals = ppa.pirkimoDalys
                .map((d, i) => {
                    const b = i * 5;
                    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`;
                })
                .join(",");
            await client.query(
                `insert into "atn1pirkimoDalys" ("ataskaitaId","daliesNumeris","daliesPavadinimas","pagrindinisKodasBvpz","papildomiKodaiBvpz") values ${vals}`,
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
                `insert into "atn1dalyviai" ("ataskaitaId","fizinisAsmuo","kodas","pavadinimas","pavadinimoPatikslinimas","adresas","salis","grupe","atrinktoPasirinkomoPriezastys") values ${vals}`,
                ppa.dalyviai.flatMap((d) => [
                    ataskaitaId,
                    d.fizinisAsmuo,
                    d.kodas,
                    d.pavadinimas,
                    d.pavadinimoPatikslinimas,
                    d.adresas,
                    d.salis,
                    d.grupe,
                    d.atrinktoPasirinkomoPriezastys,
                ]),
            );
        }

        if (ppa.vertinimoKriterjai.length) {
            const vals = ppa.vertinimoKriterjai
                .map((_, i) => `($${i * 3 + 1},$${i * 3 + 2},$${i * 3 + 3})`)
                .join(",");
            await client.query(
                `insert into "atn1vertinimoKriterjai" ("ataskaitaId","daliesNumeris","vertinimoKriterijus") values ${vals}`,
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
                `insert into "atn1atmestiPasiulymai" ("ataskaitaId","daliesNumeris","dalyvioKodas","dalyvioPavadinimas","statusas","nepakviestoPriezastys","atsiemimoPriezastys","atmetimoTeisinisPageindas","atmetimoPriezastys","pasiulymoKaina","kainosIsraiska") values ${vals}`,
                ppa.atmestiPasiulymai.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeris,
                    d.dalyvioKodas,
                    d.dalyvioPavadinimas,
                    d.statusas,
                    d.nepakviestoPriezastys,
                    d.atsiemimoPriezastys,
                    d.atmetimoTeisinisPageindas,
                    d.atmetimoPriezastys,
                    d.pasiulymoKaina,
                    d.kainosIsraiska,
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
                `insert into "atn1pasiulymuEile" ("ataskaitaId","daliesNumeris","eileNumeris","dalyvioKodas","dalyvioPavadinimas","kainosSantykis","kaina","kainosIsraiska") values ${vals}`,
                ppa.pasiulymuEile.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeris,
                    d.eileNumeris,
                    d.dalyvioKodas,
                    d.dalyvioPavadinimas,
                    d.kainosSantykis,
                    d.kaina,
                    d.kainosIsraiska,
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
                `insert into "atn1proceduruPabaiga" ("ataskaitaId","daliesNumeris","proceduruPabaiga","sprendimoPriemimoData","sprendimoPriezastys","nutraukimoPriezastys") values ${vals}`,
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
                    const b = i * 17;
                    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13},$${b + 14},$${b + 15},$${b + 16},$${b + 17})`;
                })
                .join(",");
            await client.query(
                `insert into "atn1sutartys" ("ataskaitaId","daliesNumeriai","tiekejosKodas","teikejoPavadinimas","sutartisSudarymoData","sutartiesGaliojimas","sutartiesVerte","orientacineVerte","subrangosKetinama","subrangosInfo","centralizuotasPirkimas","centralizacijosTipas","zaliasisPirkimas","energetiniaiReikalavimai","energetikosPriemones","inovatyvusProduktas","kelioTransportoPriemones") values ${vals}`,
                ppa.sutartys.flatMap((d) => [
                    ataskaitaId,
                    d.daliesNumeriai,
                    d.tiekejosKodas,
                    d.teikejoPavadinimas,
                    d.sutartisSudarymoData ?? null,
                    d.sutartiesGaliojimas,
                    d.sutartiesVerte
                        ? parseFloat(d.sutartiesVerte.replace(/,/g, ""))
                        : null,
                    d.orientacineVerte,
                    d.subrangosKetinama,
                    d.subrangosInfo,
                    d.centralizuotasPirkimas,
                    d.centralizacijosTipas,
                    d.zaliasisPirkimas,
                    d.energetiniaiReikalavimai,
                    d.energetikosPriemones,
                    d.inovatyvusProduktas,
                    d.kelioTransportoPriemones,
                ]),
            );
        }

        await client.query("commit");
    } catch (err) {
        
        await client.query("rollback");
        throw err;
    }
}
