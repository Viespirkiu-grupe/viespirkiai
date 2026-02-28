import { postgres } from "../../postgres/postgres.js";
import { log } from "../../utils/log.js";

export async function parsiustiPakartotinai(kiekis = 100) {
    try {
        let query = `WITH to_update AS (
      SELECT id
      FROM failai
      WHERE parsiustas = -1
      LIMIT $1
  )
  UPDATE failai f
  SET parsiustas = 0
  FROM to_update t
  WHERE f.id = t.id;`;

        // Return true if any rows were updated, false if not
        let updateRes = await postgres.query(query, [kiekis]);
        log(`Updated ${updateRes.rowCount}`);
        return updateRes.rowCount > 0;
    } catch (err) {
        console.error(err);
        return true;
    }
}

while (await parsiustiPakartotinai()) {
    // Repeat
}

postgres.end();
