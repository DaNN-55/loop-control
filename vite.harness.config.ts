import {isAbsolute,resolve} from 'node:path';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import postcss from 'postcss';

export default defineConfig({
 envFile:false,publicDir:false,
 define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local'),'process.env.NODE_ENV':JSON.stringify('production')},
 plugins:[react()],
 resolve:{dedupe:['react','react-dom','react-aria','react-stately','react-aria-components']},
 css:{postcss:{plugins:[{postcssPlugin:'loop-native-shadow-document',OnceExit(sheet:postcss.Root){
  // Keep the application's document theme, body and mount selectors local to its shadow tree.
  sheet.walkRules(rule=>{
   if(rule.parent?.type==='atrule'&&rule.parent.name.endsWith('keyframes'))return;
   rule.selector=rule.selector.replace(/(^|[\s>,+(~])(?:html|:root)(?=$|[\s>,.:#\[+~)])/g,'$1.loop-native-scope')
    .replace(/\.loop-native-scope((?:\[[^\]]+\])*)\s+body(?=$|[\s>,.:#\[+~)])/g,'.loop-native-scope$1')
    .replace(/(^|[\s>,+(~])body(?=$|[\s>,.:#\[+~)])/g,'$1.loop-native-scope')
    .replace(/(^|[\s>,+(~])#root(?=$|[\s>,.:#\[+~)])/g,'$1.loop-native-canvas');
  });
 }}]}},
 build:{
  target:'esnext',emptyOutDir:false,outDir:'.scratch/harness-native',cssMinify:false,
  lib:{entry:'src/local-app/harnessNativeEntry.tsx',formats:['es'],fileName:()=> 'loop-control-native.js',cssFileName:'loop-control-native'},
  rollupOptions:{output:{inlineDynamicImports:true}},
 },
});
if(process.argv.includes('--outDir')){
 const output=process.argv[process.argv.indexOf('--outDir')+1];
 if(!output||!isAbsolute(output)||[resolve('dist'),resolve('.')].includes(resolve(output)))throw Error('Use a separate absolute Harness build output directory.');
}
