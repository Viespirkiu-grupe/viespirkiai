import { viespirkiai } from "../mongo/mongoDb.js";
import { createWriteStream } from "fs";
import config from "../utils/config.js";
import { join } from "path";

const cursor = viespirkiai.find().stream();
const exportStream = createWriteStream(join(process.cwd(), config.exportFile));

let count = 0;
let isPaused = false;

cursor.on("data", (doc) => {
	const line = JSON.stringify(doc) + "\n";
	const canContinue = exportStream.write(line);

	count++;
	if (count % 1000 === 0) {
		console.log(`Exported ${count} documents...`);
	}

	if (!canContinue) {
		cursor.pause();
		isPaused = true;
	}
});

exportStream.on("drain", () => {
	if (isPaused) {
		isPaused = false;
		cursor.resume();
	}
});

cursor.on("end", () => {
	exportStream.end(() => {
		console.log(`Exported ${count} documents in total.`);
	});
});

cursor.on("error", (err) => {
	console.error("Error while exporting:", err);
	exportStream.end();
});
