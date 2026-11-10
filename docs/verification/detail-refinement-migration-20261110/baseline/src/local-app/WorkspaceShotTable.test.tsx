import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceShotTable} from './WorkspaceShotTable';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(cleanup);
it('keeps read-only selection and sources without unusable drag, add or delete instructions',()=>{
 const onSelect=vi.fn(),onEdit=vi.fn();const workspace={clips:[{id:'c',itemId:'item',shotId:'S1',text:'原镜头',source:{kind:'image',relativePath:'old.png',sha256:'sha'}}]} as unknown as ProductionWorkspace;
 render(<WorkspaceShotTable workspace={workspace} project={null} materials={[]} readOnly disabled selectedShotId="S1" onSelect={onSelect} onDelete={vi.fn()} onEdit={onEdit}/>);
 expect(screen.queryByText(/拖动行调整顺序/)).toBeNull();expect(screen.queryByRole('button',{name:'新增镜头'})).toBeNull();expect(screen.queryByRole('button',{name:'镜头 01操作'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'选择镜头 01'}));expect(onSelect).toHaveBeenCalledWith('S1');fireEvent.keyDown(screen.getByRole('row',{name:'镜头 01'}),{altKey:true,key:'ArrowDown'});expect(onEdit).not.toHaveBeenCalled();expect(screen.getByText('old.png')).toBeTruthy();
});
it('treats readOnly as a lock even when the caller is not temporarily disabled',()=>{
 const onEdit=vi.fn();const workspace={clips:[{id:'a',itemId:'a',shotId:'S1',text:'第一镜',source:null},{id:'b',itemId:'b',shotId:'S2',text:'第二镜',source:null}]} as unknown as ProductionWorkspace;
 render(<WorkspaceShotTable workspace={workspace} project={null} materials={[]} readOnly disabled={false} selectedShotId="S1" onSelect={vi.fn()} onDelete={vi.fn()} onEdit={onEdit}/>);
 fireEvent.keyDown(screen.getByRole('row',{name:'镜头 01'}),{altKey:true,key:'ArrowDown'});expect(onEdit).not.toHaveBeenCalled();expect(screen.getByRole('row',{name:'镜头 01'}).draggable).toBe(false);
});
