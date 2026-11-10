import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export default defineConfig({
 root,envFile:false,plugins:[react()],
 cacheDir:resolve(root,'.scratch/surface-polish-migration-20261110/vite-cache'),
 optimizeDeps:{entries:['docs/verification/surface-polish-migration-20261110/fixture.html']},
 define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('contract')},
 server:{host:'127.0.0.1',port:5206,strictPort:true},
});
