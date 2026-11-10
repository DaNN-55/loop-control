import {useState} from 'react';
import {webcrypto} from 'node:crypto';
import {localCommand} from './client';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceVisualPreparation} from './WorkspaceVisualPreparation';
import type {ProductionWorkspace} from '../productionWorkspace';

let fixtureId=0;
function setup(){
 const id=`upload-workspace-${++fixtureId}`;
 let workspace={id,episodeId:`episode-${id}`,revision:1,workflowVersion:'four-step/v1',clips:[{id:'clip',itemId:'target',shotId:'shot',text:'镜头',source:null}],visualCandidates:[],visualTasks:[],visualTargets:[],selectedImages:[],stale:false} as unknown as ProductionWorkspace;
 const imports:string[]=[],registrations:string[]=[],startedImports:string[]=[];
 let failImport='bad.png',failRegistration='';
 let pause:{name:string;wait:Promise<void>}|undefined,registrationPause:Promise<void>|undefined,loseRegistrationResponse=false;
 const command=async(name:string,value:unknown)=>{
  const data=value as Record<string,string>;
  if(name==='importMaterial'){
   startedImports.push(data.sourcePath);
   if(pause?.name===data.sourcePath)await pause.wait;
   if(data.sourcePath===failImport)throw Error('图片内容无法解码。');
   imports.push(data.sourcePath);
   return {id:data.sourcePath,source_path:data.sourcePath,material_type:'image',storage_path:`media/${data.sourcePath}`};
  }
  if(name==='registerWorkspaceVisualCandidate'){
   if(data.materialRevisionId===failRegistration)throw Error('候选登记暂时失败。');
   registrations.push(data.materialRevisionId);
   if(registrationPause)await registrationPause;
   workspace={...workspace,revision:workspace.revision+1,visualCandidates:[...workspace.visualCandidates??[],{id:`candidate-${registrations.length}`,targetItemId:data.targetItemId,materialRevisionId:data.materialRevisionId,kind:'image',relativePath:`media/${data.materialRevisionId}`,sha256:'sha',status:'available',durationSeconds:3,currentDurationSeconds:3} as NonNullable<ProductionWorkspace['visualCandidates']>[number]]};
   if(loseRegistrationResponse){loseRegistrationResponse=false;throw Error('连接中断，候选结果尚未确认。');}
   return workspace;
  }
  throw Error(`Unexpected command ${name}`);
 };
 vi.stubGlobal('fetch',vi.fn(async()=>Response.json({workspace})));
 function View(){const [value,setValue]=useState(workspace);return <WorkspaceVisualPreparation workspace={value} command={command} onChange={setValue} materials={[]}/>;}
 return {View,imports,registrations,startedImports,command,pauseRegistration(){let resume!:()=>void;registrationPause=new Promise<void>(resolve=>{resume=resolve;});return resume;},set loseRegistrationResponse(value:boolean){loseRegistrationResponse=value;},pauseImport(name:string){let resume!:()=>void;pause={name,wait:new Promise<void>(resolve=>{resume=resolve;})};return resume;},get workspace(){return workspace;},set failImport(value:string){failImport=value;},set failRegistration(value:string){failRegistration=value;}};
}
const image=(name:string)=>new File(['image fixture'],name,{type:'image/png'});
function choose(files:File[]){fireEvent.change(screen.getByLabelText('上传图片素材'),{target:{files}});}
function uploadResults(){return screen.getByRole('region',{name:'上传结果'});}
afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});

it('批量上传仅保留未完成项，只重试失败项，成功后移除恢复区并支持下一批',async()=>{
 const fixture=setup();render(<fixture.View/>);
 choose([image('first.png'),image('bad.png'),image('last.png')]);
 await waitFor(()=>expect(fixture.registrations).toEqual(['first.png','last.png']));
 await waitFor(()=>expect(screen.getByRole('button',{name:'重试未完成项'}).hasAttribute('disabled')).toBe(false));
 const results=uploadResults();
 expect(within(results).queryByText('last.png')).toBeNull();expect(within(results).queryByText('first.png')).toBeNull();
 expect(within(results).getByText('bad.png').closest('li')?.textContent).toContain('失败');
 expect(within(results).getByText(/图片内容无法解码/)).toBeTruthy();
 expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(2);
 fixture.failImport='';fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));
 await waitFor(()=>expect(fixture.registrations).toEqual(['first.png','last.png','bad.png']));
 expect(fixture.imports).toEqual(['first.png','last.png','bad.png']);
 choose([image('second-batch.png')]);
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(4));
 await waitFor(()=>expect(screen.queryByRole('region',{name:'上传结果'})).toBeNull());expect(screen.queryByLabelText('上传记录')).toBeNull();
});

