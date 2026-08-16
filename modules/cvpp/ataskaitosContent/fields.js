import { bool, txt } from "./primitives.js";

export function findSection(notice, heading) {
    for (const sec of notice.querySelectorAll(".eps-section")) {
        if (sec.querySelector(".eps-section-head h2")?.textContent.includes(heading))
            return sec;
    }
    return null;
}

// Return the body element associated with field index nr inside container
export function findBody(container, nr) {
    for (const head of container.querySelectorAll(".eps-sub-section-head")) {
        if (head.querySelector(".index")?.textContent.trim() !== nr) continue;

        // Pattern B (formType 4): body is a direct child of the head element
        const childBody = [...head.children].find((c) =>
            c.classList.contains("eps-sub-section-body"),
        );
        if (childBody) return childBody;

        // Pattern A: body is the next sibling (eps-sub-section-body or plain div)
        const siblings = [...head.parentElement.children];
        const idx = siblings.indexOf(head);
        const next = siblings[idx + 1];
        if (
            next &&
            !next.classList.contains("eps-sub-section-head") &&
            !next.classList.contains("eps-section-head")
        )
            return next;

        return null;
    }
    return null;
}

export const fld = (container, nr) => txt(findBody(container, nr));
export const boolFld = (container, nr) => bool(fld(container, nr));

// Like findBody, but matches a sub-section by its label text (used for fields
// with no numeric index, e.g. the Atn-3 §II 30 000 € question).
export function findBodyByLabel(container, substring) {
    const isBody = (el) =>
        el &&
        !el.classList.contains("eps-sub-section-head") &&
        !el.classList.contains("eps-section-head");

    for (const head of container?.querySelectorAll(".eps-sub-section-head") || []) {
        if (!head.querySelector(".body")?.textContent.includes(substring)) continue;

        // Body as a direct child of the head
        const childBody = [...head.children].find((c) =>
            c.classList.contains("eps-sub-section-body"),
        );
        if (childBody) return childBody;

        // Body as the head's next sibling
        if (isBody(head.nextElementSibling)) return head.nextElementSibling;

        // Head alone in an .eps-text wrapper → answer is the wrapper's next sibling
        const wrap = head.parentElement;
        if (wrap && wrap.children.length === 1 && isBody(wrap.nextElementSibling))
            return wrap.nextElementSibling;

        return null;
    }
    return null;
}

export const fldByLabel = (container, substring) =>
    txt(findBodyByLabel(container, substring));
export const boolFldByLabel = (container, substring) =>
    bool(fldByLabel(container, substring));


