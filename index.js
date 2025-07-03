import config from "./utils/config.js";

// Website

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = config.port || 8000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

import indexRouter from "./routes/index.js";
app.use("/", indexRouter);

import pirkimasRouter from "./routes/pirkimas.js";
app.use("/pirkimas", pirkimasRouter);

import pirkejasRouter from "./routes/pirkejas.js";
app.use("/pirkejas", pirkejasRouter);

import tiekejasRouter from "./routes/tiekejas.js";
app.use("/tiekejas", tiekejasRouter);

import duomenysRouter from "./routes/duomenys.js";
app.use("/duomenys", duomenysRouter);

import analitikaRouter from "./routes/analitika.js";
app.use("/analitika", analitikaRouter);

import juridiniaiRouter from "./routes/juridiniai.js";
app.use("/juridiniai", juridiniaiRouter);

import asmuoRouter from "./routes/asmuo.js";
app.use("/asmuo", asmuoRouter);

import kodasRouter from "./routes/kodas.js";
app.use("/kodas", kodasRouter);

import korespondencijaRouter from "./routes/korespondencija.js";
app.use("/korespondencija", korespondencijaRouter);

import eksportaiRouter from "./routes/eksportai.js";
app.use("/eksportai", eksportaiRouter);

// Search database

import { ensureSearchCollection } from "./typesense/typesense.js";
await ensureSearchCollection();

app.listen(PORT, () =>
	console.log(`Server running at http://localhost:${PORT}`)
);