it('关闭重开保留真实处理中与未处理项，收到导入回执后只补登记候选',async()=>{
 const fixture=setup(),resume=fixture.pauseImport('in-flight.png');
 const view=render(<fixture.View/>);
 choose([image('in-flight.png'),image('waiting.png')]);
 const results=uploadResults();
 await waitFor(()=>expect(within(results).getByText('in-flight.png').closest('li')?.textContent).toContain('处理中'));
 expect(within(results).getByText('waiting.png').closest('li')?.textContent).toContain('未处理');
 expect(screen.getByRole('status',{name:'图片候选上传中'})).toBeTruthy();
 expect(screen.queryByText('尚未添加图片')).toBeNull();
 await waitFor(()=>expect(fixture.startedImports).toEqual(['in-flight.png']));
 view.unmount();render(<fixture.View/>);
 const reopened=within(uploadResults());
 expect(reopened.getByText('in-flight.png').closest('li')?.textContent).toContain('处理中');
 await act(async()=>{resume();});
 await waitFor(()=>expect(reopened.getByText('in-flight.png').closest('li')?.textContent).toContain('未处理'));
 expect(reopened.getByText('in-flight.png').closest('li')?.textContent).toContain('素材已导入');
 expect(fixture.registrations).toEqual([]);expect(fixture.imports).toEqual(['in-flight.png']);
 fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(2));
 expect(fixture.imports).toEqual(['in-flight.png','waiting.png']);
 expect(fixture.registrations).toEqual(['in-flight.png','waiting.png']);
});

it('素材导入成功但候选登记失败后，关闭重开重试不会再次导入',async()=>{
 const fixture=setup();fixture.failRegistration='retry-candidate.png';
 const view=render(<fixture.View/>);choose([image('retry-candidate.png')]);
 await waitFor(()=>expect(uploadResults().textContent).toContain('素材已导入，候选未完成：候选登记暂时失败'));
 view.unmount();render(<fixture.View/>);fixture.failRegistration='';
 fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));
 fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(1));
 expect(fixture.imports).toEqual(['retry-candidate.png']);
 expect(fixture.registrations).toEqual(['retry-candidate.png']);
 expect(screen.queryByRole('button',{name:'重试未完成项'})).toBeNull();
});

it('候选已登记但响应丢失时，重试核对现有候选，不重复导入或登记',async()=>{
 const fixture=setup();fixture.loseRegistrationResponse=true;render(<fixture.View/>);
 choose([image('response-lost.png')]);
 await waitFor(()=>expect(uploadResults().textContent).toContain('连接中断，候选结果尚未确认'));
 fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(1));
 expect(fixture.imports).toEqual(['response-lost.png']);expect(fixture.registrations).toEqual(['response-lost.png']);
});
it('候选登记进行中关闭并立即重开，完成后同步已登记候选',async()=>{
 const fixture=setup(),resume=fixture.pauseRegistration(),view=render(<fixture.View/>);
 choose([image('register-in-flight.png')]);
 await waitFor(()=>expect(fixture.registrations).toEqual(['register-in-flight.png']));
 view.unmount();render(<fixture.View/>);
 await act(async()=>{resume();});
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(1));
 await waitFor(()=>expect(screen.queryByRole('region',{name:'上传结果'})).toBeNull());
 expect(fixture.imports).toEqual(['register-in-flight.png']);
});

