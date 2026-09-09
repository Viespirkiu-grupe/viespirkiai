# Duomenų bazės lentelių dokumentacija (`/duomenys/lenteles`)

Viešas puslapių rinkinys, generuojamas **tiesiai iš gyvo Postgres katalogo**:
visos lentelės, jų stulpeliai, ryšiai, indeksai, dydžiai ir aprašymai,
sugrupuoti **pagal schemą**, su ER diagramomis ir nuoroda į juos rašantį kodą.

## Kur kas gyvena

| Duomuo | Vieta | Kodėl ten |
|---|---|---|
| Lentelės / stulpelio **prasmė** | `COMMENT ON` pačioje DB | Matoma `psql \d+`, `pg_dump`, MCP `get_schema` — ne tik šiame puslapyje |
| Schemos **prasmė** | `COMMENT ON SCHEMA` | Ten pat, kur ir lentelių prasmė |
| **Grupavimas** | pati schema | Lentelė guli schemoje; antro sąrašo, kuris tą pakartotų, nereikia |
| Schemos pavadinimas ir šaltinis | `dba."schemos"` | Lietuviškas vardas ir nuoroda į šaltinį į komentarą netelpa |
| Lentelės šaltinis, atnaujinimo būdas, rašantis kodas | `dba."lenteles"` | Netelpa į komentarą; atskira schema, kad `public` neaugtų |
| Struktūra (stulpeliai, FK, indeksai) | `pg_catalog` | Vienintelis tiesos šaltinis; nieko dubliuoti nereikia |
| Versijavimas | `dbSchema/*.sql` per `npm run db:schema:dump` | **Dėmesio:** `dbSchema/` yra `.gitignore`'e (54 eil.), tad į git komentarai nepatenka |

## Grupavimas: grupė yra schema

Lentelė rodoma toje grupėje, kurios schemoje ji guli — jokių taisyklių, jokio
rankinio priskyrimo, jokios „Nesugrupuota“ pseudo-grupės. Adresas:
`/duomenys/lenteles/<schema>/<lentelė>`.

Taip buvo ne visada. Iki 2026 m. rugsėjo grupė buvo atskira sąvoka:
`dba."grupiuTaisykles"` laikė ~60 `prefiksas → grupė` taisyklių, nes anksčiau
beveik viskas gyveno `public` schemoje ir vardo prefiksas buvo vienintelis
namespace. Perkėlus 400+ lentelių į savas schemas taisyklės liko dubliuoti tai,
ką bazė ir taip pasako, ir kartu klydo: taisyklė lygina **tik lentelės vardą**,
tad `adresuRegistras."adresai"` ar `eTar` lentelės jokio prefikso neatitikdavo
ir **119 lentelių likdavo nesugrupuotos**. Perėjimą atlieka
`migrations/dba/001_schemos.sql`.

## Schema `dba`

Sukuriama `dbaSchema.sql`, grupavimo dalis perdaryta
`migrations/dba/001_schemos.sql` (visus taiko vartotojas).

- `dba."schemos"` — schemos rodymo kortelė: `pavadinimas`, `saltinis`,
  `saltinioUrl`, `tvarka`. Raktas yra pats schemos vardas, jis ir URL segmentas.
  **Įrašas neprivalomas:** be jo schema rodoma savo vardu ir stoja į sąrašo galą
  (`tvarka = 500`). Aprašymo čia nėra — jis imamas iš `COMMENT ON SCHEMA`.
- `dba."atnaujinimoBudai"`, `dba."busenos"` — žodynai.
- `dba."lenteles"` — rankinė kortelė: šaltinis, užduotys, moduliai, komandos.
  Lentelės `saltinis` nugali schemos šaltinį.

Atšaukimas: `DROP SCHEMA dba CASCADE;` — `public` neliečiamas, o puslapis
lieka veikti: schemos tiesiog vadinsis savo vardais.

## Kodas

| Failas | Atsakomybė |
|---|---|
| `src/lib/dbSchema/uzklausos.ts` | 7 katalogo užklausos visai bazei iš karto |
| `src/lib/dbSchema/meta.ts` | `dba` skaitymas; atsparus tam, kad schemos dar nėra |
| `src/lib/dbSchema/modelis.ts` | Modelio sulipdymas, TTL kešas, `kaimynyste()`, `rasti()` |
| `src/lib/dbSchema/schemos.ts` | URL formavimas (grupavimo logikos nebėra) |
| `src/lib/dbSchema/erDiagrama.ts` | Deterministinis SVG išdėstymas |
| `src/lib/dbSchema/formatavimas.ts` | Dydžiai, tipų trumpiniai, nuorodos į kodą |
| `modules/statistika/lenteliuDydziai.js` | Dydžių užklausa, bendra su `/statistika` |

Užklausos daromos **kartą visai bazei**, o ne po vieną lentelei. Šalta krova
~150 ms, iš kešo ~1 ms.

Kešavimas (`modelis.ts`):

| Kas | TTL | Kodėl toks |
|---|---|---|
| Sėkmingas modelis | 2 min. | 150 ms krova = ~0,1 % apkrovos; ilgesnis TTL tik didintų pasenimą |
| Modelis su `metaKlaida` | 30 s | Pritaikius `dbaSchema.sql` puslapis atsigauna pats, nelaukiant pilno TTL |
| Nepavykusi krova | nekešuojama | Kitas užklausėjas bando iš naujo |
| Puslapiai (`Cache-Control`) | 60 s | Kad naršyklės kešas nesidėtų ant modelio TTL |
| `schema.json`, `er.svg` | 300 s | Mašininiai atsakymai, retai atidaromi rankomis |

