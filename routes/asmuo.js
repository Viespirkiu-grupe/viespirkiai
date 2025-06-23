import express from "express";
import config from "../utils/config.js";
import { mysql } from "../database.js";

const asmuoRouter = express.Router();

asmuoRouter.get("/:id", async (req, res) => {
	let { id } = req.params;
	if (id.endsWith(".json")) {
		id = id.slice(0, -5);
	}

	const [jarRezultatai] = await mysql.execute(
		"SELECT * FROM jar WHERE jarKodas = ?;",
		[id]
	);

	if (jarRezultatai.length === 0) {
		if(id == 807){
			let pavadinimas = "CVP IS kitas asmuo";
			let aprasymas = "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas kitam asmeniui.";
			res.render("netikrasAsmuo", { customHead: config.customHead, asmuo: { id }, pavadinimas, aprasymas });
			return;
		}else if(id == 809){
			let pavadinimas = "CVP IS fizinis asmuo";
			let aprasymas = "Juridinis asmuo kurio ieškote neegzistuoja, kadangi tai yra tiesiog CVP IS sistemoje naudojamas kodas fiziniam asmeniui.";
			res.render("netikrasAsmuo", { customHead: config.customHead, asmuo: { id }, pavadinimas, aprasymas });
			return;
		}
		return res.status(404).send("Not found");
	}

	let jar = jarRezultatai[0];
	jar.registravimoData = jar.registravimoData.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' });
	jar.duomenuData = jar.duomenuData.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' });
	jar.statusasNuo = jar.statusasNuo.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' });

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

	let asmuo = {
		jar,
	};

	const [sodra] = await mysql.execute(
		"SELECT * FROM sodra WHERE jarKodas = ? ORDER BY data DESC;",
		[id]
	);

	if (sodra.length > 0) {
		asmuo.sodra = {
			kodas: sodra[0].kodas,
			jarKodas: sodra[0].jarKodas,
			pavadinimas: sodra[0].pavadinimas,
			savivaldybe: sodra[0].savivaldybe,
			ekonominesVeiklosKodas: sodra[0].ekonominesVeiklosKodas,
			ekonominesVeiklosPavadinimas: sodra[0].ekonominesVeiklosPavadinimas,
			vidutinisAtlyginimas: sodra[0].vidutinisAtlyginimas,
			vidutinisAtlyginimas2: sodra[0].vidutinisAtlyginimas2,
			data: `${sodra[0].data.toString().slice(0, 4)}-${sodra[0].data
				.toString()
				.slice(4, 6)}`,
			draustieji: sodra[0].draustieji,
			draustieji2: sodra[0].draustieji2,
			bendrasVidutinisAtlyginimas:
				(sodra[0].vidutinisAtlyginimas * sodra[0].draustieji +
					sodra[0].vidutinisAtlyginimas2 * sodra[0].draustieji2) /
				(sodra[0].draustieji + sodra[0].draustieji2),
			bendrasDraustujuSkaicius: sodra[0].draustieji + sodra[0].draustieji2,
			imokuSuma: sodra[0].imokuSuma,
		};

		asmuo.sodra.atlyginimuIslaidos =
			parseFloat((asmuo.sodra.bendrasVidutinisAtlyginimas * asmuo.sodra.bendrasDraustujuSkaicius).toFixed(2));

		asmuo.sodra.duomenys = sodra.map((row) => ({
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

	const [mokesciai] = await mysql.execute(
		"SELECT * FROM mokesciai WHERE jarKodas = ? ORDER BY metai DESC, menuo DESC;",
		[id]
	);

	if (mokesciai.length > 0) {
		asmuo.mokesciai = {
			pavadinimas: mokesciai[0].pavadinimas,
			jarKodas: mokesciai[0].jarKodas,
			formosPavadinimas: mokesciai[0].formosPavadinimas,
			data: `${mokesciai[0].metai}-${mokesciai[0].menuo
				.toString()
				.padStart(2, "0")}`,
			duomenuData: mokesciai[0].duomenuData.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' }),
			suma: mokesciai[0].suma,
			duomenys: mokesciai.map((row) => ({
				data: `${row.metai}-${row.menuo.toString().padStart(2, "0")}`,
				duomenuData: row.duomenuData.toLocaleDateString('lt-LT', { year: 'numeric', month: '2-digit', day: '2-digit' }),
				suma: row.suma,
			})),
		};
	}


	if (req.path.endsWith(".json")) {
		const formattedJson = JSON.stringify(asmuo, null, 2);
		res.setHeader("Content-Type", "application/json");
		return res.send(formattedJson);
	}

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

	res.render("asmuo", { asmuo, customHead: config.customHead, aprasas });
});

export default asmuoRouter;
