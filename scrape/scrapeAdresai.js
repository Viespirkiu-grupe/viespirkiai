import mysql from 'mysql2/promise';

// Configuration
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const SLEEP_MS = 1001; // 1.1s between requests
const USER_AGENT = 'Viespirkiai/1.0 (sveiki@viespirkiai.top)';

const db = await mysql.createConnection({
  host: 'localhost',
  user: 'viespirkiai',
  password: 'viespirkiai',
  database: 'viespirkiai',
  port: 9022,
});

// Sleep utility
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

while (true) {
  const [rows] = await db.execute(`
    SELECT jarKodas, adresas FROM jar
    WHERE adresoId IS NULL AND adresas IS NOT NULL
    LIMIT 1
  `);

  if (rows.length === 0) {
    console.log('No more rows to process');
    break;
  }

  for (const { jarKodas, adresas } of rows) {
    // Check if address already in adresai
    const [[existing]] = await db.execute(
      'SELECT id FROM adresai WHERE adresas = ? LIMIT 1',
      [adresas]
    );

    let adresasId;

    if (existing) {
      adresasId = existing.id;
    } else {
      // Query Nominatim
                console.log(`Fetching geocode for: ${adresas}`);
          const normalizedAddress = minimalAddress(adresas);
          console.log(`Normalized address: ${normalizedAddress}`);

      const url = new URL(NOMINATIM_URL);
      url.searchParams.set('q', normalizedAddress);
      url.searchParams.set('format', 'json');
      url.searchParams.set('limit', '1');

      try {


        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
        const data = await res.json();

        if (!data.length) {
          console.warn(`No geocode result for: ${adresas}`);
          adresasId = -1; // Mark as failed
            // exit the programme if no geocode found

            // process.exit(1);

        } else {
          const { lat, lon } = data[0];
            console.log(`lat=${lat}, lon=${lon}`);

          const [result] = await db.execute(
            'INSERT INTO adresai (taskas, adresas) VALUES (POINT(?, ?), ?)',
            [parseFloat(lon), parseFloat(lat), adresas]
          );

          adresasId = result.insertId;
        }

      } catch (e) {
        console.error(`Fetch error for ${adresas}:`, e);
        continue; // Try again later
      }
    }

    // Update jar
    await db.execute(
      'UPDATE jar SET adresoId = ? WHERE jarKodas = ?',
      [adresasId, jarKodas]
    );

    console.log(`Updated jar ${jarKodas} → adresoId=${adresasId}`);
    console.log(`---`);
    await sleep(SLEEP_MS); // Always wait
  }
}

function minimalAddress(raw) {
    raw = raw.replace(/nių k\./g, 'nys k.');
    raw = raw.replace(/sių k\./g, 'siai k.');
    raw = raw.replace(/kių k\./g, 'kiai k.');

  // Remove "k." (village marker)
  raw = raw.replace(/\bk\.\s*/gi, '');

  // Remove LT- prefix from postcode
  const postcodeMatch = raw.match(/LT-(\d{5})/i);
  const postcode = postcodeMatch ? postcodeMatch[1] : '';

  // Match full street name + house number/range
  const streetNumberMatch = raw.match(/([\p{L}\s.'\-]+?\d+[A-Za-z]?(-\d+[A-Za-z]?)?)/iu);
  const streetNumber = (streetNumberMatch ? streetNumberMatch[1].trim() : '').replace(/-\d+[A-Za-z]?$/, '');

  let addr = '';

  if (streetNumber) addr += streetNumber;
  if (postcode) addr += (addr ? ', ' : '') + postcode;

  addr += (addr ? ', ' : '') + 'Lithuania';

  return addr;
}





await db.end();
