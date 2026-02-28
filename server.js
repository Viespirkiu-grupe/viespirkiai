import cluster from "cluster";
import config from "./utils/config.js";
import http from "http";
import { log } from "./utils/log.js";

const WORKERS_COUNT = config.workerCount;
const PORT = config.port || 8000;

if (cluster.isPrimary) {
    log(`Primary ${process.pid} is running`);

    for (let i = 0; i < WORKERS_COUNT; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
        log(`Worker ${worker.process.pid} died, restarting...`);
        cluster.fork();
    });
} else {
    // dynamic import in an async IIFE
    (async () => {
        const { default: app } = await import("./index.js");

        const server = http.createServer(app);

        // set 24h max request duration
        server.setTimeout(24 * 60 * 60 * 1000);

        server.listen(PORT, () => {
            log(`Worker ${process.pid} running on port ${PORT}`);
        });
    })();
}
