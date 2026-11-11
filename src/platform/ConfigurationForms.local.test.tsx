import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {BlueprintConfigurationForm,PromptVersionManager} from './ConfigurationForms';
afterEach(cleanup);
it('saves content rules without connected services or a planner and excludes legacy configuration',async()=>{
 const save=vi.fn(async()=>{});render(<BlueprintConfigurationForm initialAssetRoot="/old" initialPolicy={{positioning:'事实',tone:'克制',asset_root:'/old',narration:{credential_ref:'old'},executors:{},allowed_tools:['read']}} isPending={false} onCancel={()=>{}} onSave={save}/>);
 expect(screen.queryByRole('textbox',{name:'资产目录'})).toBeNull();expect(screen.queryByRole('table',{name:'生产能力配置矩阵'})).toBeNull();expect(screen.queryByRole('button',{name:'修改分镜规划配置'})).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'账号定位'}),{target:{value:'原始事实'}});fireEvent.click(screen.getByRole('button',{name:'保存蓝图'}));fireEvent.click(screen.getByRole('button',{name:'确认保存蓝图'}));await waitFor(()=>expect(save).toHaveBeenCalledWith({positioning:'原始事实',tone:'克制'},true));
});
it('edits readable creative fields without losing nested values or reintroducing technical keys',async()=>{
 const save=vi.fn(async()=>{});const extension={flags:[true,false],limits:{max:3},custom:null};
 render(<BlueprintConfigurationForm initialAssetRoot="" initialPolicy={{tone:'克制',restrictions:['不夸大','不使用商标'],extension}} isPending={false} onCancel={()=>{}} onSave={save}/>);
 expect(screen.queryByRole('textbox',{name:'创作规则 JSON'})).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'语气风格'}),{target:{value:'自然'}});
 fireEvent.change(screen.getByRole('textbox',{name:'限制与禁用内容'}),{target:{value:'不夸大\n不误导'}});
 fireEvent.click(screen.getByRole('button',{name:'保存蓝图'}));fireEvent.click(screen.getByRole('button',{name:'确认保存蓝图'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith({positioning:'',tone:'自然',restrictions:['不夸大','不误导'],extension},true));
 for(const field of screen.getAllByRole('textbox').filter(node=>node.tagName==='TEXTAREA'))expect(field.getAttribute('rows')).toBe('2');
});
it('historical creative rules are read-only and switching accounts resets the editable draft',()=>{
 const props={initialAssetRoot:'',isPending:false,onCancel:()=>{},onSave:async()=>{}};const view=render(<BlueprintConfigurationForm {...props} initialPolicy={{positioning:'旧规则',tone:'克制'}} readOnly/>);expect(screen.getByRole('textbox',{name:'账号定位'})).toHaveProperty('readOnly',true);expect(screen.queryByRole('button',{name:'保存蓝图'})).toBeNull();view.rerender(<BlueprintConfigurationForm {...props} initialPolicy={{positioning:'新账号'}}/>);expect(screen.getByRole('textbox',{name:'账号定位'})).toHaveProperty('value','新账号');
});
it('keeps boolean and numeric rule types when editing nested fields',async()=>{
 const save=vi.fn(async()=>{});render(<BlueprintConfigurationForm initialAssetRoot="" initialPolicy={{extension:{enabled:true,limit:3}}} isPending={false} onCancel={()=>{}} onSave={save}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'enabled'}));
 fireEvent.change(screen.getByRole('spinbutton',{name:'limit'}),{target:{value:'5'}});
 fireEvent.click(screen.getByRole('button',{name:'保存蓝图'}));fireEvent.click(screen.getByRole('button',{name:'确认保存蓝图'}));
 await waitFor(()=>expect(save).toHaveBeenCalledWith({positioning:'',extension:{enabled:false,limit:5}},true));
});

it('does not select a late Harness after its manager was closed',async()=>{
 const late={id:'late',account_id:'account',capability:'storyboard_planning' as const,version:1,name:'旧规划',slug:'late',summary:'摘要',instructions:'内容',content_hash:'a'.repeat(64),is_active:true,created_at:'2026-11-11',created_by:'owner'};
 let finish!:(value:typeof late)=>void;const create=vi.fn(()=>new Promise<typeof late>(resolve=>{finish=resolve;})),select=vi.fn();
 const view=render(<PromptVersionManager fixedCapability="storyboard_planning" isPending={false} onClose={()=>{}} onCreate={create} onSelect={select} promptVersions={[]}/>);
 fireEvent.click(screen.getByRole('button',{name:'登记新版本'}));
 const name=screen.getByRole('textbox',{name:'版本名称'});
 fireEvent.change(name,{target:{value:'新规划'}});fireEvent.change(screen.getByRole('textbox',{name:'版本摘要'}),{target:{value:'摘要'}});fireEvent.change(screen.getByRole('textbox',{name:'Harness 内容'}),{target:{value:'内容'}});
 act(()=>{fireEvent.submit(name.closest('form')!);fireEvent.submit(name.closest('form')!);});
 expect(create).toHaveBeenCalledTimes(1);view.unmount();
 await act(async()=>{finish(late);});expect(select).not.toHaveBeenCalled();
});
