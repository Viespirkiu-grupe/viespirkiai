import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const _viewsDir = join(dirname(fileURLToPath(import.meta.url)), "views");

export const COVERED_TABLES_BY_VIEWS: Record<string, string> = {
    jarCsv:                 "v_company",
    sutartys:               "v_sutartys",
    viesiejiPirkimai:       "v_pirkimas",
    pinregJuridiniaiRysiai: "v_person_links",
    atn1ataskaitos:         "v_dalyviai",
    bylosDalyviai:          "v_bylos",
};

const _viewNames = [...new Set(Object.values(COVERED_TABLES_BY_VIEWS))].sort();

export const VIEW_DEFINITIONS: Record<string, string> = Object.fromEntries(
    _viewNames.map((name) => [name, readFileSync(join(_viewsDir, `${name}.sql`), "utf-8").trim()]),
);

export const TEMP_VIEWS_SQL: string = Object.values(VIEW_DEFINITIONS).join(";\n\n") + ";";

export const VIEW_NAMES: Set<string> = new Set(_viewNames);
