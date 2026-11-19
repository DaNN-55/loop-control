// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {render,cleanup,act,waitFor} from '@testing-library/react';
import {useEffect,useRef,useState} from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {applyWorkspaceCaptionEdit,isWorkspaceCaptionContract,migrateWorkspaceCaptionLanes} from '../src/workspaceCaptions';
import {defaultShotCaptionContract} from '../src/shotCaptions';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each(['saved','checkpoint-failed','changed-during-checkpoint'])('records a native version before whole-shot replacement without overwriting intervening edits (%s)',async mode=>{
 const host={postMessage:vi.fn()},channel='12345678-1234-1234-1234-123456789abc';
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('parent',host);vi.stubGlobal('location',new URL(`http://127.0.0.1:5175/?lcChannel=${channel}&lcProject=p&lcParent=http%3A%2F%2F127.0.0.1%3A5174#/editor/p`));
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
 const original:any={version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'before',fps:30,items:[],tracks:{},trackOrder:[]}]};
 let current=original;const applyDoc=vi.fn((next:any)=>{current=next;});
 const saveVersion=vi.fn(async(_id:string,_name:string,doc:any)=>{expect(doc).toBe(original);if(mode==='checkpoint-failed')throw Error('history unavailable');if(mode==='changed-during-checkpoint')current={...original,manualEdit:true};});
 const base={get doc(){return current;},state:original.timelines[0],selection:{selectedIds:new Set()},commands:{applyDoc}};
 const source=readFileSync('scripts/openchatcut-embed-client.mjs','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function ','function ');
 const useHost=new Function('useEffect','useRef','browserProjectOwnership','isWorkspaceCandidateEdit','applyWorkspaceCandidate','saveVersion','saveProject','flushProjectSaves',source+'\nreturn useLoopControlHost;')(useEffect,useRef,()=>true,()=>true,(doc:any)=>({...doc,replaced:true}),saveVersion,async()=>({status:'saved'}),async()=>({ok:true}));
 function Editor(){useHost('p',base,{flushBeforeLeaveRef:{current:async()=>true}},{setChatCollapsed:()=>{}});return null;}render(<Editor/>);
 const send=(data:any)=>window.dispatchEvent(new MessageEvent('message',{origin:'http://127.0.0.1:5174',source:host as any,data:{type:'loop-control:command',channel,projectId:'p',...data}}));
 await act(async()=>{send({action:'inspect',requestId:'11111111-1111-1111-1111-111111111111'});});
 await waitFor(()=>expect(host.postMessage.mock.calls.map(c=>c[0]).find(c=>c.requestId==='11111111-1111-1111-1111-111111111111')).toBeTruthy());
 const observed=host.postMessage.mock.calls.map(c=>c[0]).find(c=>c.requestId==='11111111-1111-1111-1111-111111111111').result;
 await act(async()=>{send({action:'apply-candidate',requestId:'22222222-2222-2222-2222-222222222222',expectedRevision:observed.revision,expectedDocumentFingerprint:observed.documentFingerprint,edit:{source:{src:'/media/uploads/abcdef.mp4'},visual:{replacementScope:'shot'}}});});
 await waitFor(()=>expect(host.postMessage.mock.calls.map(c=>c[0]).find(c=>c.requestId==='22222222-2222-2222-2222-222222222222')).toBeTruthy());
 const result=host.postMessage.mock.calls.map(c=>c[0]).find(c=>c.requestId==='22222222-2222-2222-2222-222222222222');
 expect(saveVersion).toHaveBeenCalledOnce();if(mode==='saved'){expect(result.ok,result.error).toBe(true);expect(current.replaced).toBe(true);}else{expect(result.ok).toBe(false);expect(applyDoc).not.toHaveBeenCalled();expect(current.replaced).toBeUndefined();}
});
it('flushes the actual manually edited native captions without rewriting their content or timing',async()=>{
 const host={postMessage:vi.fn()},channel='12345678-1234-1234-1234-123456789abc';
 vi.stubGlobal('parent',host);vi.stubGlobal('location',new URL(`http://127.0.0.1:5175/?lcChannel=${channel}&lcProject=p&lcParent=http%3A%2F%2F127.0.0.1%3A5174#/editor/p`));
 const contract=defaultShotCaptionContract('手工核对后的字幕','independent');contract.cues=[{id:'manual-cue',text:contract.text,startMs:200,endMs:1400}];
 const document=applyWorkspaceCaptionEdit({version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[{id:'shot-two',kind:'image',track:'V1',startFrame:180,durationInFrames:180}],trackOrder:['V1'],tracks:{V1:{kind:'video',name:'video'}},transitions:[],selectedId:null}]},'shot-two',contract);
 let persisted:unknown;const saveProject=vi.fn(async(_id:string,doc:unknown)=>{persisted=structuredClone(doc);return{status:'saved'};}),flushProjectSaves=vi.fn(async()=>({ok:true}));
 const source=readFileSync('scripts/openchatcut-embed-client.mjs','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function ','function ');
 const useHost=new Function('useEffect','useRef','browserProjectOwnership','migrateWorkspaceCaptionLanes','saveProject','flushProjectSaves',source+'\nreturn useLoopControlHost;')(useEffect,useRef,()=>true,migrateWorkspaceCaptionLanes,saveProject,flushProjectSaves);
 function Editor(){useHost('p',{doc:document,state:document.timelines[0],selection:{selectedIds:new Set()},commands:{applyDoc:vi.fn()}},{flushBeforeLeaveRef:{current:async()=>true}},{setChatCollapsed:()=>{}});return null;}
 render(<Editor/>);
 await act(async()=>{window.dispatchEvent(new MessageEvent('message',{origin:'http://127.0.0.1:5174',source:host as any,data:{type:'loop-control:command',channel,projectId:'p',requestId:'11111111-1111-1111-1111-111111111111',action:'flush'}}));});
 await waitFor(()=>expect(host.postMessage.mock.calls.map(call=>call[0]).find(value=>value.type==='loop-control:result')).toMatchObject({ok:true}));
 expect(saveProject).toHaveBeenCalledWith('p',document);expect(persisted).toEqual(document);
});

