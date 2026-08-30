import { syncAdpChanges } from "../modules/adp/syncChanges.js";

const FINANSINES_ATASKAITOS_COLUMNS = [
    "_id",
    "jarId",
    "formaId",
    "statusasId",
    "templateId",
    "standardId",
    "lineTypeId",
    "reiksme",
    "laikotarpisNuo",
    "laikotarpisIki",
    "duomenuData",
];

async function upsertPavadinimai(postgres, schema, table, idColumn, nameColumn, rows) {
    const filtered = rows.filter(
        (row) => row[idColumn] != null && row[nameColumn] !== undefined,
    );
    if (!filtered.length) return;

    const values = [];
    const placeholders = filtered
        .map((row) => {
            values.push(row[idColumn], row[nameColumn]);
            return `($${values.length - 1}, $${values.length})`;
        })
        .join(",");

    await postgres.query(
        `
        INSERT INTO "${schema}"."${table}" ("${idColumn}", "${nameColumn}")
        VALUES ${placeholders}
        ON CONFLICT ("${idColumn}") DO UPDATE
        SET "${nameColumn}" = EXCLUDED."${nameColumn}"
        WHERE EXCLUDED."${nameColumn}" IS NOT NULL
          AND "${schema}"."${table}"."${nameColumn}" IS DISTINCT FROM EXCLUDED."${nameColumn}"
        `,
        values,
    );
}

// Finansinių ataskaitų lentelės gyvena "adpFinansinesAtaskaitos" schemoje
// (DDL — adpFinansinesAtaskaitosSchema.sql); vardai nebeturi bendro prefikso,
// tad žodynai nurodomi aiškiai.
const FINANSINES_ATASKAITOS_SCHEMA = "adpFinansinesAtaskaitos";

function finansinesAtaskaitosBeforeApply({ formos, standartai, eiluciuTipai, mainTable }) {
    return async ({ inserts, patches, postgres }) => {
        await upsertPavadinimai(
            postgres,
            FINANSINES_ATASKAITOS_SCHEMA,
            formos,
            "templateId",
            "templateName",
            inserts,
        );
        await upsertPavadinimai(
            postgres,
            FINANSINES_ATASKAITOS_SCHEMA,
            standartai,
            "standardId",
            "standardName",
            inserts,
        );
        await upsertPavadinimai(
            postgres,
            FINANSINES_ATASKAITOS_SCHEMA,
            eiluciuTipai,
            "lineTypeId",
            "lineName",
            inserts,
        );

        for (const row of inserts) {
            delete row.templateName;
            delete row.standardName;
            delete row.lineName;
        }

        for (const patch of patches) {
            const currentRes = await postgres.query(
                `SELECT "templateId", "standardId", "lineTypeId"
                   FROM "${FINANSINES_ATASKAITOS_SCHEMA}"."${mainTable}" WHERE "_id" = $1`,
                [patch._id],
            );
            const current = currentRes.rows[0];
            if (current) {
                await upsertPavadinimai(
                    postgres,
                    FINANSINES_ATASKAITOS_SCHEMA,
                    formos,
                    "templateId",
                    "templateName",
                    [
                        {
                            templateId: patch.patch.template_id ?? current.templateId,
                            templateName:
                                patch.patch.template_name ??
                                (patch.patch.template_id !== undefined ? null : undefined),
                        },
                    ],
                );
                await upsertPavadinimai(
                    postgres,
                    FINANSINES_ATASKAITOS_SCHEMA,
                    standartai,
                    "standardId",
                    "standardName",
                    [
                        {
                            standardId: patch.patch.standard_id ?? current.standardId,
                            standardName:
                                patch.patch.standard_name ??
                                (patch.patch.standard_id !== undefined ? null : undefined),
                        },
                    ],
                );
                await upsertPavadinimai(
                    postgres,
                    FINANSINES_ATASKAITOS_SCHEMA,
                    eiluciuTipai,
                    "lineTypeId",
                    "lineName",
                    [
                        {
                            lineTypeId: patch.patch.line_type_id ?? current.lineTypeId,
                            lineName:
                                patch.patch.line_name ??
                                (patch.patch.line_type_id !== undefined ? null : undefined),
                        },
                    ],
                );
            }

            const values = [];
            const set = [];
            const names = [
                ["templateId", "templateName", "template_id", "template_name"],
                ["standardId", "standardName", "standard_id", "standard_name"],
                ["lineTypeId", "lineName", "line_type_id", "line_name"],
            ];

            for (const [idColumn, nameColumn, idKey, nameKey] of names) {
                const hasName = patch.patch[nameKey] !== undefined;
                const hasId = patch.patch[idKey] !== undefined;
                if (!hasName && !hasId) continue;
                if (hasId) {
                    set.push(`"${idColumn}" = $${values.length + 1}`);
                    values.push(patch.patch[idKey]);
                }
            }

            if (set.length) {
                values.push(patch._id);
                await postgres.query(
                    `UPDATE "${mainTable}" SET ${set.join(", ")} WHERE "_id" = $${values.length}`,
                    values,
                );
            }
        }
    };
}

