import {defineConfig} from 'vite';import react from '@vitejs/plugin-react';
export default defineConfig({envFile:false,plugins:[react()],define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('contract')},server:{host:'127.0.0.1',port:5193,strictPort:true}});
