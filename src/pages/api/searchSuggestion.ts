import type { APIRoute } from "astro";
import { searchSuggestions } from "../../lib/searchSuggestions";

export const GET: APIRoute = async ({ url }) => {
    const q = url.searchParams.get("q")?.trim() || "";
    const limit = Math.min(
        20,
        Math.max(1, parseInt(url.searchParams.get("limit") || "8", 10)),
    );
    const saltinis = url.searchParams.get("saltinis")?.trim() || "";

    if (!q) {
        return new Response(JSON.stringify({ suggestions: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    }

    try {
        const suggestions = await searchSuggestions(q, { limit, saltinis });
        return new Response(JSON.stringify({ suggestions }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (err) {
        return new Response(
            JSON.stringify({ error: String(err), suggestions: [] }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" },
            },
        );
    }
};
