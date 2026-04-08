# Viešpirkiai

Pilietinės iniciatyvos Viešpirkiai puslapio https://viespirkiai.org kodas.

Daugiau informacijos el. paštu viespirkiai@viespirkiai.org

![Viešpirkių sistemos schema](./assets/viespirkiaiSchema.png)

## Tailwind CSS

Tailwind v4 is set up as an additional stylesheet and is generated into `public/dist/tailwind.css`.
The existing legacy CSS is still active and loaded after Tailwind.

### Documentation

- Tailwind docs: https://tailwindcss.com/docs

### Commands

- Build once:

```bash
npm run build:tailwind
```

- Watch during development:

```bash
npm run watch:tailwind
```

### Project setup files

- PostCSS config: `postcss.config.cjs`
- Tailwind entry file: `styles/tailwind.css` — imports, `@theme`, and `@source` directives
- Custom component .css files stay at `styles` folder
