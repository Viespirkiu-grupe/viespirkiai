export const COVERED_TABLES_BY_VIEWS: Record<string, string> = {
    asmenys:                "v_company",
    vpmSutartys:            "v_sutartys",
    pirkimai:               "v_pirkimas",
    juridiniaiRysiaiPilni:  "v_person_links",
    ataskaitos:             "v_dalyviai",

    // LITEKO teismo nuosprendžiai iškelti į `liteko` schemą; buvęs
    // public."teismoNuosprendziaiDalyviai" nekvalifikuotai yra `dalyviaiPilni`.
    dalyviaiPilni:          "v_bylos",
};

// Views that stand in for a raw ingestion table above; get_schema redirects the
// analyst from the table to its covering view.
const _baseViews = [...new Set(Object.values(COVERED_TABLES_BY_VIEWS))].sort();

// Domain entities that stand in for no single ingestion table, so they cover
// nothing and stay out of the map above. Listed in creation order: ensureViews
// issues the DDL in iteration order, and a derived view's dependencies must
// already exist. v_pirkimo_dalis and v_dalyviu_pora select from v_dalyviai,
// which sorts before them today — but appending rather than merging and
// re-sorting is what keeps that true as derived views are added, instead of
// leaving it to alphabetical luck.
const _derivedViews = [
    "v_skelbimas",
    "v_pirkimo_planas",
    "v_rinka",
    "v_pirkejo_tiekejo_rysys",
    "v_pirkimo_dalis",
    "v_dalyviu_pora",
];

const _viewNames = [..._baseViews, ..._derivedViews];

const _sqlFiles = import.meta.glob("./views/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const VIEW_DEFINITIONS: Record<string, string> = Object.fromEntries(
    _viewNames.map((name) => {
        const content = _sqlFiles[`./views/${name}.sql`];
        if (!content) throw new Error(`Missing view SQL: ${name}.sql`);
        return [name, content.trim()];
    }),
);

export const VIEW_NAMES: Set<string> = new Set(_viewNames);
