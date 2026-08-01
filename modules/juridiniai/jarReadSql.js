// Bendras normalizuoto JAR adreso projekcijos SQL. Aliasai sąmoningai fiksuoti,
// kad visos serverio užklausos vienodai apdorotų pastatų ir patalpų AOB kodus.
export const JAR_ADDRESS_JOINS = `
LEFT JOIN public."jarAsmenuAdresai" jar_address
    ON jar_address."jarKodas" = jar_person."jarKodas"
LEFT JOIN public."arPatalposAdresai" jar_room
    ON jar_room."patKodas" = jar_address."aobKodas"
LEFT JOIN public."arAdresai" jar_ar
    ON jar_ar."kodas" = COALESCE(jar_room."aobKodas", jar_address."aobKodas")
LEFT JOIN public."arPastataiSklypaiAdresai" jar_building
    ON jar_building."kodas" = COALESCE(jar_room."aobKodas", jar_address."aobKodas")
LEFT JOIN public."arGatves" jar_street
    ON jar_street."kodas" = jar_building."gatKodas"
LEFT JOIN public."arGyvenvietesRibos" jar_place
    ON jar_place."kodas" = jar_building."gyvKodas"
LEFT JOIN public."arSavivaldybes" jar_municipality
    ON jar_municipality."kodas" = COALESCE(jar_building."savKodas", jar_place."savivaldybesKodas")
LEFT JOIN public."arApskritys" jar_county
    ON jar_county."kodas" = jar_municipality."apskritiesKodas"`;

export const JAR_ADDRESS_SQL = `COALESCE(
    jar_address."adresas",
    NULLIF(concat_ws(', ',
        jar_municipality."pavadinimas",
        jar_place."pavadinimas",
        NULLIF(concat_ws(' ',
            jar_street."pavadinimas",
            NULLIF(concat(
                jar_building."nr",
                CASE WHEN jar_building."korpusoNr" IS NOT NULL
                    THEN ' K' || jar_building."korpusoNr" ELSE '' END,
                CASE WHEN jar_room."patalpaNr" IS NOT NULL
                    THEN '-' || jar_room."patalpaNr" ELSE '' END
            ), '')
        ), ''),
        jar_building."pastoKodas"
    ), '')
)`;

export const JAR_LOCATION_SQL = `COALESCE(
    jar_ar."geometrija",
    jar_address."fallbackLocation"
)`;
