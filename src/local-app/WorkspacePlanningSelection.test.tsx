import {webcrypto} from 'node:crypto';
import {afterEach,it,expect,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {ConnectionPlanningTable,WorkspacePlanningSelection} from './WorkspacePlanningSelection';
const harness={id:'harness-1',account_id:'account',capability:'storyboard_planning' as const,version:1,name:'事实规划',slug:'planning-v1',summary:'保持原文',instructions:'保留事实',content_hash:'a'.repeat(64),is_active:true,created_at:'2026-10-31',created_by:'owner'};
it('selects the existing Codex model and Harness at preparation and saves a persistent draft without submitting work',async()=>{
 const save=vi.fn(async()=>{});render(<WorkspacePlanningSelection draft={{accountId:'account',revision:0,selection:null,promptVersions:[harness]}} pending={false} readOnly={false} onReload={async()=>{}} onSave={save}/>);
 fireEvent.click(screen.getByRole('button',{name:'选择规划模型'}));expect(screen.queryByRole('textbox',{name:'分镜规划 Provider'})).toBeNull();expect(screen.queryByRole('textbox',{name:'分镜规划 Adapter'})).toBeNull();expect(screen.getByText('Codex')).toBeTruthy();fireEvent.change(screen.getByRole('textbox',{name:'分镜规划 模型'}),{target:{value:'gpt-5.6-codex'}});fireEvent.change(screen.getByRole('combobox',{name:'分镜规划 Prompt Harness'}),{target:{value:harness.id}});fireEvent.change(screen.getByRole('spinbutton',{name:'规划额度（分）'}),{target:{value:'42'}});fireEvent.click(screen.getByRole('button',{name:'保存规划选择'}));await waitFor(()=>expect(save).toHaveBeenCalledWith({provider:'codex',adapter:'codex',model:'gpt-5.6-codex',harnessId:harness.id,budgetCents:42,allowedTools:['read','write']},0));
 const harnessSelect=screen.getByRole('combobox',{name:'分镜规划 Prompt Harness'}) as HTMLSelectElement;
 fireEvent.mouseDown(harnessSelect,{button:0});
 const list=screen.getByRole('listbox',{name:'分镜规划 Prompt Harness'});
 const manage=screen.getByRole('button',{name:'管理版本'});
 expect(list.contains(manage)).toBe(false);
 fireEvent.keyDown(list,{key:'Tab'});
 expect(document.activeElement).toBe(manage);
 fireEvent.click(manage);
 expect(screen.getByRole('dialog',{name:'管理分镜规划版本'})).toBeTruthy();
 expect(harnessSelect.value).toBe(harness.id);
 expect(save).toHaveBeenCalledTimes(1);
});

afterEach(()=>{cleanup();vi.unstubAllGlobals();sessionStorage.clear();});
it('accepts the saved episode selection without a second workspace read',async()=>{
 vi.stubGlobal('crypto',webcrypto);let reads=0,writes=0;
 const selection={provider:'codex',adapter:'codex',model:'fixture-model',harnessId:harness.id,budgetCents:0,allowedTools:['read','write']};
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const path=String(input);
  if(path.endsWith('/session'))return Response.json({csrfToken:'fixture'});
  if(init?.method==='POST'){writes++;return Response.json({selection,revision:1});}
  if(path.includes('/workspace')){reads++;return reads===1?Response.json({planningSelection:{accountId:'account',revision:0,selection,promptVersions:[harness]}}):Response.json({error:'读取连接中断'},{status:503});}
  return Response.json({episodes:[],page:1,pageSize:20,total:0});
 }));
 render(<ConnectionPlanningTable initialEpisode={{episodeId:'episode',title:'隔离生产单'}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'保存规划选择'}));
 await screen.findByText('已保存规划配置');
 expect(reads).toBe(1);expect(writes).toBe(1);
});
it('keeps an acknowledged account Harness when refreshing its list fails',async()=>{
 vi.stubGlobal('crypto',webcrypto);let creates=0,reloads=0;
 const created={...harness,id:'harness-2',name:'新规划',version:2};
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).endsWith('/session'))return Response.json({csrfToken:'fixture'});
  if(init?.method==='POST'){creates++;return Response.json(created);}
  reloads++;return reloads===1?Response.json({error:'版本列表中断'},{status:503}):Response.json({promptVersions:[harness,created]});
 }));
 const {localRequest}=await import('./client');
 render(<WorkspacePlanningSelection draft={{accountId:'account',revision:0,selection:null,promptVersions:[harness]}} pending={false} readOnly={false} onSave={async()=>{}} onReload={async()=>{await localRequest('fixture-harness-list');}}/>);
 fireEvent.click(screen.getByRole('button',{name:'选择规划模型'}));
 fireEvent.mouseDown(screen.getByRole('combobox',{name:'分镜规划 Prompt Harness'}),{button:0});
 fireEvent.click(screen.getByRole('button',{name:'管理版本'}));fireEvent.click(screen.getByRole('button',{name:'登记新版本'}));
 fireEvent.change(screen.getByRole('textbox',{name:'版本名称'}),{target:{value:'新规划'}});
 fireEvent.change(screen.getByRole('textbox',{name:'版本摘要'}),{target:{value:'摘要'}});
 fireEvent.change(screen.getByRole('textbox',{name:'Harness 内容'}),{target:{value:'内容'}});
 fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));
 await screen.findByText(/版本列表中断/);
 fireEvent.click(screen.getByRole('button',{name:'保存新版本'}));
 await waitFor(()=>expect(screen.queryByRole('textbox',{name:'版本名称'})).toBeNull());
 expect(creates).toBe(1);expect(reloads).toBe(2);
});
