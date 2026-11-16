// @vitest-environment node
import {it,expect} from 'vitest';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {patchTransitionPlacement} from './openchatcut-transition-placement.mjs';

it('patches actual SDK staging and uses its keyframe/zoom samplers for both transition inputs',async()=>{
 const sdk=process.env.LOOP_TEST_OPENCHATCUT_ROOT??join(process.cwd(),'.loop-control/local/OpenChatCut'),path=join(sdk,'src/gl/GlTransition.tsx'),source=await readFile(path,'utf8'),patched=patchTransitionPlacement(source),captured=await readFile(join(sdk,'src/gl/capturedFrame.ts'),'utf8');
 const {build}=await import(pathToFileURL(join(sdk,'node_modules/esbuild/lib/main.js')).href);
 const start=patched.indexOf('function drawPlaced('),end=patched.indexOf('\nfunction MediaSource('),directory=await mkdtemp('/private/tmp/loop-transition-placement-');
 try{
  const sourceSize=captured.slice(captured.indexOf('export function sourceSize('),captured.indexOf('\n}',captured.indexOf('export function sourceSize('))+2);
  const {outputFiles}=await build({stdin:{contents:`import {sampleKeyframes as loopSampleKeys} from ${JSON.stringify(join(sdk,'src/editor/keyframes.ts'))};import {zoomAt as loopZoomAt} from ${JSON.stringify(join(sdk,'src/editor/zoom.ts'))};${sourceSize}\n${patched.slice(start,end)}\nexport {drawMediaFrame};`,loader:'ts',resolveDir:sdk},bundle:true,platform:'node',format:'esm',write:false});
  const file=join(directory,'staging.mjs');await writeFile(file,outputFiles[0].text);const {drawMediaFrame}=await import(pathToFileURL(file).href);
  const calls:any[]=[],ctx:any={canvas:{width:360,height:640},clearRect(){},save(){},restore(){},translate(...v:any[]){calls.push(['translate',...v]);},scale(...v:any[]){calls.push(['scale',...v]);},rotate(){},drawImage(...v:any[]){calls.push(['image',...v]);}};
  drawMediaFrame(ctx,{naturalWidth:360,naturalHeight:640},'contain',{durationInFrames:91,transform:{scale:1.2},keyframes:{x:[{frame:0,value:0},{frame:90,value:10}]},zoom:{magnification:1.2,envelope:[0,1]}},false,1,45);
  expect(calls).toContainEqual(['translate',198,320]);expect(calls).toContainEqual(['scale',1.2,1.2]);expect(calls).toContainEqual(['scale',1.1,1.1]);
  expect(typeof drawMediaFrame).toBe('function');expect(patched).toContain('absoluteFrame - incoming.startFrame');expect(patched).toContain('absoluteFrame - outgoing.startFrame');
 }finally{await rm(directory,{recursive:true,force:true});}
 expect(()=>patchTransitionPlacement('future unsupported SDK')).toThrow('构图接点');
});
