# VPT apjungtos ataskaitos (XLSX)

Viešųjų pirkimų tarnyba vienu XLSX failu pateikia visas tam tikros rūšies
ataskaitas: ATN-1 (antraštės ir atskiri detalių failai), GPPA, koncesijas ir
projekto konkursus. Šis modulis tuos failus perskaito ir **rašo tiesiai** į
schemos `"vptXlsxApjungtosAtaskaitos"` lenteles – tarpinio JSONB sluoksnio nėra,
SQL failų vykdyti nereikia.

Tai atskiras duomenų sluoksnis. `public."xlsxPPA*"` (modules/ppa – ATN-1 iš
pavienių CVP IS failų) ir `public."cvppDumpAtn1*"` (ATN-1 CSV iškrova) lieka
nepaliesti, nors domenas persidengia.

## Naudojimas

1. Schema pritaikoma vieną kartą iš projekto šaknyje esančio
   `vptXlsxApjungtosAtaskaitos1.sql` (vykdo vartotojas). Pritaikius failas
   nebetaisomas – vėlesni pakeitimai rašomi į `…2.sql` ir t. t.
2. XLSX failai sudedami į `modules/vptXlsxApjungtosAtaskaitos/data/`
   (katalogas į git nepatenka).
3. `npm run vptAtaskaitos:importuoti`

Visas importas vyksta vienoje transakcijoje ir yra idempotentiškas: kartojant
kiekiai nesikeičia (upsert'ai pagal domeno natūralius raktus – ataskaitos
`(šeima, šaltinio ID)`, dalies `(ataskaita, dalies numeris)`, dalyvio,
pasiūlymo ir sutarties `(ataskaita, vaiko šaltinio ID)`). Trūkstami failai
praleidžiami.

## Failai

- `importuotiXlsx.js` – CLI ir viso importo eiga.
- `xlsxSkaitymas.js` – workbook'ų skaitymas, lapų ir antraščių apdorojimas.
- `reiksmes.js` – celių konvertavimas (`Taip/Ne/Nežinoma`, datos, skaičiai, BVPŽ).
- `db.js` – schemos konstanta, transakcija, grupiniai upsert'ai, žodynai.
- `kontekstas.js`, `subjektai.js` – importo kešai ir subjektų (party) paieška.
- `ataskaitos.js` – antraštės (submission, procurement_report, concession_report).
- `institucijos.js` – perkančiosios/įgaliotosios organizacijos, projektai, BVPŽ.
- `dalys.js` – pirkimo dalys ir jų BVPŽ kodai.
- `dalyviai.js` – kandidatai, dalyviai, pasiūlymai ir jų atmetimai.
- `baigtys.js` – procedūrų pabaigos, sutartys, transporto priemonių rodikliai.
- `kriterijai.js` – vertinimo kriterijai ir atmetimo žodynai.
- `koncesijos.js` – koncesijoms būdingi lapai.

## Šaltinio ypatumai

Antraštės XLSX faile ilgos ir kartojasi keliais variantais (skirtingos formos
tos pačios ataskaitos), todėl reikšmės imamos per `pirma()` – pirmą užpildytą iš
kelių galimų antraščių. Viena celė gali turėti kelis kableliais atskirtus BVPŽ
kodus ar dalių numerius – jie išskaidomi į atskiras jungiamųjų lentelių eilutes.
