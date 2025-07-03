import express from "express";
import config from "../utils/config.js";
import { mysql } from "../mysql/mysql.js";

const asmuoRouter = express.Router();

asmuoRouter.get("/:id", async (req, res) => {
	let { id } = req.params;

	if (id.endsWith(".json")) {
		id = id.slice(0, -5);
	}

	// JAR
	const [jarRezultatai] = await mysql.execute(
		"SELECT * FROM jar WHERE jarKodas = ?;",
		[id]
	);

	if (jarRezultatai.length === 0) {
		const specAtvejai = {
			807: {
				pavadinimas: "CVP IS kitas asmuo",
				aprasymas: "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas kitam asmeniui."
			},
			809: {
				pavadinimas: "CVP IS fizinis asmuo",
				aprasymas: "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas fiziniam asmeniui."
			},
			803: {
				pavadinimas: "CVP IS užsienio įmonė",
				aprasymas: "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas užsienio įmonei."
			}
		};

		if (specAtvejai[id]) {
			const { pavadinimas, aprasymas } = specAtvejai[id];
			res.render("juridiniai/netikrasAsmuo", { customHead: config.customHead, asmuo: { id }, pavadinimas, aprasymas });
			return;
		}
		return res.status(404).send("Not found");
	}

	let jar = jarRezultatai[0];
	jar.registravimoData = jar.registravimoData.toLtDate();
	jar.duomenuData = jar.duomenuData.toLtDate();
	jar.statusasNuo = jar.statusasNuo.toLtDate();

	if(jar.adresoId && jar.adresoId > 0) {
		const [adresasRezultatai] = await mysql.execute(
			"SELECT * FROM adresai WHERE id = ?;",
			[jar.adresoId]
		);
		if (adresasRezultatai.length > 0) {
			jar.koordinates = adresasRezultatai[0].taskas;
		}
		delete jar.adresoId;
	}

	// SODRA
	const [sodraRezultatai] = await mysql.execute(
		"SELECT * FROM sodra WHERE jarKodas = ? ORDER BY data DESC;",
		[id]
	);

	let sodra;
	if (sodraRezultatai.length > 0) {
		sodra = {
			kodas: sodraRezultatai[0].kodas,
			jarKodas: sodraRezultatai[0].jarKodas,
			pavadinimas: sodraRezultatai[0].pavadinimas,
			savivaldybe: sodraRezultatai[0].savivaldybe,
			ekonominesVeiklosKodas: sodraRezultatai[0].ekonominesVeiklosKodas,
			ekonominesVeiklosPavadinimas: sodraRezultatai[0].ekonominesVeiklosPavadinimas,
			vidutinisAtlyginimas: sodraRezultatai[0].vidutinisAtlyginimas,
			vidutinisAtlyginimas2: sodraRezultatai[0].vidutinisAtlyginimas2,
			data: `${sodraRezultatai[0].data.toString().slice(0, 4)}-${sodraRezultatai[0].data
				.toString()
				.slice(4, 6)}`,
			draustieji: sodraRezultatai[0].draustieji,
			draustieji2: sodraRezultatai[0].draustieji2,
			bendrasVidutinisAtlyginimas:
				(sodraRezultatai[0].vidutinisAtlyginimas * sodraRezultatai[0].draustieji +
					sodraRezultatai[0].vidutinisAtlyginimas2 * sodraRezultatai[0].draustieji2) /
				(sodraRezultatai[0].draustieji + sodraRezultatai[0].draustieji2),
			bendrasDraustujuSkaicius: sodraRezultatai[0].draustieji + sodraRezultatai[0].draustieji2,
			imokuSuma: sodraRezultatai[0].imokuSuma,
		};

		sodra.atlyginimuIslaidos =
			parseFloat((sodra.bendrasVidutinisAtlyginimas * sodra.bendrasDraustujuSkaicius).toFixed(2));

		sodra.duomenys = sodraRezultatai.map((row) => ({
			data: `${row.data.toString().slice(0, 4)}-${row.data
				.toString()
				.slice(4, 6)}`,
			vidutinisAtlyginimas: row.vidutinisAtlyginimas,
			draustieji: row.draustieji,
			vidutinisAtlyginimas2: row.vidutinisAtlyginimas2,
			draustieji2: row.draustieji2,
			imokuSuma: row.imokuSuma,
		}));
	}

	// VMI
	const [mokesciaiRezultatai] = await mysql.execute(
		"SELECT * FROM mokesciai WHERE jarKodas = ? ORDER BY metai DESC, menuo DESC;",
		[id]
	);

	let mokesciai;
	if (mokesciaiRezultatai.length > 0) {
		mokesciai = {
			pavadinimas: mokesciaiRezultatai[0].pavadinimas,
			jarKodas: mokesciaiRezultatai[0].jarKodas,
			formosPavadinimas: mokesciaiRezultatai[0].formosPavadinimas,
			data: `${mokesciaiRezultatai[0].metai}-${mokesciaiRezultatai[0].menuo
				.toString()
				.padStart(2, "0")}`,
			duomenuData: mokesciaiRezultatai[0].duomenuData.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' }),
			suma: mokesciaiRezultatai[0].suma,
			duomenys: mokesciaiRezultatai.map((row) => ({
				data: `${row.metai}-${row.menuo.toString().padStart(2, "0")}`,
				duomenuData: row.duomenuData.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' }),
				suma: row.suma,
			})),
		};
	}

	// Asmuo
	let asmuo = {
		jar, sodra, mokesciai
	};

	// JSON
	if (req.path.endsWith(".json")) {
		const formattedJson = JSON.stringify(asmuo, null, 2);
		res.setHeader("Content-Type", "application/json");
		return res.send(formattedJson);
	}

	// Aprašas
	let aprasas = `${jar.pavadinimas} (${jar.jarKodas})`;
	if(asmuo?.jar?.adresas) {
		aprasas += `\nAdresas: ${jar.adresas}`;
	}
	if(asmuo?.sodra?.numInsured) {
		aprasas += `\nSodra: ${asmuo.sodra.numInsured} darbuotojų`;
		if(asmuo.sodra.avgWage) {
			aprasas += `, vidutinis atlyginimas: ${asmuo.sodra.avgWage.toFixed(2)} €/mėn.`;
		}
	}

	res.render("juridiniai/asmuo", { asmuo, customHead: config.customHead, aprasas });
});

export default asmuoRouter;
