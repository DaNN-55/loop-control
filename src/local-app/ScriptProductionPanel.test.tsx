import {render,screen,fireEvent,waitFor,cleanup} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ScriptProductionPanel} from './ScriptProductionPanel';
import {resolveProductionPlan,type ProductionMaterial} from '../reviews/productionPlan';
import {productionScriptTemplate} from '../reviews/productionScript';
import {localRequest,localCommand} from './client';
vi.mock('./client',()=>({localRequest:vi.fn(),localCommand:vi.fn()}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
const material=(id:string):ProductionMaterial=>({id,episodeId:'e',seriesId:null,name:'首帧.png',alias:'填写已上传图片的素材名称',type:'image',purpose:'visual_reference',mime:'image/png',path:id+'.png',sha256:id.repeat(64),size:10});
it('leaves legacy scripts on their existing workflow',async()=>{
 vi.mocked(localRequest).mockResolvedValue({v2:false});render(<ScriptProductionPanel episodeId="e" onChanged={async()=>{}}/>);
 await waitFor(()=>expect(localRequest).toHaveBeenCalled());expect(screen.queryByRole('region',{name:'脚本制作计划'})).toBeNull();expect(localCommand).not.toHaveBeenCalled();
});
it('submits an explicit ambiguous material choice, then allows pausing without approval commands',async()=>{
 const plan=resolveProductionPlan(productionScriptTemplate,{},[material('a'),material('b')],'e',null);
 let enabled=false;
 vi.mocked(localRequest).mockImplementation(async()=>({v2:true,plan,inspection:plan,enabled,status:enabled?'已启用':'待确认'}));
 vi.mocked(localCommand).mockImplementation(async(command)=>{enabled=command==='configureScriptProduction';return{};});
 render(<ScriptProductionPanel episodeId="e" onChanged={async()=>{}}/>);
 fireEvent.change(await screen.findByLabelText('填写已上传图片的素材名称 匹配素材'),{target:{value:'b'}});
 fireEvent.click(screen.getByRole('button',{name:'确认并启用审核后继续'}));
 await screen.findByRole('button',{name:'暂停自动继续'});
 expect(localCommand).toHaveBeenCalledWith('configureScriptProduction',{episodeId:'e',enabled:true,choices:{'image:填写已上传图片的素材名称':'b'}},undefined,'episode-commands');
 fireEvent.click(screen.getByRole('button',{name:'暂停自动继续'}));await waitFor(()=>expect(localCommand).toHaveBeenLastCalledWith('pauseScriptProduction',{episodeId:'e'},undefined,'episode-commands'));
});
it('shows missing materials and keeps an actionable configuration error',async()=>{
 const plan=resolveProductionPlan(productionScriptTemplate,{},[],'e',null);
 vi.mocked(localRequest).mockResolvedValue({v2:true,plan,inspection:plan,enabled:false,status:'待确认'});
 vi.mocked(localCommand).mockRejectedValue(Error('首帧待上传'));
 render(<ScriptProductionPanel episodeId="e" onChanged={async()=>{}}/>);
 expect(await screen.findByText('待上传')).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'确认并启用审核后继续'}));expect((await screen.findByRole('alert')).textContent).toContain('首帧待上传');
});
