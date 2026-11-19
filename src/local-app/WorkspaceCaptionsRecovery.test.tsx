import {useState} from 'react';
import {webcrypto} from 'node:crypto';
import {localCommand} from './client';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceCaptionsPanel} from './WorkspaceCaptionsPanel';
import {defaultShotCaptionContract} from '../shotCaptions';
import type {ProductionWorkspace} from '../productionWorkspace';

afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it.each([['声学对齐','requestWorkspaceCaptionAlignment'],['正文已核对','confirmWorkspaceCaptionText'],['保存字幕','saveWorkspaceCaptions']])('recovers a committed %s receipt through the real command client after a lost response',async(label,name)=>{
 const contract=defaultShotCaptionContract('待核对字幕','independent');contract.cues=[{id:'cue',text:contract.text,startMs:0,endMs:800}];
 let workspace={id:'receipt-w',episodeId:'receipt-e',scriptRevisionId:'script',revision:2,stale:false,project:{relativePath:'project.json',sha256:'stable-sha',fileSize:2,projectId:'project'},clips:[{id:'clip',itemId:'item',shotId:'S1',text:'镜头'}],captions:[{clipId:'clip',itemId:'item',shotId:'S1',contract,inputFingerprint:'original',timing:'current',textConfirmed:false,audioTrackId:'voice',taskId:null,durationMs:2000}]} as unknown as ProductionWorkspace;
 let writes=0;const receipts=new Map<string,ProductionWorkspace>(),keys:string[]=[],readbacks:string[]=[];
 vi.stubGlobal('crypto',webcrypto);
 vi.stubGlobal('fetch',vi.fn(async(path:string,init?:RequestInit)=>{
  if(path.endsWith('/session'))return Response.json({csrfToken:'caption-receipt'});
  if(!init?.method)return Response.json({workspace});
  if(path.endsWith('/command-receipt')){const request=JSON.parse(String(init.body));readbacks.push(request.operation.idempotencyKey);return Response.json({status:'committed',result:receipts.get(request.operation.idempotencyKey)});}
  const request=JSON.parse(String(init.body));keys.push(request.idempotencyKey);
  if(receipts.has(request.idempotencyKey))return Response.json(receipts.get(request.idempotencyKey));
  writes++;workspace={...workspace,revision:3,project:{...workspace.project,sha256:name==='saveWorkspaceCaptions'?'changed-sha':'stable-sha'},captions:[{...workspace.captions![0],contract:request.data.captionContract??workspace.captions![0].contract,textConfirmed:name==='confirmWorkspaceCaptionText',timing:name==='requestWorkspaceCaptionAlignment'?'waiting':name==='saveWorkspaceCaptions'?'missing':'current'}]};receipts.set(request.idempotencyKey,workspace);
  return Response.json({error:'命令已提交但回执暂不可用'},{status:503});
 }));
 function View(){const [current,setCurrent]=useState(workspace);return <WorkspaceCaptionsPanel workspace={current} command={(name,data)=>localCommand(name,data,undefined,'episode-commands')} onChange={setCurrent}/>;}
 render(<View/>);if(name==='saveWorkspaceCaptions')fireEvent.change(screen.getByRole('textbox',{name:'字幕正文'}),{target:{value:'保存的新字幕'}});fireEvent.click(screen.getByRole('button',{name:label}));await waitFor(()=>{expect(readbacks).toHaveLength(1);expect(screen.getAllByRole('status')).toHaveLength(1);});
 expect(writes).toBe(1);expect(keys).toHaveLength(1);expect(readbacks[0]).toBe(keys[0]);expect(screen.queryByRole('alert')).toBeNull();
 expect(screen.getByRole('status').textContent).toContain(name==='confirmWorkspaceCaptionText'?'正文已核对':name==='saveWorkspaceCaptions'?'待校时':'对齐处理中');
});
