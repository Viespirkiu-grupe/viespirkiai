import { describe, expect, it } from "vitest";
import { classifyJarAdditionalFiles } from "../modules/juridiniai/jarPapildomiDataSources.js";
import {
    mapJarAdditionalRow,
    metadataUnchanged,
} from "../modules/juridiniai/importJarPapildomiDuomenys.js";

const entry = (file: string) => ({ file, name: file, url: `https://example.test/${file}` });

describe("RC papildomų JAR rinkinių atradimas", () => {
    it("2023 metams pasirenka papildytą ilgo formato finansų failą", () => {
        const sources = classifyJarAdditionalFiles([
            entry("JAR_FA_RODIKLIAI_BLNS_2023.csv"),
            entry("JAR_FA_RODIKLIAI_BLNS_2023_n.csv"),
            entry("JAR_FA_RODIKLIAI_PLNA_2022.csv"),
        ]);
        expect(sources.map((source) => source.file)).toEqual([
            "JAR_FA_RODIKLIAI_BLNS_2023_n.csv",
            "JAR_FA_RODIKLIAI_PLNA_2022.csv",
        ]);
    });

    it("atpažįsta visus ne finansinius rinkinius", () => {
        const sources = classifyJarAdditionalFiles([
            entry("JA_FA_ANULIUOTI.csv"),
            entry("JAR_FA_VELUOJANTIS.csv"),
            entry("JAR_NEPATEIKE_FA_UZ_PRAEJUSIUS.csv"),
            entry("JAR_NVO_NUO.csv"),
            entry("JAR_PARAMOS_GAV_IKI.csv"),
            entry("jar_sav_teikimas.csv"),
            entry("jangis_sar_teikimas.csv"),
            entry("JAR_DOKUMENTAI_NUO_2025.csv"),
        ]);
        expect(new Set(sources.map((source) => source.kind))).toEqual(new Set([
            "anuliavimai", "velavimai", "nepateikimai", "zymos",
            "savanoryste", "jangis", "dokumentai",
        ]));
    });

    it("atpažįsta JADIS rinkinius", () => {
        const sources = classifyJarAdditionalFiles([
            entry("jadis_ad_dalyviu_sarasai.csv"),
            entry("jadis_ad_ja_dalyviai.csv"),
            entry("jadis_ad_nja_dalyviai.csv"),
        ]);
        expect(sources.map((source) => source.kind)).toEqual([
            "jadisSarasai", "jadisDalyviai", "jadisValstybe",
        ]);
    });
});

