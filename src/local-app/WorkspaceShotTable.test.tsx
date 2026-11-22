import userEvent from '@testing-library/user-event';
import {act,cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceShotTable} from './WorkspaceShotTable';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(cleanup);
it('shows one preparation column with the concrete missing requirement',()=>{
 const workspace={clips:[{id:'c',itemId:'item',shotId:'S1',text:'需要画面',source:null}],narration:[{shotId:'S1',mode:'none',enabled:false}],readiness:{placeholders:['item'],missingSources:[]}} as unknown as ProductionWorkspace;
 render(<WorkspaceShotTable workspace={workspace} project={null} materials={[]} disabled={false} selectedShotId="S1" onSelect={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()}/>);
 expect(screen.getByRole('columnheader',{name:'准备情况'})).toBeTruthy();
 expect(screen.queryByRole('columnheader',{name:'口播'})).toBeNull();
 const status=screen.getByRole('button',{name:'镜头 01准备情况：待1项'});fireEvent.click(status);expect(screen.getByText('画面').closest('li')?.getAttribute('data-state')).toBe('pending');expect(screen.queryByText('保留占位')).toBeNull();
});
it('keeps read-only selection and sources without unusable drag, add or delete instructions',()=>{
 const onSelect=vi.fn(),onEdit=vi.fn();const workspace={clips:[{id:'c',itemId:'item',shotId:'S1',text:'原镜头',source:{kind:'image',relativePath:'old.png',sha256:'sha'}}]} as unknown as ProductionWorkspace;
 render(<WorkspaceShotTable workspace={workspace} project={null} materials={[]} readOnly disabled selectedShotId="S1" onSelect={onSelect} onDelete={vi.fn()} onEdit={onEdit}/>);
 expect(screen.queryByText(/拖动行调整顺序/)).toBeNull();expect(screen.queryByRole('button',{name:'新增镜头'})).toBeNull();expect(screen.queryByRole('button',{name:'删除镜头 01'})).toBeNull();fireEvent.click(screen.getByRole('button',{name:'选择镜头 01'}));expect(onSelect).toHaveBeenCalledWith('S1');fireEvent.keyDown(screen.getByRole('row',{name:'镜头 01'}),{altKey:true,key:'ArrowDown'});expect(onEdit).not.toHaveBeenCalled();expect(screen.getByText('old.png')).toBeTruthy();
});
it('treats readOnly as a lock even when the caller is not temporarily disabled',()=>{
 const onEdit=vi.fn();const workspace={clips:[{id:'a',itemId:'a',shotId:'S1',text:'第一镜',source:null},{id:'b',itemId:'b',shotId:'S2',text:'第二镜',source:null}]} as unknown as ProductionWorkspace;
 render(<WorkspaceShotTable workspace={workspace} project={null} materials={[]} readOnly disabled={false} selectedShotId="S1" onSelect={vi.fn()} onDelete={vi.fn()} onEdit={onEdit}/>);
 fireEvent.keyDown(screen.getByRole('row',{name:'镜头 01'}),{altKey:true,key:'ArrowDown'});expect(onEdit).not.toHaveBeenCalled();expect(screen.getByRole('row',{name:'镜头 01'}).draggable).toBe(false);expect(screen.queryByRole('button',{name:'删除镜头 01'})).toBeNull();
});

it('summarizes preparation with disabled, adopted, pending and failed narration precedence',()=>{
 const cases=[
  {shotId:'none',narration:undefined,text:'可剪辑',tone:'ready'},
  {shotId:'off',narration:{mode:'none',status:'failed'},text:'可剪辑',tone:'ready'},
  {shotId:'adopted',narration:{mode:'generate',status:'failed',adoptedAudioTrackId:'audio'},text:'可剪辑',tone:'ready'},
  {shotId:'running',narration:{mode:'generate',status:'running'},text:'待1项',tone:'working'},
  {shotId:'failed',narration:{mode:'generate',status:'failed'},text:'待1项',tone:'error'},
  {shotId:'pending',narration:{mode:'generate',status:'draft'},text:'待1项',tone:'pending'},
 ];
 const workspace={clips:cases.map(c=>({id:c.shotId,itemId:c.shotId,shotId:c.shotId,text:c.shotId,source:{kind:'image',relativePath:'used.png',sha256:'sha'}})),narration:cases.filter(c=>c.narration).map(c=>({shotId:c.shotId,...c.narration}))} as unknown as ProductionWorkspace;
 render(<WorkspaceShotTable workspace={workspace} project={null} materials={[]} selectedShotId="none" disabled={false} onSelect={vi.fn()} onDelete={vi.fn()} onEdit={vi.fn()}/>);
 cases.forEach((c,index)=>{const row=screen.getByRole('row',{name:`镜头 ${String(index+1).padStart(2,'0')}`});expect(within(row).getByRole('button',{name:/准备情况/}).classList.contains('is-'+c.tone)).toBe(true);expect(within(row).getByText(c.text)).toBeTruthy();});
});

