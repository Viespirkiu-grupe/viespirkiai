const clean = (value) => value == null || String(value).trim() === ""
    ? null
    : String(value).trim();

function normalizedRow(row) {
    return Object.fromEntries(
        Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), clean(value)]),
    );
}

function required(value, field, source, lineNumber) {
    const result = clean(value);
    if (result == null) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje nėra ${field}`);
    }
    return result;
}

function integer(value, field, source, lineNumber, isRequired = false) {
    const text = isRequired ? required(value, field, source, lineNumber) : clean(value);
    if (text == null) return null;
    if (!/^-?\d+$/.test(text)) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje ${field} nėra sveikasis skaičius: ${text}`);
    }
    const result = Number(text);
    if (!Number.isSafeInteger(result)) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje ${field} per didelis: ${text}`);
    }
    return result;
}

function decimal(value, field, source, lineNumber) {
    const text = clean(value)?.replace(",", ".");
    if (text == null) return null;
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje ${field} nėra skaičius: ${text}`);
    }
    return text;
}

function date(value, field, source, lineNumber, isRequired = false) {
    const text = isRequired ? required(value, field, source, lineNumber) : clean(value);
    if (text == null) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw new Error(`${source.file}: ${lineNumber} eilutėje netinkama ${field}: ${text}`);
    }
    return text;
}

function commonFinancial(row, source, lineNumber) {
    const old = source.schema === "legacy";
    return {
        ataskaitosTipas: source.ataskaitosTipas,
        jarKodas: integer(row.ja_kodas ?? row.obj_kodas, "ja_kodas", source, lineNumber, true),
        pavadinimas: required(row.ja_pavadinimas ?? row.obj_pav, "ja_pavadinimas", source, lineNumber),
        formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
        formosPavadinimas: row.form_pavadinimas ?? row.form_pav,
        statusoKodas: integer(row.stat_kodas ?? row.stat_statusas, "stat_kodas", source, lineNumber),
        statusoPavadinimas: row.stat_pavadinimas ?? row.stat_pav,
        templateId: required(row.template_id, "template_id", source, lineNumber),
        templateName: row.template_name,
        standardId: required(row.standard_id, "standard_id", source, lineNumber),
        standardName: row.standard_name,
        laikotarpisNuo: date(old ? row.laikotarpis_nuo : row.beginning_date, "laikotarpis_nuo", source, lineNumber, true),
        laikotarpisIki: date(old ? row.laikotarpis_iki : row.turning_date, "laikotarpis_iki", source, lineNumber, true),
        registravimoData: date(row.reg_date, "reg_date", source, lineNumber, true),
        saltinioMetai: source.saltinioMetai,
        formavimoData: date(row.formavimo_data, "formavimo_data", source, lineNumber, true),
    };
}

const LEGACY_BALANCE_LINES = [
    ["nuosavas_kapitalas", "NUOSAVAS_KAPITALAS", "Nuosavas kapitalas"],
    ["mok_sumos_ir_isipareigojimai", "MOKETINOS_SUMOS_IR_ISIPAREIGOJIMAI", "Mokėtinos sumos ir įsipareigojimai"],
    ["ilgalaikis_turtas", "ILGALAIKIS_TURTAS", "Ilgalaikis turtas"],
    ["trumpalaikis_turtas", "TRUMPALAIKIS_TURTAS", "Trumpalaikis turtas"],
];

const LEGACY_PROFIT_LINES = [
    ["pelnas_pries_apmokestinima", "PELNAS_PRIES_APMOKESTINIMA", "Pelnas prieš apmokestinimą"],
    ["grynasis_pelnas", "GRYNASIS_PELNAS", "Grynasis pelnas"],
    ["pardavimo_pajamos", "PARDAVIMO_PAJAMOS", "Pardavimo pajamos"],
];

function mapFinancial(row, source, lineNumber) {
    const common = commonFinancial(row, source, lineNumber);
    if (source.schema === "long") {
        return [{
            ...common,
            lineTypeId: required(row.line_type_id, "line_type_id", source, lineNumber),
            lineName: required(row.line_name, "line_name", source, lineNumber),
            reiksme: decimal(row.reiksme, "reiksme", source, lineNumber),
        }];
    }
    const lines = source.ataskaitosTipas === "BALANSAS"
        ? LEGACY_BALANCE_LINES
        : LEGACY_PROFIT_LINES;
    return lines.map(([field, lineTypeId, lineName]) => ({
        ...common,
        lineTypeId,
        lineName,
        reiksme: decimal(row[field], field, source, lineNumber),
    }));
}

