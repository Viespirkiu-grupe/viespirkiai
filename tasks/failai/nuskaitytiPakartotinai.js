import { postgres } from "../../postgres/postgres.js";

export async function nuskaitytiPakartotinai(kiekis = 100) {
    try {
        let query = `WITH to_update AS (
      SELECT id
      FROM failai
      WHERE nuskaitytas = -1
      LIMIT $1
  )
  UPDATE failai f
  SET nuskaitytas = 0
  FROM to_update t
  WHERE f.id = t.id;`;

        // Return true if any rows were updated, false if not
        let updateRes = await postgres.query(query, [kiekis]);
        console.log(`Updated ${updateRes.rowCount}`);
        return updateRes.rowCount > 0;
    } catch (err) {
        console.error(err);
        return true;
    }
}

while (await nuskaitytiPakartotinai()) {
    // Repeat
}

postgres.end();
