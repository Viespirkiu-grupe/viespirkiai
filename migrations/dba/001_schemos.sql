-- Grupavimą pagal vardų prefiksus keičiam į schemas (2026-09).
--
-- `dba."grupiuTaisykles"` laikė ~60 `prefiksas → grupė` taisyklių, o
-- `dba."lenteles".grupeId` – rankines išimtis. Mechanizmas iš laikų, kai beveik
-- viskas gyveno `public` schemoje ir vardo prefiksas buvo vienintelis
-- namespace. Perkėlus 400+ lentelių į savas schemas jis liko dubliuoti tai, ką
-- katalogas ir taip pasako, ir kartu klydo: taisyklė lygina tik lentelės vardą,
-- ne schemą, tad `adresuRegistras."adresai"` ar `eTar` lentelės jokio prefikso
-- neatitikdavo ir 119 lentelių likdavo „Nesugrupuotos“.
--
-- Nuo šiol grupė = schema; `/duomenys/lenteles/<schema>/<lentelė>`.
--
-- Perkėlimas švarus: patikrinta, kad nė viena schema neturi lentelių iš dviejų
-- skirtingų senų grupių, tad kiekvienos schemos pavadinimas ir šaltinis paimtas
-- iš vienintelės ją dengusios grupės. Ten, kur viena grupė dengė kelias schemas
-- (Teismai, Juridiniai asmenys, CVPP, Adresai), pavadinimas patikslintas, kad
-- schemų sąraše nesikartotų. 19 schemų, kurios grupės neturėjo (jos ir sudarė
-- tas 119 nesugrupuotų lentelių), pavadintos pirmą kartą.
--
-- `dba."schemos"` laiko tik tai, ko katalogas nepasako: lietuvišką pavadinimą,
-- šaltinį ir rodymo tvarką. Aprašymas imamas iš `COMMENT ON SCHEMA`, kaip ir
-- lentelių prasmė – iš `COMMENT ON TABLE`.
--
-- Įrašas neprivalomas: schema be jo rodoma savo vardu ir stoja į sąrašo galą
-- (`tvarka = 500`), tad eilutę galima drąsiai ištrinti. Puslapis veikia ir
-- visai be `dba` schemos – tada vardais vadinasi visos.
--
-- Kodas: src/lib/dbSchema/{schemos,meta,modelis}.ts, docs/dba-spec.md.

BEGIN;

CREATE TABLE dba."schemos" (
    "schema"      text PRIMARY KEY,
    "pavadinimas" text NOT NULL,
    "saltinis"    text,
    "saltinioUrl" text,
    "tvarka"      integer NOT NULL DEFAULT 500
);

COMMENT ON TABLE dba."schemos" IS 'Schemų rodymo metaduomenys /duomenys/lenteles puslapiui: lietuviškas pavadinimas, šaltinis ir tvarka. Aprašymas gyvena COMMENT ON SCHEMA, ne čia.';
COMMENT ON COLUMN dba."schemos"."schema" IS 'Postgres schemos vardas; kartu ir URL segmentas.';
COMMENT ON COLUMN dba."schemos"."pavadinimas" IS 'Rodomas pavadinimas. Nesant įrašo rodomas pats schemos vardas.';
COMMENT ON COLUMN dba."schemos"."tvarka" IS 'Rikiavimas sąraše; mažesnis – aukščiau. Dalykinės schemos 10-300, sisteminės 900+.';

