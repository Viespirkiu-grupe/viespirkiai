import { describe, expect, it } from "vitest";
import { findPublicPurchaseDetailsUrl } from "../modules/cvpp/scrapePirkimai.js";

describe("findPublicPurchaseDetailsUrl", () => {
    it("randa to paties pirkimo detalių nuorodą tarpiniame puslapyje", () => {
        const html = `
            <a id="showTenderDetails"
               href="/ctm/Supplier/PublicPurchase/779175/1/0">
                Rft details
            </a>`;

        expect(findPublicPurchaseDetailsUrl(html, 779175)).toBe(
            "https://pirkimai.eviesiejipirkimai.lt/ctm/Supplier/PublicPurchase/779175/1/0",
        );
    });

    it("neieško kitos nuorodos, kai puslapyje jau yra pirkimo detalės", () => {
        const html = `
            <div id="tenderInfoSection"></div>
            <a id="showTenderDetails"
               href="/ctm/Supplier/PublicPurchase/779175/1/0"></a>`;

        expect(findPublicPurchaseDetailsUrl(html, 779175)).toBeNull();
    });

    it("atmeta kito pirkimo ir kito domeno nuorodas", () => {
        const otherPurchase = `
            <a id="showTenderDetails"
               href="/ctm/Supplier/PublicPurchase/123/1/0"></a>`;
        const otherOrigin = `
            <a id="showTenderDetails"
               href="https://example.com/ctm/Supplier/PublicPurchase/779175/1/0"></a>`;

        expect(findPublicPurchaseDetailsUrl(otherPurchase, 779175)).toBeNull();
        expect(findPublicPurchaseDetailsUrl(otherOrigin, 779175)).toBeNull();
    });
});
