// Bendras normalizuoto JAR adreso projekcijos SQL. Aliasai sąmoningai fiksuoti,
// kad visos serverio užklausos vienodai apdorotų pastatų ir patalpų AOB kodus.

// Minimalus rinkinys, kurio pakanka JAR_LOCATION_SQL — patalpa, kad iš jos
// gautume pastato AOB kodą, ir pats adreso taškas. Atskirai, nes dalis užklausų
// nori tik koordinačių ir joms likę penki JOIN'ai yra tuščias darbas.
// `adresuRegistras` kodai yra integer, o "rcJar"."asmenuAdresai"."aobKodas"
// tebėra text — be aiškaus cast'o JOIN'as kristų su „operator does not exist:
// integer = text“. Duomenys tai leidžia: visos 217 738 nenulinės reikšmės yra
// vien skaitmenys. Cast'as yra ant mažosios (229 tūkst. eilučių) lentelės pusės,
// tad adresų registro indeksai lieka naudojami.
const AOB_KODAS = `jar_address."aobKodas"::int`;

export const JAR_LOCATION_JOINS = `
LEFT JOIN "rcJar"."asmenuAdresai" jar_address
    ON jar_address."jarKodas" = jar_person."jarKodas"
LEFT JOIN "adresuRegistras"."patalposAdresai" jar_room
    ON jar_room."patKodas" = ${AOB_KODAS}
LEFT JOIN "adresuRegistras"."adresai" jar_ar
    ON jar_ar."kodas" = COALESCE(jar_room."aobKodas", ${AOB_KODAS})`;

export const JAR_ADDRESS_JOINS = `${JAR_LOCATION_JOINS}
LEFT JOIN "adresuRegistras"."pastataiSklypaiAdresai" jar_building
    ON jar_building."kodas" = COALESCE(jar_room."aobKodas", ${AOB_KODAS})
LEFT JOIN "adresuRegistras"."gatves" jar_street
    ON jar_street."kodas" = jar_building."gatKodas"
LEFT JOIN "adresuRegistras"."gyvenvietesRibos" jar_place
    ON jar_place."kodas" = jar_building."gyvKodas"
LEFT JOIN "adresuRegistras"."savivaldybes" jar_municipality
    ON jar_municipality."kodas" = COALESCE(jar_building."savKodas", jar_place."savivaldybesKodas")
LEFT JOIN "adresuRegistras"."apskritys" jar_county
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
