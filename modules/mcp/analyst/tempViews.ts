export const COVERED_TABLES_BY_VIEWS: Record<string, string> = {
    jarAsmenys:             "v_company",
    sutartys:               "v_sutartys",
    viesiejiPirkimai:       "v_pirkimas",
    pinregJuridiniaiRysiai: "v_person_links",
    atn1ataskaitos:         "v_dalyviai",

    teismoNuosprendziaiDalyviai: "v_bylos",
};

// Views that stand in for a raw ingestion table above; get_schema redirects the
// analyst from the table to its covering view.
const _baseViews = [...new Set(Object.values(COVERED_TABLES_BY_VIEWS))].sort();

// Views built on other views rather than standing in for a table, so they cover
// nothing and stay out of the map above. Listed in creation order: ensureViews
// issues the DDL in iteration order, and a derived view's dependencies must
// already exist. v_pirkimo_dalis selects from v_dalyviai, which sorts before it today —
// but appending rather than merging and re-sorting is what keeps that true as
// derived views are added, instead of leaving it to alphabetical luck.
const _derivedViews = ["v_pirkimo_dalis"];

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
