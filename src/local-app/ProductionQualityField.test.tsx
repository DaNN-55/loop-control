import {cleanup,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ProductionQualityField} from './ProductionQualityField';
import {EpisodeForm} from '../episodes/EpisodeForm';
import type {Database} from '../lib/database.types';
const {request,command}=vi.hoisted(()=>({request:vi.fn(),command:vi.fn()}));
vi.mock('./client',()=>({localRequest:request,localCommand:command}));
const accounts=[{id:'fixture',name:'测试账号',current_blueprint_version_id:'blueprint'}] as Database['public']['Tables']['accounts']['Row'][];
beforeEach(()=>{request.mockReset();command.mockReset();});
afterEach(cleanup);

it('preserves the create payload and hides quality while collection is disabled',async()=>{
 const submit=vi.fn(async()=>null),user=userEvent.setup();
 render(<EpisodeForm accounts={accounts} isPending={false} onClose={()=>{}} onSubmit={submit} series={[]} seriesVersions={[]}/>);
 expect(screen.queryByRole('combobox',{name:'业务质量档'})).toBeNull();
 await user.click(screen.getByRole('button',{name:'创建生产单'}));
 expect(submit).toHaveBeenCalledWith({title:'',accountId:'fixture',isTest:false,seriesVersionId:null});
});
it('offers an optional unspecified tier and submits only the explicit selection on create',async()=>{
 const submit=vi.fn(async()=>null),user=userEvent.setup();
 render(<EpisodeForm productionMetricsEnabled accounts={accounts} isPending={false} onClose={()=>{}} onSubmit={submit} series={[]} seriesVersions={[]}/>);
 expect((screen.getByRole('combobox',{name:'业务质量档'}) as HTMLSelectElement).value).toBe('unspecified');
 await user.selectOptions(screen.getByRole('combobox',{name:'业务质量档'}),'high');expect(submit).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'创建生产单'}));
 expect(submit).toHaveBeenCalledWith({title:'',accountId:'fixture',isTest:false,seriesVersionId:null,businessQualityTier:'high'});
});
it('requires an explicit save with the current revision and keeps the frozen saved tier on reopen',async()=>{
 request.mockResolvedValue({enabled:true,tier:'low',revision:1});command.mockResolvedValue({tier:'high',revision:2});
 const user=userEvent.setup(),view=render(<ProductionQualityField episodeId="episode"/>);
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'业务质量档'}) as HTMLSelectElement).value).toBe('low'));
 await user.selectOptions(screen.getByRole('combobox',{name:'业务质量档'}),'high');expect(command).not.toHaveBeenCalled();
 await user.click(screen.getByRole('button',{name:'保存质量档'}));
 expect(command).toHaveBeenCalledWith('setProductionQuality',{episodeId:'episode',tier:'high',expectedRevision:1},undefined,'episode-commands');
 expect((await screen.findByRole('status')).textContent).toContain('业务质量档已保存。');view.unmount();
 request.mockResolvedValue({enabled:true,tier:'high',revision:2});render(<ProductionQualityField episodeId="episode"/>);
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'业务质量档'}) as HTMLSelectElement).value).toBe('high'));
 expect(screen.queryByRole('button',{name:'保存质量档'})).toBeNull();
});
it('retains a conflicting draft and displays the failure without claiming it was saved',async()=>{
 request.mockResolvedValue({enabled:true,tier:'low',revision:1});command.mockRejectedValue(new Error('质量档已变化，请重新打开后核对。'));
 const user=userEvent.setup();render(<ProductionQualityField episodeId="episode"/>);
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'业务质量档'}) as HTMLSelectElement).value).toBe('low'));
 await user.selectOptions(screen.getByRole('combobox',{name:'业务质量档'}),'medium');await user.click(screen.getByRole('button',{name:'保存质量档'}));
 expect((await screen.findByRole('alert')).textContent).toContain('质量档已变化');expect(screen.queryByRole('status')).toBeNull();
 expect((screen.getByRole('combobox',{name:'业务质量档'}) as HTMLSelectElement).value).toBe('medium');
});
it('keeps read-only quality visible without a save affordance',async()=>{
 request.mockResolvedValue({enabled:true,tier:'high',revision:3});render(<ProductionQualityField episodeId="episode" readOnly/>);
 await waitFor(()=>expect((screen.getByRole('combobox',{name:'业务质量档'}) as HTMLSelectElement).value).toBe('high'));
 expect((screen.getByRole('combobox',{name:'业务质量档'}) as HTMLSelectElement).disabled).toBe(true);expect(screen.queryByRole('button')).toBeNull();expect(command).not.toHaveBeenCalled();
});
