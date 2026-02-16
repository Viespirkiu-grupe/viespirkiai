import { gautiPinregDeklaracijasPagalJarKoda } from "../pinreg/pinregDeklaracijos.js";
import { postgres } from "../../postgres/postgres.js";
import {
    findMatchingDarbovietes,
    findMatchingSutuoktiniuDarbovietes,
    findMatchingRysiaiSuJa,
} from "../pinreg/tikrintiInteresuKonfliktus.js";
import { gautiPinregDeklaracijasPagalVardaPavarde } from "../pinreg/pagalVarda.js";

async function patikrintiPrivaciusInteresus(unikalusId) {
    let sutartisRes = await postgres.query(
        'SELECT * FROM sutartys WHERE "sutartiesUnikalusId" = $1',
        [unikalusId],
    );

    if (sutartisRes.rows.length === 0) {
        return null;
    }

    let sutartis = sutartisRes.rows[0];

    let tiekejoPinreg;
    // Check if tiekejoKodas is 9 digits
    if (/^\d{9}$/.test(sutartis.tiekejoKodas)) {
        tiekejoPinreg = await gautiPinregDeklaracijasPagalJarKoda(
            sutartis.tiekejoKodas,
        );
    } else if (sutartis.tiekejas && sutartis.tiekejas.trim() !== "") {
        tiekejoPinreg = await gautiPinregDeklaracijasPagalVardaPavarde(
            sutartis.tiekejas,
        );
    } else {
        return null; // No valid tiekejoKodas or tiekejas name
    }

    let pirkejoPinreg = await gautiPinregDeklaracijasPagalJarKoda(
        sutartis.perkanciosiosOrganizacijosKodas,
    );

    let galimiKonfliktai = [
        ...findMatchingDarbovietes(
            tiekejoPinreg.darbovietes,
            pirkejoPinreg.darbovietes,
        ),
        ...findMatchingSutuoktiniuDarbovietes(
            tiekejoPinreg.sutuoktinioDarbovietes,
            pirkejoPinreg.sutuoktinioDarbovietes,
        ),
        ...findMatchingRysiaiSuJa(
            tiekejoPinreg.rysiaiSuJa,
            pirkejoPinreg.rysiaiSuJa,
        ),
    ];

    return galimiKonfliktai;
}

async function checkAllByPirkejas(pirkejoKodas) {
    let sutartysRes = await postgres.query(
        'SELECT * FROM sutartys WHERE "perkanciosiosOrganizacijosKodas" = $1',
        [pirkejoKodas],
    );

    for (let sutartis of sutartysRes.rows) {
        let konfliktai = await patikrintiPrivaciusInteresus(
            sutartis.sutartiesUnikalusId,
        );
        if (konfliktai && konfliktai.length > 0) {
            console.log(
                `https://viespirkiai.org/sutartis/${sutartis.sutartiesUnikalusId}`,
            );
        } else {
            // console.log(`${sutartis.sutartiesUnikalusId} neturi`);
        }
    }
}

const pirkejoKodas = process.argv[2]; // get the first CLI argument
await checkAllByPirkejas(pirkejoKodas);
postgres.end();