function deletionWorkspace(count=2):ProductionWorkspace{
 return {clips:Array.from({length:count},(_,i)=>({id:`clip-${i+1}`,itemId:`visual-${i+1}`,shotId:`S${i+1}`,text:`第${i+1}镜`,source:null}))} as unknown as ProductionWorkspace;
}
it('exposes deletion directly without a menu and delegates confirmation without selecting or reordering the row',async()=>{
 const workspace=deletionWorkspace(),onDelete=vi.fn(),onSelect=vi.fn(),onEdit=vi.fn();
 render(<WorkspaceShotTable workspace={workspace} project={null} materials={[]} selectedShotId="S1" disabled={false} onSelect={onSelect} onDelete={onDelete} onEdit={onEdit}/>);
 const button=screen.getByRole('button',{name:'删除镜头 02'});
 expect(screen.queryByRole('button',{name:'镜头 02操作'})).toBeNull();expect(screen.queryByRole('menu')).toBeNull();
 await userEvent.click(button);
 expect(onDelete).toHaveBeenCalledExactlyOnceWith(workspace.clips[1]);expect(onSelect).not.toHaveBeenCalled();expect(onEdit).not.toHaveBeenCalled();
 expect(screen.queryByRole('menu')).toBeNull();expect(screen.getAllByRole('button',{name:/选择镜头/})).toHaveLength(2);
});
it.each([['pending',2,true],['last shot',1,false]] as const)('prevents direct deletion for %s',async(_state,count,disabled)=>{
 const onDelete=vi.fn();render(<WorkspaceShotTable workspace={deletionWorkspace(count)} project={null} materials={[]} selectedShotId="S1" disabled={disabled} onSelect={vi.fn()} onDelete={onDelete} onEdit={vi.fn()}/>);
 const button=screen.getByRole('button',{name:'删除镜头 01'}) as HTMLButtonElement;expect(button.disabled).toBe(true);await userEvent.click(button);expect(onDelete).not.toHaveBeenCalled();
});
it('keeps the direct delete control keyboard reachable without leaking sorting or drag gestures to its row',async()=>{
 const onDelete=vi.fn(),onEdit=vi.fn(),onSelect=vi.fn();render(<WorkspaceShotTable workspace={deletionWorkspace()} project={null} materials={[]} selectedShotId="S1" disabled={false} onSelect={onSelect} onDelete={onDelete} onEdit={onEdit}/>);
 const button=screen.getByRole('button',{name:'删除镜头 02'});act(()=>button.focus());await userEvent.keyboard('{Enter}');expect(onDelete).toHaveBeenCalledOnce();
 fireEvent.keyDown(button,{altKey:true,key:'ArrowUp'});const event=new Event('dragstart',{bubbles:true,cancelable:true});fireEvent(button,event);expect(event.defaultPrevented).toBe(true);
 expect(onEdit).not.toHaveBeenCalled();expect(onSelect).not.toHaveBeenCalled();
});

it('protects the last logical shot even when it contains multiple visual slots',()=>{
 const workspace=deletionWorkspace(),onDelete=vi.fn();workspace.clips[1].shotId=workspace.clips[0].shotId;
 render(<WorkspaceShotTable workspace={workspace} project={null} materials={[]} selectedShotId="S1" disabled={false} onSelect={vi.fn()} onDelete={onDelete} onEdit={vi.fn()}/>);
 expect((screen.getByRole('button',{name:'删除镜头 01'}) as HTMLButtonElement).disabled).toBe(true);expect(screen.queryByRole('button',{name:'删除镜头 02'})).toBeNull();expect(onDelete).not.toHaveBeenCalled();
});

it('keeps the current shot until a posted mutation finishes, then restores navigation',()=>{
 const workspace=deletionWorkspace(),onSelect=vi.fn(),onNavigate=vi.fn();
 const props={workspace,project:null,materials:[],selectedShotId:'S1',onSelect,onDelete:vi.fn(),onEdit:vi.fn(),onPreparationNavigate:onNavigate};
 const view=render(<WorkspaceShotTable {...props} disabled/>);
 const row=screen.getByRole('row',{name:'镜头 02'});
 expect(screen.getByRole('button',{name:'选择镜头 02'})).toHaveProperty('disabled',true);
 fireEvent.click(row);fireEvent.keyDown(row,{key:'Enter'});fireEvent.keyDown(row,{key:' '});
 expect(onSelect).not.toHaveBeenCalled();
 view.rerender(<WorkspaceShotTable {...props} disabled={false}/>);
 fireEvent.click(screen.getByRole('button',{name:'选择镜头 02'}));expect(onSelect).toHaveBeenCalledWith('S2');
});
