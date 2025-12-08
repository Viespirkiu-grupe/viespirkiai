import cluster from "cluster";
import config from "./utils/config.js";

const WORKERS_COUNT = 4;

const PORT = config.port || 8000;

if (cluster.isPrimary) {
    console.log(`Primary ${process.pid} is running`);

    for (let i = 0; i < WORKERS_COUNT; i++) {
        cluster.fork();
    }

    cluster.on("exit", (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died, restarting...`);
        cluster.fork();
    });
} else {
    import("./index.js").then(({ default: app }) => {
        app.listen(PORT, () => {
            console.log(`Worker ${process.pid} running on port ${PORT}`);
        });
    });
}
