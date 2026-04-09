var _a;
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
var defaultPort = Number.parseInt((_a = process.env.PORT) !== null && _a !== void 0 ? _a : '5174', 10);
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
            '@tat': path.resolve(__dirname, './tat')
        }
    },
    server: {
        port: Number.isNaN(defaultPort) ? 5174 : defaultPort,
    },
});
