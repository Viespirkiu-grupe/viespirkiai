/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./views/**/*.ejs",
        "./routes/**/*.js",
        "./public/**/*.js",
    ],
    theme: {
        extend: {
            colors: {
                muted: "var(--gray)",
            },
        },
    },
    plugins: [],
};
