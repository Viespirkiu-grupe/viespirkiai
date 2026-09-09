import { pathToFileURL } from "node:url";
import { postgres } from "../../postgres/postgres.js";

export const HELP = `Naudojimas:
  npm run sutartys:rebuildDiffs -- [parinktys]

Užpildo vpmSutartys."changes"."skirtumai" – pakeitimo santrauką, pagal kurią
filtruojami ir rikiuojami sutarčių redagavimai. Skaičiavimas gyvena DB pusėje
(vpmSutartys."perskaiciuotiSkirtumus"), tad ta pati logika naudojama ir
migracijoje migrations/vpmSutartys/002_changesSkirtumai.sql.

Paleisti reikia:
  * po migracijos, jei tarp jos ir kodo deploy'o buvo įrašyta pakeitimų
    (jie liktų be "skirtumai", tad nepatektų į redagavimų sąrašą);
  * po npm run sutartys:dropEmptyChanges — ištrynus eilutes, ankstesniųjų
    santraukos gali būti pasenusios (tada su --visus).

Parinktys:
      --visus       Perskaičiuoti visus, ne tik trūkstamus
  -q, --quiet       Nerodyti eigos
  -h, --help        Parodyti šią pagalbą`;

export function parseArgs(argv) {
    const options = { visus: false, quiet: false, help: false };

    for (const arg of argv) {
        if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else if (arg === "--visus") {
            options.visus = true;
        } else if (arg === "--quiet" || arg === "-q") {
            options.quiet = true;
        } else {
            throw new Error(`Nežinomas argumentas: ${arg}`);
        }
    }

    return options;
}

export async function main(argv = process.argv.slice(2), db = postgres) {
    const options = parseArgs(argv);
    if (options.help) {
        console.log(HELP);
        return;
    }

    const log = options.quiet ? () => {} : (text) => process.stdout.write(text);
    log(options.visus
        ? "Perskaičiuoju visų pakeitimų skirtumus…\n"
        : "Užpildau trūkstamus pakeitimų skirtumus…\n");

    const result = await db.query(
        `SELECT "vpmSutartys"."perskaiciuotiSkirtumus"($1) AS kiek`,
        [options.visus],
    );
    const kiek = Number(result.rows[0].kiek);

    // Likę NULL'ai yra teisėti tik tada, kai sutarties nebėra vpmSutartys."sutartys"
    // (vėlesnė būsena nežinoma) – tą patį atvejį JS pusėje reiškia !row.after.
    const { rows: [likutis] } = await db.query(
        `SELECT
            count(*) FILTER (WHERE c."skirtumai" IS NULL)::int AS tusti,
            count(*) FILTER (
                WHERE c."skirtumai" IS NULL
                  AND EXISTS (SELECT 1 FROM "vpmSutartys"."sutartys" s
                              WHERE s."unikalusId" = c."unikalusId")
            )::int AS "tustiSuSutartimi"
         FROM "vpmSutartys"."changes" c`,
    );

    process.stdout.write(
        `Atnaujinta ${kiek.toLocaleString("lt-LT")} pakeitimų. `
        + `Be skirtumų liko ${likutis.tusti.toLocaleString("lt-LT")} `
        + `(iš jų su egzistuojančia sutartimi: ${likutis.tustiSuSutartimi}).\n`,
    );

    if (likutis.tustiSuSutartimi > 0) {
        process.stdout.write(
            "Įspėjimas: šie turėtų būti užpildomi – patikrink "
            + "vpmSutartys.\"perskaiciuotiSkirtumus\".\n",
        );
        process.exitCode = 1;
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main()
        .catch((error) => {
            console.error(`Nepavyko perskaičiuoti skirtumų: ${error.message}`);
            process.exitCode = 1;
        })
        .finally(async () => {
            await postgres.end();
        });
}
