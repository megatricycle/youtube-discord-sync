import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/e2e/**/*.test.ts'],
        testTimeout: 60_000,
        hookTimeout: 20_000,
        fileParallelism: false,
        maxWorkers: 1,
    },
});
