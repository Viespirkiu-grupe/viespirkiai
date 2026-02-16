import hljs from "highlight.js";

/**
 * Highlight a code string for server-side rendering.
 * @param {string} code - The source code to highlight.
 * @param {string} language - Programming language (default: 'javascript').
 * @returns {string} HTML string with syntax highlighting.
 */
export function highlightCode(code, language = "javascript") {
    return hljs.highlight(code, { language }).value;
}
