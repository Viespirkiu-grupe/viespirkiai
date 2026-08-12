export const COVERED_TABLES_BY_VIEWS: Record<string, string> = {
    jarAsmenys:             "v_company",
    vpmSutartys:            "v_sutartys",
    viesiejiPirkimai:       "v_pirkimas",
    pinregJuridiniaiRysiai: "v_person_links",
    atn1ataskaitos:         "v_dalyviai",

    teismoNuosprendziaiDalyviai: "v_bylos",
};

const _viewNames = [...new Set(Object.values(COVERED_TABLES_BY_VIEWS))].sort();

const _sqlFiles = import.meta.glob("./views/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const VIEW_DEFINITIONS: Record<string, string> = Object.fromEntries(
    _viewNames.map((name) => {
        const content = _sqlFiles[`./views/${name}.sql`];
        if (!content) throw new Error(`Missing view SQL: ${name}.sql`);
        return [name, content.trim()];
    }),
);

export const VIEW_NAMES: Set<string> = new Set(_viewNames);
