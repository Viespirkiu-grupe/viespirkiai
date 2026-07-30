import { S3Client } from "@aws-sdk/client-s3";

/*
S3 kliento gamyba iš `getMazgas()` grąžinamos konfigūracijos.

`forcePathStyle` numatytai įjungtas — Hetzner, Wasabi, MinIO ir kiti
S3-suderinami mazgai su virtual-host stiliumi elgiasi nevienodai, o path style
veikia visur.
*/

/**
 * @param {ReturnType<import("./s3backupEnv.js").getMazgas>} mazgas
 * @param {object} [opts]
 * @param {number} [opts.maxAttempts] - SDK vidiniai pakartojimai (tinklo blyksniams)
 * @returns {S3Client}
 */
export function createS3Client(mazgas, { maxAttempts = 3 } = {}) {
    return new S3Client({
        endpoint: mazgas.endpoint,
        region: mazgas.region,
        forcePathStyle: mazgas.forcePathStyle,
        maxAttempts,
        credentials: {
            accessKeyId: mazgas.accessKeyId,
            secretAccessKey: mazgas.secretAccessKey,
        },
    });
}
