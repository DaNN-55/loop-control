import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {EpisodeDeletionScope} from './EpisodeDeletionScope';
afterEach(cleanup);
it('shows the total size of the confirmed files and reveals individual sizes on demand',()=>{
 render(<EpisodeDeletionScope files={[{path:'/episode/脚本.md',bytes:1024,authority:'material'},{path:'/episode/画面.mp4',bytes:2048,authority:'artifact'}]}/>);
 expect(screen.getByText('将删除 2 个文件')).toBeTruthy();
 expect(screen.getByText('共 3.0 KB')).toBeTruthy();
 const toggle=screen.getByText('查看文件明细'),details=toggle.closest('details')!;
 expect(details.open).toBe(false);fireEvent.click(toggle);expect(details.open).toBe(true);
 expect(screen.getByText('/episode/脚本.md')).toBeTruthy();expect(screen.getByText('1.0 KB')).toBeTruthy();expect(screen.getByText('2.0 KB')).toBeTruthy();
 expect(screen.queryByText(/释放|回收/)).toBeNull();
});
it('groups preserved paths by the exact server reason, outside the deletion size',()=>{
 render(<EpisodeDeletionScope files={[{path:'/delete',bytes:512,authority:'artifact'}]} preserved={[
  {path:'/keep/shared-one',reason:'其他生产单或历史资料仍引用，保留。'},
  {path:'/keep/shared-two',reason:'其他生产单或历史资料仍引用，保留。'},
  {path:'/keep/manual',reason:'未登记或无法证明属于本单的文件，保留。'},
 ]}/>);
 expect(screen.getByText('共 512 字节')).toBeTruthy();expect(screen.getByText('保留 3 项')).toBeTruthy();
 const shared=screen.getByText('其他生产单或历史资料仍引用，保留。'),details=shared.closest('details')!;
 expect(details.textContent).toContain('2 项');expect(details.open).toBe(false);fireEvent.click(shared);expect(details.open).toBe(true);
 expect(details.textContent).toContain('/keep/shared-one');expect(details.textContent).toContain('/keep/shared-two');expect(details.textContent).not.toContain('/keep/manual');
});
it('does not turn an unavailable file inventory into a zero-file plan',()=>{
 const view=render(<EpisodeDeletionScope preserved={[{path:'/manual',reason:'保留。'}]}/>);
 expect(screen.queryByText(/将删除/)).toBeNull();expect(screen.queryByText(/共.*字节/)).toBeNull();expect(screen.getByText('保留 1 项')).toBeTruthy();
 view.rerender(<EpisodeDeletionScope/>);expect(view.container.textContent).toBe('');
});
it('shows a confirmed empty file inventory without an empty disclosure',()=>{
 render(<EpisodeDeletionScope files={[]} preserved={[]}/>);
 expect(screen.getByText('将删除 0 个文件')).toBeTruthy();expect(screen.getByText('共 0 字节')).toBeTruthy();expect(screen.queryByText('查看文件明细')).toBeNull();expect(screen.queryByText(/保留/)).toBeNull();
});