export function mapJarAdditionalRow(rawRow, source, lineNumber = 1) {
    const row = normalizedRow(rawRow);
    // JAR rinkiniai juridinį asmenį vadina `ja_*`, JADIS — `obj_*`.
    const jarKodas = () =>
        integer(row.ja_kodas ?? row.obj_kodas, "ja_kodas", source, lineNumber, true);
    const pavadinimas = () =>
        required(row.ja_pavadinimas ?? row.obj_pav, "ja_pavadinimas", source, lineNumber);
    const formosKodas = () =>
        integer(row.form_kodas, "form_kodas", source, lineNumber);
    const statusoKodas = () =>
        integer(row.stat_kodas ?? row.stat_statusas, "stat_kodas", source, lineNumber);
    // JAR_DOKUMENTAI_2009–2024.csv realiai turi tik 6 stulpelius, nors RC
    // dabartinė struktūros XLSX nurodo ir formavimo_data. Kai jo faile nėra,
    // naudojame importo dieną (nustatomą DB current_date), kad neprimestume
    // dokumento ar registravimo datos kaip tariamos rinkinio formavimo datos.
    const formavimoData = () => date(
        row.formavimo_data ?? (source.kind === "dokumentai"
            ? source.fallbackFormavimoData
            : null),
        "formavimo_data", source, lineNumber, true,
    );

    switch (source.kind) {
        case "finansai":
            return mapFinancial(row, source, lineNumber);
        case "anuliavimai":
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                formosPavadinimas: row.form_pavadinimas,
                statusoKodas: integer(row.stat_kodas, "stat_kodas", source, lineNumber),
                statusoPavadinimas: row.stat_pavadinimas,
                templateId: required(row.template_id, "template_id", source, lineNumber),
                templateName: row.template_name,
                laikotarpisNuo: date(row.beginning_date, "beginning_date", source, lineNumber, true),
                laikotarpisIki: date(row.turning_date, "turning_date", source, lineNumber, true),
                anuliavimoRegistravimoData: date(
                    row.anul_ireg_date ?? row.anul_reg_date,
                    "anul_ireg_date", source, lineNumber, true,
                ),
                formavimoData: formavimoData(),
            }];
        case "velavimai":
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                statusoKodas: integer(row.stat_kodas ?? row.status_kodas, "stat_kodas", source, lineNumber),
                paskutineAtaskaitaIki: date(row.paskutine_fa_iki, "paskutine_fa_iki", source, lineNumber),
                formavimoData: formavimoData(),
            }];
        case "nepateikimai":
            return [{
                jarKodas: jarKodas(),
                nepateiktaUzMetus: integer(row.fa_nepateikta_uz_metus, "fa_nepateikta_uz_metus", source, lineNumber, true),
                pavadinimas: pavadinimas(),
                registravimoData: date(row.ja_reg_data, "ja_reg_data", source, lineNumber),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                statusoKodas: integer(row.stat_kodas, "stat_kodas", source, lineNumber),
                formavimoData: formavimoData(),
            }];
        case "zymos": {
            const isNvo = source.zymosTipas === "NVO";
            return [{
                jarKodas: jarKodas(), zymosTipas: source.zymosTipas,
                pavadinimas: pavadinimas(),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                formosPavadinimas: row.form_pavadinimas,
                statusasNuo: date(
                    isNvo ? row.nvo_nuo : row.paramos_gav_nuo,
                    isNvo ? "nvo_nuo" : "paramos_gav_nuo", source, lineNumber, true,
                ),
                statusasIki: date(
                    isNvo ? row.nvo_iki : row.paramos_gav_iki,
                    isNvo ? "nvo_iki" : "paramos_gav_iki", source, lineNumber,
                    source.intervalas === "pasibaiges",
                ),
                formavimoData: formavimoData(),
            }];
        }
        case "savanoryste":
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                formosPavadinimas: row.form_pav,
                savanoriuSkaicius: integer(row.sav_skaicius, "sav_skaicius", source, lineNumber, true),
                savanorystesValanduSkaicius: integer(row.sav_val_skaicius, "sav_val_skaicius", source, lineNumber, true),
                laikotarpisNuo: date(row.laikotarpis_nuo, "laikotarpis_nuo", source, lineNumber, true),
                laikotarpisIki: date(row.laikotarpis_iki, "laikotarpis_iki", source, lineNumber, true),
                formavimoData: formavimoData(),
            }];
        case "jangis": {
            const pateiktas = integer(row.ar_pateiktas_ng_sarasas, "ar_pateiktas_ng_sarasas", source, lineNumber, true);
            if (pateiktas !== 0 && pateiktas !== 1) {
                throw new Error(`${source.file}: ${lineNumber} eilutėje ar_pateiktas_ng_sarasas turi būti 0 arba 1`);
            }
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                registravimoData: date(row.ja_reg_data, "ja_reg_data", source, lineNumber),
                formosKodas: integer(row.form_kodas, "form_kodas", source, lineNumber),
                formosPavadinimas: row.form_pavadinimas,
                statusoKodas: integer(row.stat_kodas, "stat_kodas", source, lineNumber),
                statusoPavadinimas: row.stat_pavadinimas,
                sarasasPateiktas: pateiktas === 1,
                sarasoBusena: clean(row.saraso_busena),
                sarasoPateikimoData: date(row.saraso_pateikimo_data, "saraso_pateikimo_data", source, lineNumber),
                formavimoData: formavimoData(),
            }];
        }
        case "dokumentai":
            return [{
                jarKodas: jarKodas(),
                dokumentoTipas: integer(row.dokt_tipas, "dokt_tipas", source, lineNumber, true),
                dokumentoPotipis: integer(row.dokp_potipis, "dokp_potipis", source, lineNumber),
                dokumentoPotipioPavadinimas: row.dokp_pav,
                dokumentoData: date(row.dok_data, "dok_data", source, lineNumber),
                dokumentoRegistravimoData: date(row.dok_reg_data, "dok_reg_data", source, lineNumber, true),
                formavimoData: formavimoData(),
            }];
        case "jadisSarasai": {
            const pateiktas = integer(row.pateikimo_poz, "pateikimo_poz", source, lineNumber, true);
            if (pateiktas !== 0 && pateiktas !== 1) {
                throw new Error(`${source.file}: ${lineNumber} eilutėje pateikimo_poz turi būti 0 arba 1`);
            }
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: formosKodas(), formosPavadinimas: row.form_pav_i,
                statusoKodas: statusoKodas(), statusoPavadinimas: row.stat_pav_i,
                registravimoData: date(row.ja_reg_data, "ja_reg_data", source, lineNumber),
                sarasasPateiktas: pateiktas === 1,
                sarasoData: date(row.saraso_data, "saraso_data", source, lineNumber),
                formavimoData: formavimoData(),
            }];
        }
        case "jadisDalyviai":
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: formosKodas(), formosPavadinimas: row.form_pav_i,
                statusoKodas: statusoKodas(), statusoPavadinimas: row.stat_pav_i,
                // Tušti stulpeliai reiškia, kad tos rūšies dalyvių nėra.
                lrFiziniai: integer(row.lr_fiziniai, "lr_fiziniai", source, lineNumber) ?? 0,
                lrJuridiniai: integer(row.lr_juridiniai, "lr_juridiniai", source, lineNumber) ?? 0,
                uzsienioFiziniai: integer(row.uzsienio_fiziniai, "uzsienio_fiziniai", source, lineNumber) ?? 0,
                uzsienioJuridiniai: integer(row.uzsienio_juridiniai, "uzsienio_juridiniai", source, lineNumber) ?? 0,
                formavimoData: formavimoData(),
            }];
        case "jadisValstybe":
            return [{
                jarKodas: jarKodas(), pavadinimas: pavadinimas(),
                formosKodas: formosKodas(), formosPavadinimas: row.form_pav_i,
                statusoKodas: statusoKodas(), statusoPavadinimas: row.stat_pav_i,
                registravimoData: date(row.ja_reg_data, "ja_reg_data", source, lineNumber),
                njaKodas: integer(row.nja_kodas, "nja_kodas", source, lineNumber, true),
                njaPavadinimas: required(row.nja_pavadinimas, "nja_pavadinimas", source, lineNumber),
                // RC struktūroje `dal_dalys` vadinama procentais, bet faile tai
                // dalis nuo 0 iki 1 (1 = 100 %). Saugome tokią, kokia yra.
                dalis: decimal(row.dal_dalys, "dal_dalys", source, lineNumber),
                formavimoData: formavimoData(),
            }];
        default:
            throw new Error(`Nežinomas RC rinkinys: ${source.kind}`);
    }
}

