import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
import { gautiFaila } from "./filesSkaitymas.js";
import { signalWork, WORK_SIGNALS } from "../../utils/taskSignals.js";
const logger = new Logger();

export async function deleteFile(id) {
    const file = await gautiFaila(id);
    if (!file) {
        throw new Error("File not found");
    }

    // IŠKOMENTUOTA — fizinio failo trynimas buvo klaidingas.
    //
    // md5 nėra unikalus: tas pats turinys dedubliuojamas per daug failų
    // (`files."md5Id"` nėra unique). Šis ciklas ištrindavo blobą iš visų dėžių pagal
    // md5, todėl kartu „nudegdavo" ir kiti failai, rodantys į tą patį turinį.
    // Antra klaida — objekto vardas `{md5}.{extension}` imamas iš trinamo failo,
    // nors įkeliant galėjo būti naudotas kito failo plėtinys (dabar tikrąjį
    // plėtinį laiko `filesMd5Boxes."extensionId"`).
    //
    // Taisymas (kai bus files schema): trinti tik jei niekas kitas nebesiremia md5,
    // o vardą imti iš filesMd5Boxes."extensionId", ne iš files.
    //
    //   DELETE FROM "filesMd5Boxes" b
    //   WHERE b."md5Id" = $1
    //     AND NOT EXISTS (SELECT 1 FROM files f WHERE f."md5Id" = b."md5Id" AND f.id <> $2)
    //   RETURNING b."boxId", b."extensionId"
    //
    // Trinamas tik DB įrašas; blobas dėžėse lieka (žr. komentarą aukščiau).
    // Šoninės lentelės ir eilės nusitrina per ON DELETE CASCADE.
    const deleted = await postgres.query(
        `DELETE FROM public.files WHERE id = $1;`,
        [id],
    );
    if (deleted.rowCount > 0) {
        signalWork(WORK_SIGNALS.FILES_DOCUMENTS_READY, {
            source: "deleteFile",
            count: deleted.rowCount,
        });
    }
    logger.log(`Deleted file record with id: ${id} (md5=${file.md5}, blobas dėžėse nepaliestas)`);
}

if (
    import.meta.url === process.argv[1] ||
    import.meta.url === `file://${process.argv[1]}`
) {
    // take first argument as the id
    const id = process.argv[2];

    if (!id) {
        console.error("Please provide a file id");
        process.exit(1);
    }

    await deleteFile(id);
    await postgres.end();
}