it.each(['saved','failed','superseded'] as const)('acknowledges the exact second-shot document only after a saved SDK receipt (status=%s)',async status=>{
 const host={postMessage:vi.fn()},channel='12345678-1234-1234-1234-123456789abc';
 vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('parent',host);vi.stubGlobal('location',new URL(`http://127.0.0.1:5175/?lcChannel=${channel}&lcProject=p&lcParent=http%3A%2F%2F127.0.0.1%3A5174#/editor/p`));
 vi.stubGlobal('requestAnimationFrame',(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0));
 let persisted:any,oldDoc:any;
 const saveProject=vi.fn(async(_id:string,doc:any)=>{if(status==='saved')persisted=structuredClone(doc);return{status};});
 const flushProjectSaves=vi.fn(async()=>({ok:true}));
 const source=readFileSync('scripts/openchatcut-embed-client.mjs','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function ','function ');
 const useHost=new Function('useEffect','useRef','browserProjectOwnership','applyWorkspaceCaptionEdit','isWorkspaceCaptionContract','migrateWorkspaceCaptionLanes','saveProject','flushProjectSaves',source+'\nreturn useLoopControlHost;')(useEffect,useRef,()=>true,applyWorkspaceCaptionEdit,isWorkspaceCaptionContract,migrateWorkspaceCaptionLanes,saveProject,flushProjectSaves);
 function Editor(){const [doc,setDoc]=useState<any>(()=>({version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[{id:'shot-two',kind:'image',track:'V1',startFrame:180,durationInFrames:180}],trackOrder:['V1'],tracks:{V1:{kind:'video',name:'video'}},transitions:[],selectedId:null}]}));oldDoc??=doc;
  useHost('p',{doc,state:doc.timelines[0],selection:{selectedIds:new Set()},commands:{applyDoc:setDoc}},{flushBeforeLeaveRef:{current:async()=>{persisted=structuredClone(oldDoc);return true;}}},{setChatCollapsed:()=>{}});return null;}
 render(<Editor/>);
 const send=(message:any)=>window.dispatchEvent(new MessageEvent('message',{origin:'http://127.0.0.1:5174',source:host as any,data:{type:'loop-control:command',channel,projectId:'p',...message}}));
 await act(async()=>{send({action:'inspect',requestId:'11111111-1111-1111-1111-111111111111'});});
 await waitFor(()=>expect(host.postMessage.mock.calls.map(c=>c[0]).find(x=>x.requestId==='11111111-1111-1111-1111-111111111111')).toBeTruthy());
 const observed=host.postMessage.mock.calls.map(c=>c[0]).find(x=>x.requestId==='11111111-1111-1111-1111-111111111111').result;
 const contract=defaultShotCaptionContract('第二镜字幕','independent');contract.cues=[{id:'phrase-1',text:contract.text,startMs:20,endMs:1585}];
 await act(async()=>{send({action:'apply-captions',requestId:'22222222-2222-2222-2222-222222222222',itemId:'shot-two',contract,timingOnly:true,expectedRevision:observed.revision,expectedDocumentFingerprint:observed.documentFingerprint});});
 await waitFor(()=>expect(host.postMessage.mock.calls.map(c=>c[0]).find(x=>x.requestId==='22222222-2222-2222-2222-222222222222')).toBeTruthy());
 const result=host.postMessage.mock.calls.map(c=>c[0]).find(x=>x.requestId==='22222222-2222-2222-2222-222222222222');if(status==='saved'){expect(result.ok,result.error).toBe(true);expect(persisted).toEqual(result.result.document);expect(persisted.timelines[0].tracks['workspace-captions'].captions.sourceEntries[0].words[0].start).toBe(6020);}else{expect(result.ok).toBe(false);expect(result.error).toContain('保存冲突');expect(persisted).toEqual(oldDoc);}
});
