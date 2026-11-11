import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],server:{host:'127.0.0.1',port:5210,strictPort:true},optimizeDeps:{entries:['docs/verification/recycle-bin-migration-20261111/browser/index.html']},cacheDir:'node_modules/.vite-recycle-review'});