describe("RC papildomų JAR CSV eilučių transformacijos", () => {
    it("naują balanso eilutę paverčia ataskaita ir rodikliu", () => {
        const source = {
            file: "JAR_FA_RODIKLIAI_BLNS_2026_n.csv",
            kind: "finansai",
            schema: "long",
            ataskaitosTipas: "BALANSAS",
            saltinioMetai: 2026,
        };
        expect(mapJarAdditionalRow({
            ja_kodas: "110004884", ja_pavadinimas: "UAB Testas",
            form_kodas: "310", form_pavadinimas: "UAB", stat_kodas: "0",
            stat_pavadinimas: "Statusas", template_id: "FS0818",
            template_name: "Rinkinys", standard_id: "BST210",
            standard_name: "Balansas", line_type_id: "BSLT00001",
            line_name: "ILGALAIKIS TURTAS", reiksme: "41322265",
            beginning_date: "2025-01-01", turning_date: "2025-12-31",
            reg_date: "2026-05-28", formavimo_data: "2026-08-14",
        }, source)[0]).toMatchObject({
            jarKodas: 110004884,
            ataskaitosTipas: "BALANSAS",
            lineTypeId: "BSLT00001",
            reiksme: "41322265",
        });
    });

    it("seną pelno ataskaitą išskleidžia į tris rodiklius", () => {
        const source = {
            file: "JAR_FA_RODIKLIAI_PLNA_2022.csv",
            kind: "finansai",
            schema: "legacy",
            ataskaitosTipas: "PELNO_NUOSTOLIU",
            saltinioMetai: 2022,
        };
        const rows = mapJarAdditionalRow({
            obj_kodas: "110003978", obj_pav: "UAB Testas", form_kodas: "310",
            stat_statusas: "0", template_id: "FS0229", template_name: "Rinkinys",
            standard_id: "IST024", standard_name: "Pelno ataskaita",
            laikotarpis_nuo: "2021-01-01", laikotarpis_iki: "2021-12-31",
            reg_date: "2022-05-24", pelnas_pries_apmokestinima: "15420",
            grynasis_pelnas: "13104", pardavimo_pajamos: "65196",
            formavimo_data: "2024-10-03",
        }, source);
        expect(rows.map((row: any) => row.lineTypeId)).toEqual([
            "PELNAS_PRIES_APMOKESTINIMA", "GRYNASIS_PELNAS", "PARDAVIMO_PAJAMOS",
        ]);
    });

    it("JANGIS 0/1 požymį paverčia boolean", () => {
        const source = { file: "jangis_sar_teikimas.csv", kind: "jangis" };
        expect(mapJarAdditionalRow({
            ja_kodas: "300620997", ja_pavadinimas: "UAB Testas",
            ar_pateiktas_ng_sarasas: "0", formavimo_data: "2026-08-14",
        }, source)[0]).toMatchObject({
            sarasasPateiktas: false,
            sarasoBusena: null,
        });
    });

    it("JADIS dalyvių sąrašo požymį paverčia boolean", () => {
        const source = { file: "jadis_ad_dalyviu_sarasai.csv", kind: "jadisSarasai" };
        expect(mapJarAdditionalRow({
            obj_kodas: "307481653", obj_pav: "UAB Aftermoon horizon",
            form_kodas: "310", form_pav_i: "Uždaroji akcinė bendrovė",
            stat_statusas: "0", stat_pav_i: "Teisinis statusas neįregistruotas",
            ja_reg_data: "2025-10-23", pateikimo_poz: "1",
            saraso_data: "2026-03-17", formavimo_data: "2026-08-01",
        }, source)[0]).toMatchObject({
            jarKodas: 307481653,
            formosKodas: 310,
            statusoKodas: 0,
            sarasasPateiktas: true,
            sarasoData: "2026-03-17",
        });
    });

    it("JADIS tuščius dalyvių skaičius laiko nuliais", () => {
        const source = { file: "jadis_ad_ja_dalyviai.csv", kind: "jadisDalyviai" };
        expect(mapJarAdditionalRow({
            obj_kodas: "304220986", obj_pav: 'UAB "Localus"', form_kodas: "310",
            form_pav_i: "Uždaroji akcinė bendrovė", stat_statusas: "0",
            stat_pav_i: "Teisinis statusas neįregistruotas", lr_fiziniai: "1",
            lr_juridiniai: "", uzsienio_fiziniai: "", uzsienio_juridiniai: "",
            formavimo_data: "2026-08-01",
        }, source)[0]).toMatchObject({
            jarKodas: 304220986,
            lrFiziniai: 1,
            lrJuridiniai: 0,
            uzsienioFiziniai: 0,
            uzsienioJuridiniai: 0,
        });
    });

    it("JADIS valstybės dalyvio dalį palieka nuo 0 iki 1", () => {
        const source = { file: "jadis_ad_nja_dalyviai.csv", kind: "jadisValstybe" };
        expect(mapJarAdditionalRow({
            obj_kodas: "181705485", obj_pav: 'Uždaroji akcinė bendrovė "VAATC"',
            form_kodas: "310", form_pav_i: "Uždaroji akcinė bendrovė",
            stat_statusas: "0", stat_pav_i: "Teisinis statusas neįregistruotas",
            ja_reg_data: "2003-04-28", nja_kodas: "111104987",
            nja_pavadinimas: "Vilniaus rajono savivaldybė",
            dal_dalys: "0.068764334010671", formavimo_data: "2026-08-01",
        }, source)[0]).toMatchObject({
            jarKodas: 181705485,
            njaKodas: 111104987,
            njaPavadinimas: "Vilniaus rajono savivaldybė",
            dalis: "0.068764334010671",
        });
    });

    it("seniems dokumentų failams be formavimo_data naudoja importo dieną", () => {
        const source = {
            file: "JAR_DOKUMENTAI_2009.csv",
            kind: "dokumentai",
            saltinioMetai: 2009,
            fallbackFormavimoData: "2026-08-16",
        };
        expect(mapJarAdditionalRow({
            JA_kodas: "302470037", dokt_tipas: "1", dokp_potipis: "1",
            dokp_pav: "Įstatai", dok_data: "2009-12-23",
            dok_reg_data: "2009-12-31",
        }, source)[0]).toMatchObject({
            jarKodas: 302470037,
            dokumentoRegistravimoData: "2009-12-31",
            formavimoData: "2026-08-16",
        });
    });
});

describe("RC papildomų JAR failų pakeitimo tikrinimas", () => {
    it("naudoja ETag, o jo nesant Last-Modified ir dydį", () => {
        expect(metadataUnchanged({ etag: '"a"' }, { etag: '"a"' })).toBe(true);
        expect(metadataUnchanged(
            { lastModified: "2026-08-14T00:00:00Z", size: "10" },
            { lastModified: "Fri, 14 Aug 2026 00:00:00 GMT", size: 10 },
        )).toBe(true);
    });
});
