// @vitest-environment jsdom
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {render,cleanup,act,waitFor} from '@testing-library/react';
import {useEffect,useRef} from 'react';
import {afterEach,it,expect,vi} from 'vitest';
import {applyWorkspaceCaptionEdit,migrateWorkspaceCaptionLanes} from '../src/workspaceCaptions';
import {defaultShotCaptionContract} from '../src/shotCaptions';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it.each(['http://127.0.0.1:5174','http://[::1]:60994'])('flushes the actual manually edited native captions with parent %s without rewriting their content or timing',async(parentOrigin)=>{
 const host={postMessage:vi.fn()},channel='12345678-1234-1234-1234-123456789abc';
 vi.stubGlobal('parent',host);vi.stubGlobal('location',new URL(`http://127.0.0.1:5175/?lcChannel=${channel}&lcProject=p&lcParent=${encodeURIComponent(parentOrigin)}#/editor/p`));
 const contract=defaultShotCaptionContract('手工核对后的字幕','independent');contract.cues=[{id:'manual-cue',text:contract.text,startMs:200,endMs:1400}];
 const document=applyWorkspaceCaptionEdit({version:3,activeTimelineId:'main',assets:[],mediaFolders:[],timelines:[{id:'main',name:'main',order:0,fps:30,width:1080,height:1920,fit:'contain',items:[{id:'shot-two',kind:'image',track:'V1',startFrame:180,durationInFrames:180}],trackOrder:['V1'],tracks:{V1:{kind:'video',name:'video'}},transitions:[],selectedId:null}]},'shot-two',contract);
 let persisted:unknown;const saveProject=vi.fn(async(_id:string,doc:unknown)=>{persisted=structuredClone(doc);return{status:'saved'};}),flushProjectSaves=vi.fn(async()=>({ok:true}));
 const source=readFileSync('scripts/openchatcut-embed-client.mjs','utf8').replace(/^import .*;\n/gm,'').replaceAll('export function ','function ');
 const useHost=new Function('useEffect','useRef','browserProjectOwnership','migrateWorkspaceCaptionLanes','saveProject','flushProjectSaves',source+'\nreturn useLoopControlHost;')(useEffect,useRef,()=>true,migrateWorkspaceCaptionLanes,saveProject,flushProjectSaves);
 function Editor(){useHost('p',{doc:document,state:document.timelines[0],selection:{selectedIds:new Set()},commands:{applyDoc:vi.fn()}},{flushBeforeLeaveRef:{current:async()=>true}},{setChatCollapsed:()=>{}});return null;}
 render(<Editor/>);
 await act(async()=>{window.dispatchEvent(new MessageEvent('message',{origin:parentOrigin,source:host as any,data:{type:'loop-control:command',channel,projectId:'p',requestId:'11111111-1111-1111-1111-111111111111',action:'flush'}}));});
 await waitFor(()=>expect(host.postMessage.mock.calls.map(call=>call[0]).find(value=>value.type==='loop-control:result')).toMatchObject({ok:true}));
 expect(saveProject).toHaveBeenCalledWith('p',document);expect(persisted).toEqual(document);
 await act(async()=>{window.dispatchEvent(new MessageEvent('message',{origin:parentOrigin,source:host as any,data:{type:'loop-control:command',channel,projectId:'p',requestId:'22222222-2222-2222-2222-222222222222',action:'inspect'}}));});
 expect(host.postMessage.mock.calls.map(call=>call[0]).find(value=>value.requestId==='22222222-2222-2222-2222-222222222222')).toMatchObject({ok:true,result:{document}});expect(saveProject).toHaveBeenCalledTimes(1);
 await act(async()=>{window.dispatchEvent(new MessageEvent('message',{origin:parentOrigin,source:host as any,data:{type:'loop-control:command',channel,projectId:'p',requestId:'33333333-3333-3333-3333-333333333333',action:'apply-caption'}}));});
 expect(host.postMessage.mock.calls.map(call=>call[0]).find(value=>value.requestId==='33333333-3333-3333-3333-333333333333')).toMatchObject({ok:false});expect(saveProject).toHaveBeenCalledTimes(1);
});
