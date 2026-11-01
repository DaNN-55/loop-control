import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {WorkspaceGenerationBudget} from './WorkspaceGenerationBudget';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('reads account limits without any write and routes adjustment to that account in connection settings',async()=>{
 const fetcher=vi.fn(async()=>Response.json({accountId:'account',budget:{trial_video_limit_cents:100,total_limit_cents:200,full_generation_enabled:false},usedCents:30}));vi.stubGlobal('fetch',fetcher);
 const open=vi.fn();window.addEventListener('open-external-connections',open);
 try{render(<WorkspaceGenerationBudget episodeId="episode" shotId="S02" targetItemId="target"/>);await screen.findByText('账号预算 ¥2.00 · 已预留 ¥0.30 · 试片上限 ¥1.00');expect(screen.queryByRole('spinbutton')).toBeNull();expect(screen.queryByRole('button',{name:'保存账号预算'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'调整预算'}));expect(open.mock.calls[0][0].detail).toEqual({section:'budgets',accountId:'account',episodeId:'episode',shotId:'S02',targetItemId:'target'});expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/local/wan-budget?episode=episode',undefined);}finally{window.removeEventListener('open-external-connections',open);}
});
it('shows a read failure without claiming a balance and retries on window focus',async()=>{
 const fetcher=vi.fn().mockRejectedValueOnce(Error('offline')).mockResolvedValue(Response.json({accountId:'a',budget:null,usedCents:0}));vi.stubGlobal('fetch',fetcher);render(<WorkspaceGenerationBudget episodeId="episode"/>);await screen.findByText('账号预算暂不可用');fireEvent(window,new Event('focus'));await screen.findByText('尚未设置账号预算');await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
});
