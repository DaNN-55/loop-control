import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceNativeControls} from './WorkspaceNativeControls';
afterEach(cleanup);
const item={id:'visual-1',kind:'video',startFrame:0,durationInFrames:60,durationLocked:false},shot={id:'S01',text:'第一镜',timelineId:'t',itemIds:['visual-1','visual-2'],startFrame:0,durationInFrames:120,effective:true};
it('retains the platform duration policy, composition and protected removal actions',()=>{
 const edit=vi.fn(async()=>({}));render(<WorkspaceNativeControls shot={shot} item={item} items={[item,{...item,id:'visual-2'}]} disabled={false} edit={edit}/>);
 fireEvent.click(screen.getByRole('checkbox',{name:'保留片段时长'}));expect(edit).toHaveBeenLastCalledWith({kind:'lock',itemId:'visual-1',locked:true});
 fireEvent.change(screen.getByRole('combobox',{name:'镜头构图布局'}),{target:{value:'2up-vertical'}});expect(edit).toHaveBeenLastCalledWith({kind:'composition',shotId:'S01',layout:'2up-vertical'});
 fireEvent.click(screen.getByRole('button',{name:'删除当前画面引用'}));expect(edit).toHaveBeenLastCalledWith({kind:'remove-range',itemId:'visual-1'});
 expect(screen.getByRole('checkbox',{name:'保留片段时长'}).closest('label')?.title).toContain('不限制原生裁剪');
});
it('does not expose removal of the last visual reference and shows a failed edit without dropping context',async()=>{
 const edit=vi.fn(async()=>{throw Error('画面短于完整主声');});render(<WorkspaceNativeControls shot={shot} item={item} items={[item]} disabled={false} edit={edit}/>);
 expect((screen.getByRole('button',{name:'删除当前画面引用'}) as HTMLButtonElement).disabled).toBe(true);
 fireEvent.click(screen.getByRole('checkbox',{name:'保留片段时长'}));expect(await screen.findByRole('alert')).toHaveProperty('textContent','画面短于完整主声');expect(screen.getByRole('combobox',{name:'镜头构图布局'})).toBeTruthy();
});
