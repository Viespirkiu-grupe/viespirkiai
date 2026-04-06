import express from "express";
import config from "../utils/config.js";
import { serveOpenGraphImage } from "../utils/openGraphImage.js";

const dizainasRouter = express.Router();

const dizainasSections = [
    {
        slug: "getting-started",
        label: "Getting Started",
        pages: [
            {
                slug: "overview",
                label: "Overview",
                description: "A quick orientation of the design system and links to key sections.",
                template: "dizainas/pages/apzvalga",
            },
        ],
    },
    {
        slug: "foundations",
        label: "Foundations",
        pages: [
            {
                slug: "tokens",
                label: "Tokens",
                description: "Colors, spacing, and base design variables.",
                template: "dizainas/pages/tokenai",
            },
            {
                slug: "typography",
                label: "Typography",
                description: "Headings, body text, links, and reading rhythm.",
                template: "dizainas/pages/tipografija",
            },
            {
                slug: "layout",
                label: "Layout",
                description: "Containers, grids, and responsive structure.",
                template: "dizainas/pages/isdestymas",
            },
        ],
    },
    {
        slug: "components",
        label: "Components",
        pages: [
            {
                slug: "buttons",
                label: "Buttons",
                description: "Primary actions and button variants.",
                template: "dizainas/pages/mygtukai",
            },
            {
                slug: "forms",
                label: "Forms",
                description: "Inputs, filters, and form controls.",
                template: "dizainas/pages/formos",
            },
            {
                slug: "tables",
                label: "Tables",
                description: "Structured lists and tabular data.",
                template: "dizainas/pages/lenteles",
            },
            {
                slug: "cards",
                label: "Cards",
                description: "Content blocks and card compositions.",
                template: "dizainas/pages/korteles",
            },
            {
                slug: "navigation",
                label: "Navigation",
                description: "Navigation patterns, tabs, breadcrumbs, and pagination.",
                template: "dizainas/pages/navigacija",
            },
            {
                slug: "badges",
                label: "Badges",
                description: "Status and category tagging with badge components.",
                template: "dizainas/pages/zymos",
            },
            {
                slug: "alerts",
                label: "Alerts",
                description: "Info, warning, and error messaging patterns.",
                template: "dizainas/pages/pranesimai",
            },
            {
                slug: "modals",
                label: "Modals",
                description: "Dialogs, confirmations, and temporary focus windows.",
                template: "dizainas/pages/modalai",
            },
            {
                slug: "loaders",
                label: "Loaders",
                description: "Loading states and progress indicators.",
                template: "dizainas/pages/krovikliai",
            },
        ],
    },
    {
        slug: "data",
        label: "Data",
        pages: [
            {
                slug: "summary",
                label: "Summary",
                description: "Key-value pairs and essential factual information.",
                template: "dizainas/pages/suvestine",
            },
            {
                slug: "bars",
                label: "Bars",
                description: "Proportion and comparison visuals using bars.",
                template: "dizainas/pages/juostos",
            },
            {
                slug: "cpv-tree",
                label: "CPV Tree",
                description: "Hierarchical classifier and tree rendering.",
                template: "dizainas/pages/cpv-medis",
            },
            {
                slug: "faq",
                label: "FAQ",
                description: "FAQ-style content disclosure pattern.",
                template: "dizainas/pages/duk",
            },
            {
                slug: "utilities",
                label: "Utilities",
                description: "Utility classes for quick layout and text control.",
                template: "dizainas/pages/pagalbiniai",
            },
        ],
    },
    {
        slug: "visualizations",
        label: "Visualizations",
        pages: [
            {
                slug: "word-cloud",
                label: "Word Cloud",
                description: "Keyword frequency visualization in cloud form.",
                template: "dizainas/pages/zodziu-debesis",
            },
            {
                slug: "map",
                label: "Map",
                description: "Geographical data visualization on a map.",
                template: "dizainas/pages/zemelapis",
            },
            {
                slug: "charts",
                label: "Charts",
                description: "Examples of line, bar, and treemap charts.",
                template: "dizainas/pages/grafikai",
            },
        ],
    },
];

const pages = dizainasSections.flatMap((section) =>
    section.pages.map((page) => ({
        ...page,
        sectionSlug: section.slug,
        sectionLabel: section.label,
        url: `/dizainas/${section.slug}/${page.slug}`,
    })),
);

const defaultPage = pages[0];

const pagesByKey = new Map(
    pages.map((page) => [`${page.sectionSlug}/${page.slug}`, page]),
);

const sectionsBySlug = new Map(
    dizainasSections.map((section) => [section.slug, section]),
);

function renderDocsPage(res, selectedPage) {
    const selectedSection = sectionsBySlug.get(selectedPage.sectionSlug);
    const selectedPageIndex = pages.findIndex(
        (page) =>
            page.sectionSlug === selectedPage.sectionSlug &&
            page.slug === selectedPage.slug,
    );
    const previousPage = selectedPageIndex > 0 ? pages[selectedPageIndex - 1] : null;
    const nextPage =
        selectedPageIndex >= 0 && selectedPageIndex < pages.length - 1
            ? pages[selectedPageIndex + 1]
            : null;

    res.render(selectedPage.template, {
        customHead: config.customHead,
        dizainasSections,
        selectedSection,
        selectedPage,
        previousPage,
        nextPage,
    });
}

dizainasRouter.get("/dizainas", async (req, res) => {
    const homeSection = sectionsBySlug.get(defaultPage.sectionSlug);
    const nextPage = pages.length > 1 ? pages[1] : null;

    res.render("dizainas/dizainas", {
        customHead: config.customHead,
        dizainasSections,
        selectedSection: homeSection,
        selectedPage: defaultPage,
        previousPage: null,
        nextPage,
    });
});

dizainasRouter.get("/dizainas/:sectionSlug/:pageSlug", async (req, res) => {
    const key = `${req.params.sectionSlug}/${req.params.pageSlug}`;
    const selectedPage = pagesByKey.get(key);
    renderDocsPage(res, selectedPage || defaultPage);
});

dizainasRouter.get("/dizainas.png", async (req, res) => {
    await serveOpenGraphImage(
        res,
        "",
        "Design",
        "",
        "viespirkiai.org/dizainas",
    );
});

export default dizainasRouter;
