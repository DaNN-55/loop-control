import {cleanup,render,screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import {AccountWorkspace,SeriesSettings} from './AccountWorkspace';
vi.mock('./AccountDirectoryPanel',()=>({AccountDirectoryPanel:()=>null}));
vi.mock('./SeriesDirectoryPanel',()=>({SeriesDirectoryPanel:()=>null}));
afterEach(cleanup);
const account={id:'a',name:'账号',slug:'account',timezone:'UTC',current_blueprint_version_id:'b'} as any;
const series={id:'s',name:'系列',account_id:'a'} as any;
it('shows the applied version beside the common rule title and keeps all saved text keyboard accessible',()=>{
 render(<AccountWorkspace account={account} accounts={[account]} blueprints={[{id:'b',version:3,policy:{positioning:'第一行\n第二行',tone:'克制'},is_snapshot:false} as any]} isPending="" onSelectAccount={()=>{}}/>);
 const title=screen.getByRole('heading',{name:'通用规则'}).parentElement!;
 expect(within(title).getByText('已应用 · v3')).toBeTruthy();expect(screen.getAllByText(/已应用/)).toHaveLength(1);
 const positioning=screen.getByLabelText('账号定位');expect(positioning).toHaveProperty('readOnly',true);expect(positioning).toHaveProperty('disabled',false);expect(positioning).toHaveProperty('value','第一行\n第二行');
 expect(screen.getByLabelText('语气风格')).toHaveProperty('readOnly',true);
});
it('identifies inherited and overridden values and lets the owner read the final rules',async()=>{
 const user=userEvent.setup();render(<SeriesSettings accountPolicy={{positioning:'账号定位',visual_style:'账号写实风格',restrictions:['禁止夸大'],tone:'克制'}} isPending={false} onCreate={async()=>{}} series={[series]} seriesVersions={[{id:'v2',series_id:'s',version:2,rules:{positioning:'系列定位',restrictions:'禁止误导'}} as any]}/>);
 const title=screen.getByRole('heading',{name:'系列'}).parentElement!;expect(within(title).getByText('已应用 · v2')).toBeTruthy();
 expect(screen.getByLabelText('系列定位')).toHaveProperty('readOnly',true);expect(screen.getByLabelText('视觉风格')).toHaveProperty('value','账号写实风格');
 expect(screen.getByText('本系列覆盖')).toBeTruthy();expect(screen.getAllByText('沿用账号').length).toBeGreaterThan(0);
 await user.click(screen.getByRole('button',{name:'最终生效规则'}));
 const final=screen.getByRole('region',{name:'最终生效规则'});expect(within(final).getByLabelText('视觉风格')).toHaveProperty('value','账号写实风格');expect(within(within(final).getByRole('region',{name:'账号硬约束'})).getByLabelText('限制与禁用内容')).toHaveProperty('value','禁止夸大');expect(within(within(final).getByRole('region',{name:'本系列追加限制'})).getByLabelText('限制与禁用内容')).toHaveProperty('value','禁止误导');expect(within(final).getByLabelText('语气风格')).toHaveProperty('value','克制');
});
it('keeps the current series visible while searching a long list without changing its rules',async()=>{
 const user=userEvent.setup(),many=Array.from({length:25},(_,i)=>({...series,id:`s${i}`,name:`系列 ${i}`}));
 render(<SeriesSettings isPending={false} onCreate={async()=>{}} series={many} seriesVersions={[{id:'version',series_id:'s0',version:1,rules:{positioning:'已选择的规则'}} as any]}/>);
 await user.type(screen.getByRole('searchbox',{name:'查找系列'}),'系列 24');
 expect(screen.getByRole('button',{name:'系列 0'}).getAttribute('aria-current')).toBe('page');
 expect(screen.getByRole('button',{name:'系列 24'})).toBeTruthy();expect(screen.getByLabelText('系列定位')).toHaveProperty('value','已选择的规则');
 await user.clear(screen.getByRole('searchbox',{name:'查找系列'}));expect(screen.getAllByRole('button',{name:'系列 0'})).toHaveLength(1);
});
it('retains the selected series when the series list refreshes with an added item',async()=>{
 const user=userEvent.setup(),many=[{...series,id:'first',name:'第一个系列'},{...series,id:'second',name:'第二个系列'}];
 const props={isPending:false,onCreate:async()=>{},seriesVersions:[]};const view=render(<SeriesSettings {...props} series={many}/>);
 await user.click(screen.getByRole('button',{name:'第二个系列'}));view.rerender(<SeriesSettings {...props} series={[...many,{...series,id:'new',name:'新系列'}]}/>);
 expect(screen.getByRole('button',{name:'第二个系列'}).getAttribute('aria-current')).toBe('page');expect(screen.getByRole('heading',{name:'第二个系列'})).toBeTruthy();
});
