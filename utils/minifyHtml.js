import { minify } from "html-minifier-terser";

/**
 * Express middleware to minify HTML responses.
 * Works with async routes and custom render functions.
 *
 * Usage: place before routes or at the top of your app.
 */
export default function htmlMinifyMiddleware(options = {}) {
    const defaultOptions = {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeEmptyAttributes: true,
        minifyJS: true,
        minifyCSS: true,
        ...options,
    };

    return (req, res, next) => {
        // Wrap res.send
        const originalSend = res.send.bind(res);

        res.send = async (body) => {
            // Only minify HTML strings
            if (!res.get("Content-Type")) {
                res.type("html");
            }

            let contentType = res.get("Content-Type") || "";
            if (typeof body === "string" && contentType.includes("text/html")) {
                try {
                    const minified = await minify(body, defaultOptions);
                    return originalSend(minified);
                } catch (err) {
                    console.error("HTML minify error:", err);
                    return originalSend(body); // fallback to unminified
                }
            }
            return originalSend(body);
        };

        next();
    };
}