Lygiagretūs krovimai sujungiami: kol `promise` neišsisprendęs, visi užklausėjai
gauna tą patį, tad 50 vienalaikių lankytojų duoda vieną DB krovą, ne 50.
Naudojamas savas įrašas, o ne `utils/ttlPromiseCache.js`, nes pastarojo TTL
fiksuotas, o čia jis priklauso nuo rezultato.

**Sauga:** lentelės vardas iš URL niekada nepatenka į SQL — jis tik ieškomas jau
įkeltame modelyje (`pagalRakta`), nerastas duoda peradresavimą.

`/duomenys/lenteles/l/<vardas>` leidžia linkinti žinant tik lentelės vardą, be
schemos. `rasti()` tokį vardą priima tik jei jis visoje bazėje vienintelis: apie
25 vardai kartojasi (`sutartys` yra ir `sabis`, ir `vpmSutartys`), ir spėti už
lankytoją būtų blogiau nei nuvesti į sąrašą.

## ER diagramos

Serveryje generuojamas SVG, be kliento bibliotekų. Išdėstymas – Sugiyama
sluoksniais (`erIsdestymas.ts`), piešimas – `erDiagrama.ts`.

Trys dalykai, be kurių diagrama buvo neskaitoma (visi turi regresijos testus):

1. **Ciklai.** Gylį skaičiuojant „taikinys + 1“, ciklas kelia jį kas iteraciją.
   Vienas `vpmSutartys."sutartys" ↔ "search"` ciklas išpūtė `sutartys` grupės
   drobę iki **7230 px**. Dabar pirma DFS'u sudaromas DAG, o ciklą uždarančios
   briaunos į gylį neįskaitomos (bet piešiamos, pažymėtos `er-edge--atgal`).
2. **Ilgos briaunos.** Briauna, peršokanti kelis sluoksnius, buvo brėžiama
   tiesiai per viską, kas pakeliui – `eTar` schemoje **33 briaunos iš 36 kirto
   dėžutes**. Dabar tokioms briaunoms įterpiami tarpiniai (dummy) mazgai.
   Svarbu: tarpinis mazgas rezervuoja **visą sluoksnio juostos plotį**, ne tašką –
   kitaip briauna vis tiek kirstų to sluoksnio dėžutes.
3. **Susikirtimai.** Mazgų tvarka sluoksnyje renkama barycentro metodu (šešios
   eigos pirmyn ir atgal), pasiliekant variantą su mažiausiai susikirtimų.

Papildomai:

- **Sutraukimas.** Ilgiausio kelio sluoksniavimas nustumia visus žodynus į kairį
  kraštą, nors dauguma jų naudojami vieno mazgo – briaunos driekiasi per visą
  drobę. Po sluoksniavimo kiekvienas mazgas pastumiamas kiek įmanoma į dešinę,
  į sluoksnį prieš arčiausią jį naudojantį. `etar` aukštis nuo 782 iki 626 px.
- **Izoliuotos lentelės** (be jokių išorinių raktų) į grafą neįtraukiamos – jos
  dedamos į tinklelį apačioje. Kitaip `adresuRegistras` schemos 12 lentelių virsdavo
  926 px ilgio vienu stulpeliu.

Rezultatas visoms schemoms: **225 briaunos, 0 kirtimų per dėžutes.**

Sigma.js (`src/graph-bundle.ts`) sąmoningai nenaudotas: tai force-atlas grafas
neaiškios struktūros tinklui, kurio išdėstymas kaskart kitoks, tad nuoroda
nepasidalinama. Mermaid – nauja ~1 MB priklausomybė be išdėstymo kontrolės.

Režimai: `?rezimas=kompaktinis` (tik dėžutės) įsijungia automatiškai virš 25
lentelių; `?rezimas=pilnas` priverstinai rodo stulpelius. Atskiras
`/duomenys/lenteles/<schema>/er.svg` turi savo temos stilių – naršyklė tokį failą
zoom'ina pati.

## Pagalbiniai skriptai

```
npm run db:schema:dump          # katalogas -> dbSchema/*.sql (su COMMENT ON)
npm run db:schema:komentarai    # kiek ir kurios lentelės dar neaprašytos
npm run db:schema:rasytojai     # aptinka rašantį kodą -> UPSERT SQL į stdout
```

`db:schema:rasytojai` skenuoja tik **rašymo** raštus (`INSERT INTO`, `UPDATE`,
`COPY`, `DELETE FROM`) prie literalinio lentelės vardo; `SELECT` ignoruojamas,
kitaip pasirodytų, kad į `jar` rašo pusė projekto. Sugeneruotas `UPSERT` turi
`WHERE "aptiktaAutomatiskai"`, tad rankinio darbo niekada neperrašo.

Skenuojamos **visos nesisteminės schemos**, ne tik `public`. `public` lentelėms
schemos prefiksas užklausoje neprivalomas, kitoms — privalomas: nekvalifikuotas
`INSERT INTO "adresai"` iš tikrųjų taikytųsi į `public."adresai"`, o ne į
`adresuRegistras."adresai"`.

Ko neaptinka (rašoma ranka): dinaminiai vardai `INSERT INTO "${lentele}"`
(išvardijami stderr'e), vienkartinių importų dažnis, ir, savaime suprantama,
lentelės prasmė.

## Šablonai aprašymams

```
npm run db:schema:komentarai -- --sql eTar --top 10 --stulpeliai
```

Išveda tuščius `COMMENT ON ... IS '';` blankus, surikiuotus pagal lentelės dydį.
Užpildžius — naujas failas projekto šaknyje (`lenteliuKomentarai2.sql` ir t. t.),
taiko vartotojas. **Jau pritaikyto SQL failo netaisyti.**