// Normalizuoti string stulpeliai -> lookup lentelių ID (ADP ID neduoda,
// juos generuojam patys, kaip balanso ataskaitų pavadinimai).
const saskaituSalysTipaiCache = new Map();
const saskaituSalysVeiklosVietaCache = new Map();

async function ensureLookupId(postgres, { table, schema, column, cache }, value) {
    if (value == null) return null;
    if (cache.has(value)) return cache.get(value);

    const lentele = schema ? `"${schema}"."${table}"` : `"${table}"`;
    await postgres.query(
        `INSERT INTO ${lentele} ("${column}")
         VALUES ($1) ON CONFLICT ("${column}") DO NOTHING`,
        [value],
    );
    const { rows } = await postgres.query(
        `SELECT id FROM ${lentele} WHERE "${column}" = $1`,
        [value],
    );
    const id = rows[0]?.id ?? null;
    cache.set(value, id);
    return id;
}

const SASKAITU_TIPAI = {
    table: "saskaituSalysTipai",
    schema: "sabis",
    column: "tipas",
    cache: saskaituSalysTipaiCache,
};
const SASKAITU_VEIKLOS_VIETA = {
    table: "saskaituSalysVeiklosVieta",
    schema: "sabis",
    column: "veiklosVieta",
    cache: saskaituSalysVeiklosVietaCache,
};

// "12345" -> 12345; tuščias / ne skaitmenys -> null
function toInt(v) {
    if (v == null || v === "") return null;
    const n = Number.parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
}

async function saskaituSalysBeforeApply({ inserts, patches, postgres }) {
    // Insert'ai: tipas/veiklosVieta string -> ID, validusJarKodas -> int
    for (const row of inserts) {
        row.tipasId = await ensureLookupId(postgres, SASKAITU_TIPAI, row.tipas);
        row.veiklosVietaId = await ensureLookupId(
            postgres,
            SASKAITU_VEIKLOS_VIETA,
            row.veiklosVieta,
        );
        row.validusJarKodas = toInt(row.validusJarKodas);
        delete row.tipas;
        delete row.veiklosVieta;
    }

    // Patch'ai: tipas/veiklos_vieta nėra CONFIG.columns sąraše, tad string -> ID
    // taikom rankiniu būdu; validus_jar_kodas normalizuojam vietoje, o likusį
    // UPDATE'ą atlieka generinis applyPatch (validusJarKodas yra columns sąraše).
    for (const patch of patches) {
        const set = [];
        const values = [];
        if (patch.patch.tipas !== undefined) {
            set.push(`"tipasId" = $${values.length + 1}`);
            values.push(await ensureLookupId(postgres, SASKAITU_TIPAI, patch.patch.tipas));
        }
        if (patch.patch.veiklos_vieta !== undefined) {
            set.push(`"veiklosVietaId" = $${values.length + 1}`);
            values.push(
                await ensureLookupId(
                    postgres,
                    SASKAITU_VEIKLOS_VIETA,
                    patch.patch.veiklos_vieta,
                ),
            );
        }
        if (set.length) {
            values.push(patch._id);
            await postgres.query(
                `UPDATE sabis."saskaituSalys" SET ${set.join(", ")} WHERE "_id" = $${values.length}`,
                values,
            );
        }
        if (patch.patch.validus_jar_kodas !== undefined) {
            patch.patch.validus_jar_kodas = toInt(patch.patch.validus_jar_kodas);
        }
    }
}

