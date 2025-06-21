import express from "express";
import config from '../utils/config.js';
import { mysql } from "../database.js";


const asmuoRouter = express.Router();

asmuoRouter.get("/:id", async (req, res) => {
    let { id } = req.params;
    if(id.endsWith(".json")) {
        id = id.slice(0, -5);
    }

    const [rows] = await mysql.execute(
        "SELECT * FROM sodra WHERE jarCode = ? ORDER BY month DESC;",
        [id]
    );

    if (rows.length === 0) {
        return res.status(404).send("Not found");
    }

    let asmuo = {
        code: rows[0].code,
        jarCode: rows[0].jarCode,
        name: rows[0].name,
        municipality: rows[0].municipality,
        ecoActCode: rows[0].ecoActCode,
        ecoActName: rows[0].ecoActName,
        avgWage: rows[0].avgWage,
        avgWage2: rows[0].avgWage2,
        month: rows[0].month, // format 202505 as "2025-05"
        monthFormatted: `${rows[0].month.toString().slice(0, 4)}-${rows[0].month.toString().slice(4, 6)}`,
        numInsured: rows[0].numInsured,
        numInsured2: rows[0].numInsured2,
        vidAtlyginimas: (rows[0].avgWage * rows[0].numInsured + rows[0].avgWage2 * rows[0].numInsured2)/(rows[0].numInsured + rows[0].numInsured2),
        darbuotojuSkaicius: rows[0].numInsured + rows[0].numInsured2,
        tax: rows[0].tax,
        data: rows.map(row => ({
            month: row.month,
            avgWage: row.avgWage,
            numInsured: row.numInsured,
            avgWage2: row.avgWage2,
            numInsured2: row.numInsured2,
            tax: row.tax
        }))
    }

    asmuo.mokamiAtlyginimai =  asmuo.vidAtlyginimas * asmuo.darbuotojuSkaicius;


    if (req.path.endsWith(".json")) {
        const formattedJson = JSON.stringify(asmuo, null, 2);
        res.setHeader("Content-Type", "application/json");
        return res.send(formattedJson);
    }

    res.render("asmuo", { asmuo, customHead: config.customHead });
});

export default asmuoRouter;