INSERT INTO dba."schemos" ("schema", "pavadinimas", "saltinis", "saltinioUrl", "tvarka") VALUES
    ('eppsViesiejiPirkimai',       'Viešieji pirkimai (EPPS)',        'Viešųjų pirkimų tarnyba / CVP IS',   'https://viesiejipirkimai.lt', 10),
    ('eppsPlanuojamiPirkimai',     'Planuojami pirkimai',             'Viešųjų pirkimų tarnyba',            NULL, 15),
    ('vpmSutartys',                'Sutartys',                        'Viešųjų pirkimų tarnyba',            'https://vpt.lrv.lt/lt/statistika-ir-analize/pirkimu-ir-sutarciu-duomenys-1/sutarciu-duomenys/', 20),
    ('cvpp',                       'CVPP skelbimai',                  'Viešųjų pirkimų tarnyba',            'https://cvpp.eviesiejipirkimai.lt/', 30),
    ('cvppDump',                   'CVPP viešos iškrovos (ATN-1)',    'Viešųjų pirkimų tarnyba',            'https://cvpp.eviesiejipirkimai.lt/', 35),
    ('ppa',                        'PPA ataskaitos (XLSX)',           'Viešųjų pirkimų tarnyba',            NULL, 40),
    ('vptXlsxApjungtosAtaskaitos', 'VPT apjungtos ataskaitos (XLSX)', 'Viešųjų pirkimų tarnyba',            'https://vpt.lrv.lt/', 45),
    ('mvpAprasai',                 'Mažos vertės pirkimų tvarkos',    'Viešųjų pirkimų tarnyba',            'https://mw.eviesiejipirkimai.lt/', 50),
    ('neskelbiamosDerybos',        'Neskelbiamos derybos',            'Viešųjų pirkimų tarnyba',            NULL, 55),
    ('vptJuodiejiSarasai',         'Nepatikimi tiekėjai',             'Viešųjų pirkimų tarnyba',            'https://vpt.lrv.lt/lt/nuorodos/kiti-duomenys/powerbi/nepatikimi-tiekejai-1/', 60),
    ('ted',                        'TED',                             'ES oficialiojo leidinio priedas',    'https://ted.europa.eu/', 70),
    ('cpva',                       'ES investicijos 2021–2027',       'CPVA',                               'https://2021.esinvesticijos.lt/', 80),
    ('2014esInvesticijos',         'ES investicijos 2014–2020',       'ES investicijos',                    'https://2014.esinvesticijos.lt/', 85),
    ('bvpz',                       'BVPŽ (CPV) kodai',                'Europos Komisija',                   NULL, 100),
    ('eTar',                       'e-TAR',                           'Registrų centras / e-TAR',           'https://www.e-tar.lt/', 110),
    ('eSeimas',                    'e-Seimas',                        'LR Seimas',                          'https://e-seimas.lrs.lt/', 120),
    ('liteko',                     'Teismai (LITEKO)',                'Nacionalinė teismų administracija',  'https://liteko.teismai.lt/', 130),
    ('liteko2',                    'Teismai (LITEKO 2)',              'Nacionalinė teismų administracija',  'https://liteko.teismai.lt/', 135),
    ('juridiniai',                 'Juridiniai asmenys',              'Registrų centras',                   'https://data.gov.lt/datasets/1484/', 140),
    ('rcJar',                      'JAR atviri duomenys',             'Registrų centras',                   'https://data.gov.lt/datasets/1484/', 142),
    ('jadis',                      'JADIS dalyviai',                  'Registrų centras',                   'https://data.gov.lt/datasets/1484/', 144),
    ('adpFinansinesAtaskaitos',    'Finansinės ataskaitos',           'Registrų centras',                   'https://data.gov.lt/datasets/1806/', 150),
    ('vmi',                        'VMI mokesčiai',                   'VMI per data.gov.lt',                'https://data.gov.lt/', 155),
    ('sodra',                      'SODRA',                           'Atvira SODRA',                       'https://atvira.sodra.lt/imones/rinkiniai/index.html', 160),
    ('uzt',                        'Užimtumo tarnyba',                'Užimtumo tarnyba',                   'https://data.gov.lt/datasets/2894/', 170),
    ('vdi',                        'VDI',                             'Valstybinė darbo inspekcija',        'https://data.gov.lt/datasets/2894/', 175),
    ('pinreg',                     'Privatūs interesai (PINREG)',     'VTEK',                               'https://pinreg.vtek.lt/app/deklaraciju-paieska', 180),
    ('kotis',                      'Valstybės pagalba (KOTIS)',       'Konkurencijos taryba',               'https://kotis.kt.gov.lt/', 185),
    ('sabis',                      'SABIS',                           'SABIS',                              NULL, 190),
    ('regitra',                    'Regitra',                         'Regitra',                            'https://www.regitra.lt/imone/atviri-duomenys/', 200),
    ('adresuRegistras',            'Adresų registras',                'Registrų centras',                   NULL, 210),
    ('geografija',                 'Geografija ir teritorijos',       'Registrų centras',                   NULL, 215),
    ('domenai',                    'Domenai',                         NULL,                                 NULL, 220),
    ('rcInformaciniaiPranesimai',  'RC informaciniai pranešimai',     'Registrų centras',                   'https://www.registrucentras.lt/jar/infleid/', 230),
    ('adp',                        'Atvirų duomenų platforma',        'data.gov.lt',                        'https://data.gov.lt/', 240),
    ('files',                      'Failai',                          NULL,                                 NULL, 250),
    ('documents',                  'Dokumentai',                      NULL,                                 NULL, 255),
    ('viespirkiai',                'Svetainės turinys',               NULL,                                 NULL, 260),
    ('risk',                       'Rizikos rodikliai',               NULL,                                 NULL, 270),
    ('infra',                      'Nuskaitymo infrastruktūra',       NULL,                                 NULL, 900),
    ('quickwit',                   'Quickwit indeksai',               NULL,                                 NULL, 902),
    ('searchSuggestion',           'Paieškos pasiūlymai',             NULL,                                 NULL, 904),
    ('ai',                         'DI konfigūracija',                NULL,                                 NULL, 906),
    ('auth',                       'Autentifikacija',                 NULL,                                 NULL, 908),
    ('monitoring',                 'Stebėsena',                       NULL,                                 NULL, 910),
    ('mcp',                        'MCP žurnalas',                    NULL,                                 NULL, 912),
    ('dba',                        'Dokumentacija (dba)',             NULL,                                 NULL, 914),
    ('public',                     'public (PostGIS)',                NULL,                                 NULL, 990);

-- Aprašymai schemoms, kurios `COMMENT ON SCHEMA` dar neturi. Užpildyti ir taikyti;
-- tuščios eilutės palikti nereikia — puslapis be aprašymo veikia.
COMMENT ON SCHEMA "domenai" IS '';
COMMENT ON SCHEMA "eTar" IS '';
COMMENT ON SCHEMA "eppsPlanuojamiPirkimai" IS '';
COMMENT ON SCHEMA "kotis" IS '';
COMMENT ON SCHEMA "liteko" IS '';
COMMENT ON SCHEMA "liteko2" IS '';
COMMENT ON SCHEMA "risk" IS '';
COMMENT ON SCHEMA "vdi" IS '';
COMMENT ON SCHEMA "viespirkiai" IS '';
COMMENT ON SCHEMA "vptXlsxApjungtosAtaskaitos" IS '';

-- Senasis grupavimas.
ALTER TABLE dba."lenteles" DROP COLUMN "grupeId";
DROP TABLE dba."grupiuTaisykles";
DROP TABLE dba."grupes";

COMMIT;
