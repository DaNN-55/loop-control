import {useState} from 'react';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {WorkspaceReferencePicker} from './WorkspaceReferencePicker';
afterEach(cleanup);
const materials=Array.from({length:17},(_,i)=>({id:String(i),material_type:'image',source_path:`photo-${i}.png`}));
it('selects multiple existing references, removes them, and restores focus after Escape without uploads',async()=>{
 const upload=vi.fn(),user=userEvent.setup();function Fixture(){const [selected,setSelected]=useState<string[]>([]);return <WorkspaceReferencePicker materials={materials} selected={selected} onChange={setSelected} onUpload={upload} url={x=>x}/>;}render(<Fixture/>);const trigger=screen.getByRole('button',{name:'添加参考图'});await user.click(trigger);await user.click(screen.getByRole('checkbox',{name:'参考图 photo-0.png'}));await user.click(screen.getByRole('checkbox',{name:'参考图 photo-1.png'}));expect(screen.getByText('2/16 已选')).toBeTruthy();await user.keyboard('{Escape}');expect(screen.queryByRole('dialog')).toBeNull();await waitFor(()=>expect(document.activeElement).toBe(trigger));fireEvent.click(screen.getByRole('button',{name:'移除参考图 1'}));await user.click(trigger);expect(screen.getByRole('checkbox',{name:'参考图 photo-0.png'})).toHaveProperty('checked',false);expect(screen.getByRole('checkbox',{name:'参考图 photo-1.png'})).toHaveProperty('checked',true);expect(upload).not.toHaveBeenCalled();
});
it('shares upload and drop handling and enforces the same sixteen-image limit',async()=>{
 const upload=vi.fn(async()=>{}),onChange=vi.fn(),file=new File(['x'],'new.png',{type:'image/png'}),user=userEvent.setup();const props={materials,selected:['0'],onChange,onUpload:upload,url:(x:string)=>x};const view=render(<WorkspaceReferencePicker {...props}/>);await user.click(screen.getByRole('button',{name:'添加参考图'}));fireEvent.drop(screen.getByRole('button',{name:/上传或拖入图片/}),{dataTransfer:{files:[file]}});expect(upload).toHaveBeenCalledWith([file]);fireEvent.change(screen.getByLabelText('导入生成参考图'),{target:{files:[file]}});expect(upload).toHaveBeenCalledTimes(2);view.rerender(<WorkspaceReferencePicker {...props} selected={materials.slice(0,16).map(m=>m.id)}/>);expect(screen.getByRole('checkbox',{name:'参考图 photo-16.png'})).toHaveProperty('disabled',true);expect(screen.getByRole('checkbox',{name:'参考图 photo-0.png'})).toHaveProperty('disabled',false);expect(screen.getByRole('button',{name:/上传或拖入图片/})).toHaveProperty('disabled',true);fireEvent.drop(screen.getByRole('button',{name:/上传或拖入图片/}),{dataTransfer:{files:[file]}});expect(upload).toHaveBeenCalledTimes(2);
});
it('放大已选参考图只核对图片，Escape 返回触发点且不改变选择',async()=>{
 const user=userEvent.setup(),onChange=vi.fn();render(<WorkspaceReferencePicker materials={[{...materials[0],storage_path:'media/photo.png'}]} selected={['0']} onChange={onChange} onUpload={async()=>{}} url={x=>x}/>);
 const trigger=screen.getByRole('button',{name:'放大参考图 1'});await user.click(trigger);
 expect(screen.getByRole('dialog',{name:'参考图 1 · photo-0.png'})).toBeTruthy();
 expect(screen.getByRole('img',{name:'photo-0.png'})).toHaveProperty('src',expect.stringContaining('media/photo.png'));
 await user.keyboard('{Escape}');await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
 await waitFor(()=>expect(document.activeElement).toBe(trigger));expect(onChange).not.toHaveBeenCalled();
});
it('选择列表中的放大按钮也不勾选未选图片',async()=>{
 const user=userEvent.setup(),onChange=vi.fn();render(<WorkspaceReferencePicker materials={[{...materials[0],storage_path:'media/photo.png'}]} selected={[]} onChange={onChange} onUpload={async()=>{}} url={x=>x}/>);
 await user.click(screen.getByRole('button',{name:'添加参考图'}));
 const trigger=screen.getByRole('button',{name:'放大 photo-0.png'});await user.click(trigger);
 expect(screen.getByRole('dialog',{name:'图片核对 · photo-0.png'})).toBeTruthy();
 await user.keyboard('{Escape}');await waitFor(()=>expect(document.activeElement).toBe(trigger));
 expect(screen.getByRole('checkbox',{name:'参考图 photo-0.png'})).toHaveProperty('checked',false);expect(onChange).not.toHaveBeenCalled();
});