// All ADP datasets in one place — add/remove datasets here, not as new task objects
const ADP_DATASETS = [
    {
        name: "syncAdpSaskaitosSalys",
        table: "saskaituSalys",
        schema: "sabis",
        dataset: "datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/SaskaituSalys",
        limit: 1000,
        columns: [
            "_id", "_revision", "id", "sfId", "tipasId",
            "validusAsmensKodas", "validusJarKodas", "kitasKodas", "kitasKodasPaaiskinimas",
            "pavadinimas", "nePvmMoketojas", "veiklosVietaId", "data",
        ],
        beforeApply: saskaituSalysBeforeApply,
        mapping: {
            _id: "_id", _revision: "_revision",
            id: "id", sf_id: "sfId", tipas: "tipas",
            validus_asmens_kodas: "validusAsmensKodas",
            validus_jar_kodas: "validusJarKodas",
            kitas_kodas: "kitasKodas",
            kitas_kodas_paaiskinimas: "kitasKodasPaaiskinimas",
            pavadinimas: "pavadinimas",
            ne_pvm_moketojas: "nePvmMoketojas",
            veiklos_vieta: "veiklosVieta",
            data: "data",
        },
    },
    {
        name: "syncJarFormos",
        table: "formos",
        schema: "rcJar",
        dataset: "datasets/gov/rc/jar/formos_statusai/Forma",
        limit: 1000,
        mapping: {
            _id: "_id", _revision: "_revision",
            kodas: "kodas", pavadinimas: "pavadinimas",
            pav_ilgas: "pavIlgas", name: "name",
            tipas: "tipas", type: "type",
        },
    },
    {
        name: "syncAdpSutartysSalys",
        table: "sutarciuSalys",
        schema: "sabis",
        dataset: "datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/SutarciuSalys",
        limit: 1000,
        mapping: {
            _id: "_id", _revision: "_revision",
            id: "id", sutarties_id: "sutartiesId", tipas: "tipas",
            validus_asmens_kodas: "validusAsmensKodas",
            validus_jar_kodas: "validusJarKodas",
            kitas_kodas: "kitasKodas", pavadinimas: "pavadinimas",
            ne_pvm_moketojas: "nePvmMoketojas",
            veiklos_vieta: "veiklosVieta", data: "data",
        },
    },
    {
        name: "syncAdpSabisSaskaitos",
        table: "saskaitos",
        schema: "sabis",
        dataset: "datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/Saskaitos",
        limit: 1000,
        mapping: {
            _id: "_id", _revision: "_revision",
            id: "id", sf_id: "sfId",
            israsymo_data: "israsymoData", sf_pozymis: "sfPozymis",
            sf_tipas: "sfTipas", sf_numeris: "sfNumeris",
            sutarties_uid: "sutartiesUid", sutarties_numeris: "sutartiesNumeris",
            cpv_kodas: "cpvKodas", cpv_pav: "cpvPav",
            sf_apmokejimo_terminas: "sfApmokejimoTerminas",
            pvm: "pvm", suma_be_pvm: "sumaBePvm",
            suma_pvm: "sumaPvm", bendra_sf_suma: "bendraSfSuma",
            valiuta: "valiuta", sf_busena: "sfBusena",
            sf_buseno_data: "sfBusenoData",
        },
    },
    {
        name: "syncAdpSabisSutartys",
        table: "sutartys",
        schema: "sabis",
        dataset: "datasets/gov/nbfc/viesojo_sektoriaus_saskaitos/Sutartys",
        limit: 500,
        mapping: {
            _id: "_id", _revision: "_revision",
            sutarties_id: "sutartiesId", sutarties_uid: "sutartiesUid",
            vp_id: "vpId", tipas: "tipas",
            sutarties_numeris: "sutartiesNumeris", pavadinimas: "pavadinimas",
            cpv_kodas: "cpvKodas", cpv_pav: "cpvPav",
            sutarties_pasirasymo_data: "sutartiesPasirasymoData",
            sutarties_galiojimo_data: "sutartiesGaliojimoData",
            suma: "suma",
        },
    },
    {
        name: "syncAdpBalansoAtaskaitos",
        table: "balansoEilutes",
        schema: FINANSINES_ATASKAITOS_SCHEMA,
        dataset: "datasets/gov/rc/jar/balanso_ataskaitos/BalansoAtaskaita",
        limit: 2500,
        columns: FINANSINES_ATASKAITOS_COLUMNS,
        beforeApply: finansinesAtaskaitosBeforeApply({
            formos: "balansoFormos",
            standartai: "balansoStandartai",
            eiluciuTipai: "balansoEiluciuTipai",
            mainTable: "balansoEilutes",
        }),
        mapping: {
            _id: "_id",
            "juridinis_asmuo._id": "jarId", "forma._id": "formaId",
            "statusas._id": "statusasId",
            template_id: "templateId", template_name: "templateName",
            standard_id: "standardId", standard_name: "standardName",
            line_type_id: "lineTypeId", line_name: "lineName",
            reiksme: "reiksme",
            laikotarpis_nuo: "laikotarpisNuo", laikotarpis_iki: "laikotarpisIki",
            reg_date: "duomenuData",
        },
    },
    {
        name: "syncAdpGyvenamojiVietove",
        table: "gyvenamosVietoves",
        schema: "geografija",
        dataset: "datasets/gov/rc/ar/gyvenamojivietove/GyvenamojiVietove",
        limit: 1000,
        columns: ["_id", "gyvKodas", "tipas", "tipoSantrumpa", "pavadinimasK", "pavadinimas", "seniunija", "savivaldybe", "gyvNuo", "gyvIki"],
        mapping: {
            _id: "_id", gyv_kodas: "gyvKodas", tipas: "tipas",
            tipo_santrumpa: "tipoSantrumpa", pavadinimas_k: "pavadinimasK",
            pavadinimas: "pavadinimas",
            "seniunija._id": "seniunija", "savivaldybe._id": "savivaldybe",
            gyv_nuo: "gyvNuo", gyv_iki: "gyvIki",
        },
    },
    {
        name: "syncAdpIstatinisKapitalas",
        table: "istatinisKapitalas",
        dataset: "datasets/gov/rc/jar/ja_kapitalas/JuridinisAsmuoKapitalas",
        limit: 1000,
        mapping: {
            _id: "_id",
            "juridinis_asmuo._id": "jarId", "forma._id": "formaId",
            data_nuo: "data", reiksme: "reiksme", valiuta: "valiuta",
        },
    },
    {
        name: "syncAdpJar",
        table: "jar",
        dataset: "datasets/gov/rc/jar/iregistruoti/JuridinisAsmuo",
        limit: 1000,
        mapping: {
            _id: "_id", ja_kodas: "jarKodas", ja_pavadinimas: "pavadinimas",
            pilnas_adresas: "adresas", "adresas._id": "adresasId",
            reg_data: "registravimoData", isreg_data: "isregistravimoData",
            "forma._id": "formaId", "statusas._id": "statusasId",
            stat_data: "statusasData",
        },
    },
    {
        name: "syncAdpMokesciai",
        table: "mokesciai",
        dataset: "datasets/gov/vmi/ja_mokesciai/Moketojas",
        limit: 1000,
        mapping: {
            _id: "_id", id: "id", "mm_kodas._id": "mm_kodas_id",
            jarKodas: "jarKodas", pavadinimas: "pavadinimas",
            tipas: "formosPavadinimas", "apskritis._id": "apskritis",
            "savivaldybe._id": "savivaldybe",
            metai: "metai", menuo: "menuo", suma: "suma",
            atnaujinta: "duomenuData",
        },
    },
    {
        name: "syncAdpPelnoNuostoliuAtaskaitos",
        table: "pelnoNuostoliuEilutes",
        schema: FINANSINES_ATASKAITOS_SCHEMA,
        dataset: "datasets/gov/rc/jar/pelno_ataskaitos/PelnoAtaskaita",
        limit: 1000,
        columns: FINANSINES_ATASKAITOS_COLUMNS,
        beforeApply: finansinesAtaskaitosBeforeApply({
            formos: "pelnoNuostoliuFormos",
            standartai: "pelnoNuostoliuStandartai",
            eiluciuTipai: "pelnoNuostoliuEiluciuTipai",
            mainTable: "pelnoNuostoliuEilutes",
        }),
        mapping: {
            _id: "_id",
            "juridinis_asmuo._id": "jarId", "forma._id": "formaId",
            "statusas._id": "statusasId",
            template_id: "templateId", template_name: "templateName",
            standard_id: "standardId", standard_name: "standardName",
            line_type_id: "lineTypeId", line_name: "lineName",
            reiksme: "reiksme",
            laikotarpis_nuo: "laikotarpisNuo", laikotarpis_iki: "laikotarpisIki",
            reg_date: "duomenuData",
        },
    },
    {
        name: "syncAdpDarboVieta",
        table: "darboVieta",
        dataset: "datasets/gov/uzt/ldv/Vieta",
        limit: 1000,
        mapping: {
            _id: "_id", _revision: "_revision",
            darbo_vietos_id: "darbo_vietos_id", statusas: "statusas",
            ikelimo_data: "ikelimo_data", galioja_nuo: "galioja_nuo",
            galioja_iki: "galioja_iki",
            imones_iregistravimas: "imones_iregistravimas",
            prelim_darbo_uzmokestis: "prelim_darbo_uzmokestis",
            vid_darbo_uzmokestis: "vid_darbo_uzmokestis",
            maks_darbo_uzmokestis: "maks_darbo_uzmokestis",
            valiuta: "valiuta",
            uzmokescio_komentaras_lt: "uzmokescio_komentaras_lt",
            profesijos_pareigybes_pav: "profesijos_pareigybes_pav",
            darbo_aprasymas_lt: "darbo_aprasymas_lt",
            ar_aktuali_siandien: "ar_aktuali_siandien",
            ar_uzpildyta: "ar_uzpildyta",
            ar_papildomai_remia: "ar_papildomai_remia",
            ar_darbina_po_mokymu: "ar_darbina_po_mokymu",
            ar_apmoka_keliones: "ar_apmoka_keliones",
            ar_apgyvendina: "ar_apgyvendina",
            ar_maitina: "ar_maitina",
            pageidaujama_darbo_pradzia: "pageidaujama_darbo_pradzia",
            darbo_vietu_skaicius: "darbo_vietu_skaicius",
            darbo_vietos_adresas: "darbo_vietos_adresas",
            darbo_vietos_sav_pav: "darbo_vietos_sav_pav",
            registravimo_pagrindo_pav: "registravimo_pagrindo_pav",
            registravimo_budo_pav: "registravimo_budo_pav",
            pageidavimo_pateikimo_pav: "pageidavimo_pateikimo_pav",
            rizikos_lt: "rizikos_lt",
            jar_kodas: "jar_kodas", darbdavys: "darbdavys",
            teisinio_statuso_pav: "teisinio_statuso_pav",
            teisines_formos_pav: "teisines_formos_pav",
            darbdavio_bustine: "darbdavio_bustine",
            darbdavio_kontaktinis_asmuo: "darbdavio_kontaktinis_asmuo",
            susisiekimo_budas: "susisiekimo_budas",
            darbdavio_tel_nr: "darbdavio_tel_nr",
            darbdavio_mob_nr: "darbdavio_mob_nr",
            darbdavio_el_pastas: "darbdavio_el_pastas",
            reik_darbo_patirtis: "reik_darbo_patirtis",
            reik_kompetencijos_lt: "reik_kompetencijos_lt",
            reik_gebejimai: "reik_gebejimai",
            reik_issilavinimo_pav: "reik_issilavinimo_pav",
            reik_mok_progr_pav: "reik_mok_progr_pav",
        },
    },
];

export default ADP_DATASETS.map((cfg) => ({
    name: cfg.name,
    mode: "asap",
    priority: 4,
    cooldown: 60,
    errorCooldown: 60,
    job: () => syncAdpChanges(cfg),
}));
