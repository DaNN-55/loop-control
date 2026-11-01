import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {AccountGenerationBudgetSettings} from './AccountGenerationBudgetSettings';
const command=vi.hoisted(()=>vi.fn());
vi.mock('./client',()=>({localCommand:command}));
afterEach(()=>{cleanup();vi.resetAllMocks();vi.unstubAllGlobals();});
const accounts=[{id:'account-a',name:'账号A'},{id:'account-b',name:'账号B'}],read={accountId:'account-a',budget:{trial_video_limit_cents:129,total_limit_cents:2000,full_generation_enabled:false},usedCents:50};
it('reads saved settings and saves yuan as integer cents for the chosen account, without any episode or generation',async()=>{
 command.mockImplementation(async(name:string)=>name==='readGenerationBudget'?read:{...read,budget:{trial_video_limit_cents:29,total_limit_cents:1500,full_generation_enabled:true}});
 render(<AccountGenerationBudgetSettings accounts={accounts}/>);await waitFor(()=>expect(screen.getByLabelText('视频试片上限（元）')).toHaveProperty('value','1.29'));
 fireEvent.change(screen.getByLabelText('视频试片上限（元）'),{target:{value:'0.29'}});fireEvent.change(screen.getByLabelText('账号总上限（元）'),{target:{value:'15.00'}});fireEvent.click(screen.getByLabelText('允许视频使用总预算'));fireEvent.click(screen.getByRole('button',{name:'保存账号预算'}));await screen.findByText('账号预算已保存');expect(command).toHaveBeenLastCalledWith('setGenerationBudget',{accountId:'account-a',trialCents:29,totalCents:1500,full:true},undefined,'account-commands');expect(screen.getByLabelText('账号总上限（元）')).toHaveProperty('value','15.00');
});
it('does not apply a late account read to the newly chosen account',async()=>{
 let resolveA!:(v:typeof read)=>void;command.mockImplementation(async(_name:string,data:{accountId:string})=>data.accountId==='account-a'?new Promise<typeof read>(resolve=>{resolveA=resolve;}):{...read,accountId:'account-b',budget:null});render(<AccountGenerationBudgetSettings accounts={accounts}/>);fireEvent.change(screen.getByLabelText('预算账号'),{target:{value:'account-b'}});await screen.findByText('尚未设置限额');resolveA(read);await waitFor(()=>expect(screen.getByLabelText('账号总上限（元）')).toHaveProperty('value',''));expect(screen.getByLabelText('预算账号')).toHaveProperty('value','account-b');
});
it('preserves failed save input, guards unsaved account switching, and rejects invalid currency',async()=>{
 command.mockImplementation(async(name:string)=>{if(name==='setGenerationBudget')throw Error('预算未保存');return read;});vi.stubGlobal('confirm',vi.fn(()=>false));render(<AccountGenerationBudgetSettings accounts={accounts}/>);await screen.findByText('已设置限额');fireEvent.change(screen.getByLabelText('账号总上限（元）'),{target:{value:'0.001'}});expect(screen.getByRole('button',{name:'保存账号预算'})).toHaveProperty('disabled',true);fireEvent.change(screen.getByLabelText('账号总上限（元）'),{target:{value:'10'}});fireEvent.click(screen.getByRole('button',{name:'保存账号预算'}));expect((await screen.findByRole('alert')).textContent).toContain('预算未保存');expect(screen.getByLabelText('账号总上限（元）')).toHaveProperty('value','10');fireEvent.change(screen.getByLabelText('预算账号'),{target:{value:'account-b'}});expect(screen.getByLabelText('预算账号')).toHaveProperty('value','account-a');
});
