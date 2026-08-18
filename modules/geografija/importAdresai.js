import { createScraperFetch } from "../../utils/scrapeFetch.js";
const scrapeFetch = createScraperFetch("geografija", { operation: "importAdresai" });
import { postgres } from "../../postgres/postgres.js";
import { Logger } from "../../utils/log.js";
const logger = new Logger();
import { getArDataSources } from "./adresuRegistrasDataSources.js";
import AdmZip from "adm-zip";
import { pipeline } from "stream/promises";
import { createWriteStream, createReadStream } from "fs";
import { unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { parser } from "stream-json";
import { streamArray } from "stream-json/streamers/stream-array.js";
import { chain } from "stream-chain";
import { pick } from "stream-json/filters/pick.js";
import { enqueueAddressLinkedJuridiniai } from "../juridiniai/enqueueRefresh.js";

const BATCH_SIZE = 1000;
const TMP_ZIP = join(tmpdir(), "arAdresai.zip");
const TMP_JSON = join(tmpdir(), "adr_gra_adresai_LT.json");

async function updateAdresai() {
    await postgres.query(`TRUNCATE "arAdresai"`);

    const sources = await getArDataSources();
    const entry = sources.addressPoints[0];

    const res = await scrapeFetch(entry.geojson);
    if (!res.ok) throw new Error(`Failed to fetch adresai: ${res.status}`);

    await pipeline(res.body, createWriteStream(TMP_ZIP));

    const zip = new AdmZip(TMP_ZIP);
    zip.extractEntryTo(zip.getEntries()[0], tmpdir(), false, true);
    await unlink(TMP_ZIP);

    let batch = [];
    let total = 0;

    const flushBatch = async () => {
        if (!batch.length) return;

        const values = [];
        const params = [];
        let p = 1;

        for (const props of batch) {
            const {
                AOB_KODAS,
                GYV_KODAS,
                GAT_KODAS,
                PASTO_KODA,
                AOB_R,
                AOB_RK,
                AOB_ATR_KO,
                E_KOORD,
                N_KOORD,
            } = props;

            values.push(
                `($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, ST_SetSRID(ST_MakePoint($${p++}, $${p++}), 4326))`,
            );
            params.push(
                String(AOB_KODAS),
                String(GYV_KODAS),
                String(GAT_KODAS),
                PASTO_KODA,
                AOB_R,
                AOB_RK,
                AOB_ATR_KO,
                E_KOORD,
                N_KOORD,
            );
        }

        await postgres.query(
            `INSERT INTO "arAdresai" ("kodas", "gyvKodas", "gatKodas", "pastoKodas", "aobR", "aobRk", "aobAtrKo", "geometrija")
       VALUES ${values.join(", ")}`,
            params,
        );

        total += batch.length;
        logger.log(`Įkelta ${total}`);
        batch = [];
    };

    await new Promise((resolve, reject) => {
        const pipeline = chain([
            createReadStream(TMP_JSON),
            parser(),
            pick({ filter: "features" }),
            streamArray(),
        ]);

        pipeline.on("data", async ({ value: feature }) => {
            batch.push(feature.properties);
            if (batch.length >= BATCH_SIZE) {
                pipeline.pause();
                await flushBatch();
                pipeline.resume();
            }
        });

        pipeline.on("end", async () => {
            await flushBatch();
            resolve();
        });

        pipeline.on("error", reject);
    });

    await unlink(TMP_JSON);

    await enqueueAddressLinkedJuridiniai(postgres, "adresu-registras");

    logger.log("Atnaujinti adresų taškai");
    return true;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
    await updateAdresai();
    await postgres.end();
}
