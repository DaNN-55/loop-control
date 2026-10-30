import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {WorkspaceGenerationBudget} from './WorkspaceGenerationBudget';
afterEach(cleanup);
it('saves explicit account limits through the existing Owner command without generation',async()=>{
 const command=vi.fn(async()=>({}));render(<WorkspaceGenerationBudget episodeId="episode" command={command}/>);fireEvent.click(screen.getByText('视频生成预算'));
 expect((screen.getByRole('button',{name:'保存视频预算'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('视频试片额度（分）'),{target:{value:'100'}});fireEvent.change(screen.getByLabelText('视频总额度（分）'),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:'保存视频预算'}));
 await waitFor(()=>expect(command).toHaveBeenCalledExactlyOnceWith('setWanBudget',{episodeId:'episode',trialCents:100,totalCents:200,full:false}));expect(screen.getByRole('status').textContent).toContain('可重试当前生成');
});
it('keeps inputs and shows the real command error when saving fails',async()=>{
 render(<WorkspaceGenerationBudget episodeId="episode" command={vi.fn().mockRejectedValue(Error('预算不可降低到已使用额度以下。'))}/>);fireEvent.click(screen.getByText('视频生成预算'));fireEvent.change(screen.getByLabelText('视频试片额度（分）'),{target:{value:'100'}});fireEvent.change(screen.getByLabelText('视频总额度（分）'),{target:{value:'200'}});fireEvent.click(screen.getByRole('button',{name:'保存视频预算'}));expect((await screen.findByRole('alert')).textContent).toContain('预算不可降低');expect((screen.getByLabelText('视频总额度（分）') as HTMLInputElement).value).toBe('200');
});