it('导入提交成功但网络回执丢失时，真实命令客户端复用幂等回执',async()=>{
 const fixture=setup();let workspace=fixture.workspace,imported=0,lost=false;
 const receipts=new Map<string,unknown>(),importKeys:string[]=[];
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'upload-csrf'});
  if(!init?.method)return Response.json({workspace});
  const body=JSON.parse(String(init.body)) as {command:string;idempotencyKey:string;data:Record<string,string>};
  if(body.command==='importMaterial')importKeys.push(body.idempotencyKey);
  if(receipts.has(body.idempotencyKey))return Response.json(receipts.get(body.idempotencyKey));
  if(body.command==='importMaterial'){
   imported++;
   const material={id:'once-only-material',source_path:body.data.sourcePath,material_type:'image',storage_path:'media/once.png'};
   receipts.set(body.idempotencyKey,material);
   if(!lost){lost=true;throw new TypeError('网络连接中断。');}
   return Response.json(material);
  }
  if(body.command==='registerWorkspaceVisualCandidate'){
   workspace={...workspace,revision:2,visualCandidates:[{id:'once-candidate',targetItemId:'target',materialRevisionId:'once-only-material',kind:'image',relativePath:'media/once.png',sha256:'sha',status:'available',durationSeconds:3,currentDurationSeconds:3} as NonNullable<ProductionWorkspace['visualCandidates']>[number]]};
   receipts.set(body.idempotencyKey,workspace);return Response.json(workspace);
  }
  throw Error('Unexpected HTTP command');
 }));
 function View(){const [value,setValue]=useState(workspace);return <WorkspaceVisualPreparation workspace={value} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onChange={setValue} materials={[]}/>;}
 render(<View/>);choose([image('network-retry.png')]);
 await waitFor(()=>expect(uploadResults().textContent).toContain('网络连接中断。'));
 fireEvent.click(screen.getByRole('button',{name:'重试未完成项'}));
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(1));
 expect(imported).toBe(1);expect(importKeys).toHaveLength(2);expect(importKeys[1]).toBe(importKeys[0]);
});

it('切换目标或生产单不显示上一目标的上传结果，返回原目标可继续',async()=>{
 const fixture=setup(),workspace={...fixture.workspace,clips:[...fixture.workspace.clips,{id:'clip-two',itemId:'target-two',shotId:'shot-two',text:'另一镜头',source:null}]};
 const props={workspace,command:fixture.command,onChange:()=>{},materials:[]};
 const view=render(<WorkspaceVisualPreparation {...props} selectedTargetItemId="target"/>);
 choose([image('bad.png')]);await waitFor(()=>expect(uploadResults().textContent).toContain('图片内容无法解码。'));
 view.rerender(<WorkspaceVisualPreparation {...props} selectedTargetItemId="target-two"/>);
 expect(screen.queryByRole('region',{name:'上传结果'})).toBeNull();
 view.rerender(<WorkspaceVisualPreparation {...props} selectedTargetItemId="target"/>);
 expect(within(uploadResults()).getByText('bad.png')).toBeTruthy();
 view.rerender(<WorkspaceVisualPreparation {...props} workspace={{...workspace,episodeId:'different-episode'}} selectedTargetItemId="target"/>);
 expect(screen.queryByRole('region',{name:'上传结果'})).toBeNull();
});
it('逐文件保留空文件与超过 100 MB 的拒绝结果，继续导入有效文件',async()=>{
 const fixture=setup();render(<fixture.View/>);
 const large=image('oversize.png');Object.defineProperty(large,'size',{value:100*1024*1024+1});
 choose([new File([],'empty.png',{type:'image/png'}),large,image('valid.png')]);
 await waitFor(()=>expect(screen.getAllByRole('button',{name:/预览图片候选/})).toHaveLength(1));
 const results=within(uploadResults());
 expect(results.getByText('empty.png').closest('li')?.textContent).toContain('失败');
 expect(results.getByText('oversize.png').closest('li')?.textContent).toContain('100 MB');
 expect(fixture.imports).toEqual(['valid.png']);
});
it('参考图保留每张 20 MB 与每次最多 16 张的接收限制',async()=>{
 const fixture=setup();render(<fixture.View/>);
 fireEvent.click(screen.getByRole('button',{name:'AI 生成'}));
 const large=image('large-reference.png');Object.defineProperty(large,'size',{value:20*1024*1024+1});
 fireEvent.change(screen.getByLabelText('导入生成参考图'),{target:{files:[large]}});
 await waitFor(()=>expect(uploadResults().textContent).toContain('每张参考图不能超过 20 MB。'));
 expect(fixture.imports).toEqual([]);
 fireEvent.change(screen.getByLabelText('导入生成参考图'),{target:{files:Array.from({length:17},(_,i)=>image(`ref-${i}.png`))}});
 await screen.findByRole('status',{name:'上传提示'});expect(screen.getByRole('status',{name:'上传提示'}).textContent).toContain('最多可添加 16 张参考图');
 expect(fixture.imports).toEqual([]);
});

it('不支持的本地文件显示提示及可恢复详情，不发起素材导入',async()=>{
 const fixture=setup();render(<fixture.View/>);choose([new File(['local validation only'],'invalid.txt',{type:'text/plain'})]);
 const notice=await screen.findByRole('status',{name:'上传提示'});expect(notice.textContent).toContain('请选择有效的图片文件');expect(fixture.startedImports).toEqual([]);expect(screen.queryByLabelText('上传记录')).toBeNull();expect(uploadResults().textContent).toContain('invalid.txt');
});
