import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {BlueprintConfigurationForm} from './ConfigurationForms';
afterEach(cleanup);
it('saves content rules without connected services or a planner and excludes legacy configuration',async()=>{
 const save=vi.fn(async()=>{});render(<BlueprintConfigurationForm initialAssetRoot="/old" initialPolicy={{positioning:'事实',tone:'克制',asset_root:'/old',narration:{credential_ref:'old'},executors:{},allowed_tools:['read']}} isPending={false} onCancel={()=>{}} onSave={save}/>);
 expect(screen.queryByRole('textbox',{name:'资产目录'})).toBeNull();expect(screen.queryByRole('table',{name:'生产能力配置矩阵'})).toBeNull();expect(screen.queryByRole('button',{name:'修改分镜规划配置'})).toBeNull();
 fireEvent.change(screen.getByRole('textbox',{name:'账号定位'}),{target:{value:'原始事实'}});fireEvent.click(screen.getByRole('button',{name:'保存蓝图'}));fireEvent.click(screen.getByRole('button',{name:'确认保存蓝图'}));await waitFor(()=>expect(save).toHaveBeenCalledWith({positioning:'原始事实',tone:'克制'},true));
});
it('shows invalid creative JSON and retains unsaved content for correction',()=>{
 render(<BlueprintConfigurationForm initialAssetRoot="" initialPolicy={{}} isPending={false} onCancel={()=>{}} onSave={async()=>{}}/>);fireEvent.change(screen.getByRole('textbox',{name:'创作规则 JSON'}),{target:{value:'{broken'}});fireEvent.click(screen.getByRole('button',{name:'保存蓝图'}));expect(screen.getByRole('alert').textContent).toContain('JSON');expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('textbox',{name:'创作规则 JSON'})).toHaveProperty('value','{broken');
});
it('historical creative rules are read-only and switching accounts resets the editable draft',()=>{
 const props={initialAssetRoot:'',isPending:false,onCancel:()=>{},onSave:async()=>{}};const view=render(<BlueprintConfigurationForm {...props} initialPolicy={{positioning:'旧规则',tone:'克制'}} readOnly/>);expect(screen.getByRole('textbox',{name:'账号定位'})).toHaveProperty('disabled',true);expect(screen.queryByRole('button',{name:'保存蓝图'})).toBeNull();view.rerender(<BlueprintConfigurationForm {...props} initialPolicy={{positioning:'新账号'}}/>);expect(screen.getByRole('textbox',{name:'账号定位'})).toHaveProperty('value','新账号');
});
