import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
const exec=promisify(execFile);
/** Optional formal UI observation against the same restored native application. */
export async function observeRestoredNativeBrowser(input:{origin:string;email:string;password:string;episode:string;output:string;cacheDirectory:string}){
 const session='t11-restored-'+randomUUID();await mkdir(input.output,{recursive:true});
 const browser=async(...args:string[])=>(await exec('agent-browser',['--session',session,'--headed','--webgpu',...args],{timeout:40000,maxBuffer:2_000_000})).stdout;
 const proxy={target:input.origin,changeOrigin:true,configure(p:any){p.on('proxyReq',(req:any)=>req.setHeader('origin',input.origin));}};
 const vite=await createServer({configFile:false,envFile:false,root:process.cwd(),cacheDir:input.cacheDirectory,define:{'import.meta.env.VITE_LOOP_BACKEND':JSON.stringify('local')},plugins:[react(),{name:'t11-restored-native',configureServer(server){server.middlewares.use('/__t11',async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__t11','<!doctype html><html lang="zh-CN" data-interface="impeccable"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>T11 异地恢复验收</title><div id="root"></div><script type="module" src="/src/local-app/main.tsx"></script>'));});}}],server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}}});
 try{
  await vite.listen();const url=`http://127.0.0.1:${(vite.httpServer!.address() as {port:number}).port}/__t11?episode=${input.episode}`;
  await browser('open',url);await browser('set','viewport','1600','1100');await browser('wait','--text','登录控制台');await browser('find','label','邮箱','fill',input.email);await browser('find','label','密码','fill',input.password);await browser('find','role','button','click','--name','使用密码登录','--exact');await browser('wait','--text','剪辑工作台');await browser('find','role','button','click','--name','剪辑工作台','--exact');
  await browser('wait','--fn','!!document.querySelector("iframe") && !document.querySelector("iframe").hasAttribute("inert")');await pause(2000);
  await writeFile(join(input.output,'native-before.ax.txt'),await browser('snapshot'));await browser('screenshot',join(input.output,'native-before.png'));
  const clickNative=async(name:string)=>{const snapshot=await browser('snapshot'),line=snapshot.split('\n').find(line=>line.includes(`button "${name}"`)),ref=line?.match(/ref=(e\d+)/)?.[1];if(!ref)throw Error('Native control missing: '+name);await browser('click','@'+ref);};
  await clickNative('播放 (空格)');await pause(900);await writeFile(join(input.output,'native-playing.ax.txt'),await browser('snapshot'));await browser('screenshot',join(input.output,'native-playing.png'));await clickNative('暂停 (空格)');await writeFile(join(input.output,'native-paused.ax.txt'),await browser('snapshot'));await browser('screenshot',join(input.output,'native-paused.png'));
  await writeFile(join(input.output,'console.txt'),await browser('console'));await writeFile(join(input.output,'errors.txt'),await browser('errors'));await writeFile(join(input.output,'result.json'),JSON.stringify({formalPage:true,restoredNativeApplication:true,session,flags:['--headed','--webgpu'],playbackControlsExercised:true,screenshotsRequireVisualReview:true},null,2));
 }catch(error){await writeFile(join(input.output,'failure.ax.txt'),await browser('snapshot').catch(()=>''));await writeFile(join(input.output,'errors.txt'),await browser('errors').catch(()=>''));await browser('screenshot',join(input.output,'failure.png')).catch(()=>{});throw error;
 }finally{await browser('close').catch(()=>{});await vite.close();}
}
