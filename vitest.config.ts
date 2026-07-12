import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@': root,
            '@design-system': path.join(root, 'src/design-system'),
        },
    },
    test: {
        include: ['test/**/*.test.ts'],
        setupFiles: ['./utils/time.js'],
        hookTimeout: 120_000,
        testTimeout: 120_000,
        fileParallelism: false,
        maxWorkers: 1,
    },
});
