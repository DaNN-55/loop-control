import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {WorkspacePlanningSelection} from './WorkspacePlanningSelection';
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
