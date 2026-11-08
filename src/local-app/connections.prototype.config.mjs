// Start: npm exec vite -- --config src/local-app/connections.prototype.config.mjs
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins:[react()], envFile:false, envPrefix:'LOOP_PROTOTYPE_PUBLIC_', publicDir:false,
  server:{host:'127.0.0.1',port:5198,strictPort:true,open:'/src/local-app/connections.prototype.html'},
});
