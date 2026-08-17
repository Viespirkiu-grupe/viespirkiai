import { parseHTML } from "linkedom";
import { createScraperFetch } from "../../../utils/scrapeFetch.js";
import { parseNoticeByType } from "./forms.js";
import { minifyHtml, ORIGIN } from "./primitives.js";

const scrapeFetch = createScraperFetch("cvpp", { operation: "scrapeAtaskaitosContent" });

// Grąžina { turinys, turinysHtml }:
//   turinys     — struktūrizuotas JSON (pagal formTypeId parserį),
//   turinysHtml — minifikuotas .tab-content innerHTML (žalias atsarginis variantas).
export async function scrapeAtaskaitosContent(id, formTypeId) {
    const url = `${ORIGIN}/ReportsOrProtocol/Details/${id}?formTypeId=${formTypeId}`;
    const response = await scrapeFetch(url);
    const text = await response.text();
    const { document } = parseHTML(text);

    const notice = document.querySelector("#notice");
    if (!notice) return null;

    const tabContent = document.querySelector(".tab-content");
    const turinysHtml = tabContent ? minifyHtml(tabContent.innerHTML) : null;

    return {
        turinys: parseNoticeByType(notice, formTypeId),
        turinysHtml,
    };
}

