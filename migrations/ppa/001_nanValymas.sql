-- PPA ataskaitų „NaN" reikšmių valymas.
--
-- SheetJS klaidingus XLSX langelius grąžina kaip skaičių NaN; `str()` jį
-- paversdavo tekstu "NaN", o `parseFloat` netinkamo teksto rezultatą — irgi.
-- Tekstiniuose stulpeliuose tokia reikšmė atsidurdavo duomenų bazėje ir buvo
-- rodoma puslapyje („Atmesti pasiūlymai" dalies stulpelyje matėsi „NaN").
--
-- Šaltinis pataisytas: modules/ppa/parse.js `cell()` ir modules/ppa/insert.js
-- `kaina()`. Šis failas sutvarko jau įrašytas eilutes; naujiems parsinimams jo
-- nebereikia.

UPDATE ppa."atmestiPasiulymai" SET "daliesNumeris" = NULL WHERE "daliesNumeris" = 'NaN';
UPDATE ppa."atmestiPasiulymai" SET "pasiulymoKaina" = NULL WHERE "pasiulymoKaina" = 'NaN';

UPDATE ppa."pasiulymuEile" SET "daliesNumeris" = NULL WHERE "daliesNumeris" = 'NaN';
UPDATE ppa."pasiulymuEile" SET "kaina" = NULL WHERE "kaina" = 'NaN';

UPDATE ppa."pirkimoDalys" SET "daliesNumeris" = NULL WHERE "daliesNumeris" = 'NaN';
