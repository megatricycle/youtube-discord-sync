import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite-plus';

export default defineConfig({
    root: 'src',
    base: '/',
    publicDir: '../public',
    plugins: [react(), tailwindcss()],
    lint: {
        rules: {
            'typescript/no-floating-promises': 'off',
        },
        options: {
            typeAware: true,
            typeCheck: true,
        },
    },
    fmt: {
        printWidth: 80,
        tabWidth: 4,
        singleQuote: true,
        trailingComma: 'all',
    },
    build: {
        outDir: '../dist',
        emptyOutDir: true,
        assetsDir: 'popup/assets',
        rolldownOptions: {
            input: {
                'background/script': 'background/script.ts',
                'discord/script': 'discord/script.ts',
                'youtube/script': 'youtube/script.ts',
                popup: 'popup/index.html',
            },
            output: {
                format: 'es',
                entryFileNames: (chunk) => {
                    const isScriptDirectory = [
                        'background',
                        'discord',
                        'youtube',
                    ].find((directory) =>
                        chunk.facadeModuleId?.endsWith(
                            `/${directory}/script.ts`,
                        ),
                    );

                    return isScriptDirectory
                        ? `${isScriptDirectory}/script.js`
                        : 'popup/assets/[name]-[hash].js';
                },
                chunkFileNames: 'popup/assets/[name]-[hash].js',
                assetFileNames: 'popup/assets/[name]-[hash][extname]',
            },
        },
    },
});
