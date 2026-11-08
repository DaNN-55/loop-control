import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within} from '@testing-library/react';
import {WorkspaceMaterialShelf} from './WorkspaceMaterialShelf';
import {WorkspaceMaterialSelectionProvider,workspaceMaterialDragType} from './WorkspaceMaterialDrop';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const materials=[{id:'image',material_type:'image',source_path:'very-long-参考图片.png',storage_path:'image.png'},{id:'audio',material_type:'audio',source_path:'voice.mp3',storage_path:'voice.mp3'},{id:'script',material_type:'script',source_path:'script.md',storage_path:'script.md'}];
it('filters the real inventory without discarding selection and keeps drag data unchanged',()=>{
 const imported=vi.fn();render(<WorkspaceMaterialSelectionProvider materials={materials}><WorkspaceMaterialShelf episodeId="e" shotCount={2} materials={materials} readOnly={false} busy={false} status="" failures={[]} onImport={imported}/></WorkspaceMaterialSelectionProvider>);
 fireEvent.click(screen.getByRole('button',{name:'本期素材 · 3'}));const image=screen.getByRole('button',{name:'预览 very-long-参考图片.png'});fireEvent.click(image);expect(image.getAttribute('aria-pressed')).toBe('true');fireEvent.click(image);expect(image.getAttribute('aria-pressed')).toBe('false');fireEvent.click(image);
 fireEvent.click(within(screen.getByRole('group',{name:'素材类型'})).getByRole('button',{name:'音频'}));expect(screen.queryByRole('button',{name:'预览 very-long-参考图片.png'})).toBeNull();expect(screen.getByRole('button',{name:'预览 voice.mp3'})).toBeTruthy();
 fireEvent.click(screen.getByRole('button',{name:'全部'}));const setData=vi.fn();fireEvent.dragStart(screen.getByRole('button',{name:'预览 very-long-参考图片.png'}),{dataTransfer:{setData}});expect(setData).toHaveBeenCalledWith(workspaceMaterialDragType,'image');expect(imported).not.toHaveBeenCalled();
});
it('previews registered scripts as plain text and retains read-only filtering',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('# 已确认脚本\n实际正文')));render(<WorkspaceMaterialShelf episodeId="e" shotCount={1} materials={materials} readOnly busy={false} status="" failures={[]} onImport={vi.fn()}/>);
 fireEvent.click(screen.getByRole('button',{name:'本期素材 · 3'}));fireEvent.click(screen.getByRole('button',{name:'脚本'}));const script=screen.getByRole('button',{name:'预览 script.md'});expect(script.draggable).toBe(false);fireEvent.doubleClick(script);expect(await screen.findByText(/实际正文/)).toBeTruthy();expect(screen.getByRole('dialog',{name:'script.md'})).toBeTruthy();expect(screen.queryByRole('button',{name:'导入本期素材'})).toBeNull();
});

it('opens a tile preview without changing its selection and keeps the close action accessible',()=>{
 render(<WorkspaceMaterialSelectionProvider materials={materials}><WorkspaceMaterialShelf episodeId="e" shotCount={2} materials={materials} readOnly={false} busy={false} status="" failures={[]} onImport={vi.fn()}/></WorkspaceMaterialSelectionProvider>);
 fireEvent.click(screen.getByRole('button',{name:'本期素材 · 3'}));
 const image=screen.getByRole('button',{name:'预览 very-long-参考图片.png'});fireEvent.click(image);
 expect(screen.queryByRole('button',{name:'收起'})).toBeNull();
 expect(screen.queryByRole('button',{name:'预览所选素材'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'预览素材 voice.mp3'}));
 const dialog=screen.getByRole('dialog',{name:'voice.mp3'});
 expect(within(dialog).getByLabelText('试听 voice.mp3')).toBeTruthy();
 fireEvent.click(within(dialog).getByRole('button',{name:'关闭素材预览'}));
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(image.getAttribute('aria-pressed')).toBe('true');
 expect(screen.getByRole('button',{name:'收起本期素材'})).toBeTruthy();
});
