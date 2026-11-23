// @vitest-environment node
import {execFile,execFileSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {promisify} from 'node:util';
import type {AddressInfo} from 'node:net';
import {mkdtemp,readFile,rm,truncate,unlink,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {productionWorkspaceFixture} from './productionWorkspace.fixture';
import {productionScriptTemplate} from '../reviews/productionScript';
import {defaultShotCaptionContract} from '../shotCaptions';
import {workspaceTestMedia} from './workspaceTestMedia.fixture';
import {inspectMediaRoot} from './mediaRootSettings';
import {fixtureResources} from './fixtureResources';

type Fixture=Awaited<ReturnType<typeof productionWorkspaceFixture>>;

async function browserDownload(f:Fixture,expected:Buffer){
 const {createServer}=await import('vite'),{default:react}=await import('@vitejs/plugin-react');
 const proxy={target:f.origin,changeOrigin:true,headers:{Origin:f.origin,Cookie:'loop_owner_session='+f.token}};
 const ui=await createServer({
  configFile:false,envFile:false,cacheDir:join(f.root,'vite'),optimizeDeps:{entries:['index.html']},
  plugins:[react({exclude:[/node_modules/,/vite/]})],
  server:{host:'127.0.0.1',port:0,proxy:{'/api':proxy,'/_local-artifact':proxy}},
 });
 const session='batch-publication-'+randomUUID().slice(0,8);
 const browser=async(...args:string[])=>(await promisify(execFile)('agent-browser',['--session',session,...args],{timeout:30000})).stdout;
 const open=()=>browser('find','role','button','click','--name','批量下载发布 ZIP','--exact');
 try{
  await ui.listen();
  await browser('open',`http://127.0.0.1:${(ui.httpServer!.address() as AddressInfo).port}/?view=episodes`);
  await browser('set','viewport','1440','900');
  await browser('wait','--text','四步制作 T02 验收');
  await browser('find','role','checkbox','check','--name','选择 四步制作 T02 验收','--exact');
  await browser('find','role','checkbox','check','--name','选择 四步制作 Ｔ０２ 验收','--exact');
  await open();
  await browser('wait','--text','可下载 2 张，跳过 0 张');
  expect(await browser('snapshot')).toContain('没有已保存的发布文案。');
  const path=join(f.root,'browser-publication.zip');
  await browser('download','dialog a[download]',path);
  expect(await readFile(path)).toEqual(expected);
  await browser('press','Escape');
  expect(await browser('eval',"document.activeElement.textContent.trim()")).toContain('批量下载发布 ZIP');
  await browser('set','viewport','390','844');
  await open();
  await browser('wait','--text','可下载 2 张，跳过 0 张');
  expect(await browser('eval',"document.querySelector('dialog').getBoundingClientRect().width <= innerWidth")).toContain('true');
 }finally{
  await browser('close').catch(()=>{});
  await ui.close();
 }
}

function archiveContents(zip:string):Record<string,string>{
 return JSON.parse(execFileSync('python3',['-c',`
import hashlib, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    assert z.testzip() is None
    print(json.dumps({name: z.read(name).decode() if name.endswith('.txt') else hashlib.sha256(z.read(name)).hexdigest() for name in z.namelist()}))
`,zip],{encoding:'utf8'}));
}

async function successful(request:Promise<{status:number;body:any}>){
 const result=await request;
 expect(result.status,JSON.stringify(result.body)).toBe(200);
 return result.body;
}


it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('previews and downloads the Owner’s confirmed MP4 with the latest saved publication',async()=>{
 const resources=fixtureResources();
 try{
  const testRootParent=await mkdtemp('/private/tmp/loop-batch-publication-');
  resources.defer(()=>rm(testRootParent,{recursive:true,force:true}));
  const {mountPath}=await inspectMediaRoot(testRootParent);
  const f=await productionWorkspaceFixture({testRootParent,runtime:{mountPath,wake(){}}});
  resources.defer(f.close);
  const prepared=await f.request('prepareWorkspace',{reviewPackageId:f.board,expectedScriptRevisionId:f.script});
  expect(prepared.status,JSON.stringify(prepared.body)).toBe(200);
  let w=await f.fillVisuals(prepared.body);
  const send=(command:string,data={})=>f.request(command,{workspaceId:w.id,expectedRevision:w.revision,...data});
  const rendered=await send('exportWorkspace');
  expect(rendered.status,JSON.stringify(rendered.body)).toBe(200);
  w=rendered.body;
  const exported=w.exports[0];
  expect(exported.status).toBe('ready');
  const confirmed=await send('confirmWorkspaceExport',{exportId:exported.id,expectedExportSha256:exported.artifact.sha256,expectedContentSha256:exported.contentSha256});
  expect(confirmed.status,JSON.stringify(confirmed.body)).toBe(200);

  const publication=`episodes/${f.episode}/publication`;
  const content={title:'旧标题',description:'简介第一行\n第二行',tags:['#测试','中文'],instruction:'私有补充要求'};
  const saved=await f.post(publication,'save',{expectedRevision:0,content});
  expect(saved.status,JSON.stringify(saved.body)).toBe(200);
  const latest=await f.post(publication,'save',{expectedRevision:saved.body.revision,content:{...content,title:'最新标题'}});
  expect(latest.status,JSON.stringify(latest.body)).toBe(200);

  const read=(path:string,token=f.token)=>fetch(f.origin+path,{headers:{Cookie:'loop_owner_session='+token}});
  const endpoint='/api/local/batch-publication-download?episode='+f.episode;
  const response=await read(endpoint);
  expect(response.status).toBe(200);
  const preview=await response.json();
  expect(preview.items).toMatchObject([{episodeId:f.episode,title:'四步制作 T02 验收',status:'ready',cover:false,text:true}]);
  const download=await read(preview.downloadUrl);
  expect(download.status).toBe(200);
  expect(download.headers.get('content-disposition')).toContain('attachment');
  const bytes=Buffer.from(await download.arrayBuffer());
  expect(Number(download.headers.get('content-length'))).toBe(bytes.length);
  expect(preview.bytes).toBe(bytes.length);
  const zip=join(f.root,'batch-release.zip');
  await writeFile(zip,bytes);
  const archived=archiveContents(zip);
  expect(archived).toEqual({
   '四步制作 T02 验收/四步制作 T02 验收.mp4':exported.artifact.sha256,
   '四步制作 T02 验收/发布资料.txt':'标题\n最新标题\n\n简介\n简介第一行\n第二行\n\n标签\n测试、中文\n',
  });
  const denied=await (await read(endpoint,f.otherToken)).json();
  expect(denied.items).toMatchObject([{episodeId:f.episode,status:'skipped'}]);
  expect(denied.items[0]).not.toHaveProperty('title');
  expect(denied.downloadUrl).toBeNull();
  expect((await read(preview.downloadUrl,f.otherToken)).status).toBe(409);

  const secondAccount=await successful(f.post('configuration','createAccount',{name:'发布验收账号',slug:'batch-release-fixture',timezone:'Asia/Shanghai',policy:{}}));
  const second=await successful(f.post('episode-commands','create',{accountId:secondAccount.id,title:'四步制作 Ｔ０２ 验收'}));
  const secondRequest=(command:string,data:Record<string,unknown>={})=>f.request(command,{episodeId:second.id,...data});
  const script=await successful(secondRequest('importMaterial',{sourceKind:'file',sourcePath:'script.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,contentBase64:Buffer.from(productionScriptTemplate).toString('base64')}));
  await successful(secondRequest('start'));
  const coverBytes=await readFile(workspaceTestMedia('still-striped.png'));
  const image=await successful(secondRequest('importMaterial',{sourceKind:'file',sourcePath:'still.png',materialType:'image',materialPurpose:'visual_reference',mimeType:'image/png',isMainScript:false,contentBase64:coverBytes.toString('base64')}));
  let workspace=await successful(secondRequest('prepareWorkspace',{expectedScriptRevisionId:script.id}));
  async function edit(command:string,data={}){
   workspace=await successful(secondRequest(command,{workspaceId:workspace.id,expectedRevision:workspace.revision,...data}));
  }
  for(const clip of workspace.clips){
   await edit('matchWorkspaceImage',{clipId:clip.id,materialRevisionId:image.id,usage:'still',durationSeconds:2,fit:'contain',focusX:.5,focusY:.5});
   await edit('saveWorkspaceCaptions',{clipId:clip.id,captionContract:defaultShotCaptionContract(clip.text,'independent',false)});
  }
  await edit('exportWorkspace');
  const secondExport=workspace.exports[0];
  expect(secondExport.status).toBe('ready');

  const bothEndpoint=endpoint+'&episode='+second.id;
  const unconfirmed=await (await read(bothEndpoint)).json();
  expect(unconfirmed.items[1]).toMatchObject({episodeId:second.id,status:'skipped',reason:'当前成片未确认或没有可用的 MP4。'});
  await edit('confirmWorkspaceExport',{exportId:secondExport.id,expectedExportSha256:secondExport.artifact.sha256,expectedContentSha256:secondExport.contentSha256});
  const savedCover=await successful(f.post(publication,'cover',{expectedRevision:latest.body.revision,kind:'upload',name:'封面.png',base64:coverBytes.toString('base64')}));
  expect((await read(preview.downloadUrl)).status).toBe(409);

  const both=await (await read(bothEndpoint)).json();
  expect(both.items).toMatchObject([
   {episodeId:f.episode,folder:'四步制作 T02 验收',status:'ready',cover:true,text:true},
   {episodeId:second.id,folder:'四步制作 T02 验收 (2)',status:'ready',cover:false,text:false,warnings:['没有已保存的封面。','没有已保存的发布文案。']},
  ]);
  const bothResponse=await read(both.downloadUrl);
  expect(bothResponse.status).toBe(200);
  const bothBytes=Buffer.from(await bothResponse.arrayBuffer());
  expect(both.bytes).toBe(bothBytes.length);
  await writeFile(zip,bothBytes);
  expect(archiveContents(zip)).toEqual({...archived,
   '四步制作 T02 验收/封面.png':createHash('sha256').update(coverBytes).digest('hex'),
   '四步制作 T02 验收 (2)/四步制作 T02 验收 (2).mp4':secondExport.artifact.sha256,
  });
  if(process.env.LOOP_BATCH_PUBLICATION_BROWSER==='1')await browserDownload(f,bothBytes);
  await unlink(join(f.assetRoot,savedCover.cover.file.relativePath));
  expect((await read(both.downloadUrl)).status).toBe(409);
  const degraded=await (await read(bothEndpoint)).json();
  expect(degraded.items[0]).toMatchObject({episodeId:f.episode,status:'ready',cover:false,text:true,warnings:['封面缺失或文件指纹已变化。']});

  // Append sparse zeroes to valid MP4 bytes. Set up a real, verifiable archive
  // whose aggregate size exceeds ZIP32 without allocating or downloading 4 GiB.
  const secondRoot=(await f.c.query('SELECT actual_root FROM local_identity.account_asset_directories WHERE account_id=$1',[secondAccount.id])).rows[0].actual_root;
  const secondPath=join(secondRoot,secondExport.artifact.relativePath);
  const secondBytes=await readFile(secondPath),largeSize=2**32-1024;
  await truncate(secondPath,largeSize);
  const hash=createHash('sha256').update(secondBytes),zeroes=Buffer.alloc(4*1024**2);
  for(let remaining=largeSize-secondBytes.length;remaining>0;remaining-=zeroes.length)hash.update(zeroes.subarray(0,Math.min(remaining,zeroes.length)));
  await f.c.query('UPDATE local_identity.workspace_exports SET artifact=$2 WHERE id=$1',[secondExport.id,{...secondExport.artifact,fileSize:largeSize,sha256:hash.digest('hex')}]);
  const oversizedResponse=await read(bothEndpoint);
  expect(oversizedResponse.status).toBe(200);
  const oversized=await oversizedResponse.json();
  expect(oversized.items.map((item:{status:string})=>item.status)).toEqual(['ready','ready']);
  expect(oversized.bytes).toBeGreaterThan(2**32);
  expect(oversized.blockedReason).toContain('4 GiB');
  expect(oversized.downloadUrl).toBeNull();

  await writeFile(join(f.assetRoot,exported.artifact.relativePath),'changed');
  expect((await read(preview.downloadUrl)).status).toBe(409);
  const changed=await (await read(endpoint)).json();
  expect(changed.items).toMatchObject([{episodeId:f.episode,status:'skipped',reason:'成片缺失或文件指纹已变化。'}]);
  expect(changed.downloadUrl).toBeNull();
 }finally{await resources.close();}
},180000);
