import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: { '@': root },
    },
    test: {
        include: ['test/**/*.test.ts'],
    },
});
