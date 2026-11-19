import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {WorkspacePreparationLayout} from './WorkspacePreparationLayout';
beforeEach(()=>localStorage.clear());afterEach(cleanup);
it('lets users adjust the split from the keyboard, retains it on remount and restores the default',()=>{
 const view=render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>),divider=screen.getByRole('separator',{name:'调整镜头列表宽度'});
 expect(divider.getAttribute('aria-valuenow')).toBe('36');fireEvent.keyDown(divider,{key:'ArrowLeft'});expect(divider.getAttribute('aria-valuenow')).toBe('34');view.unmount();render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);
 const restored=screen.getByRole('separator');expect(restored.getAttribute('aria-valuenow')).toBe('34');fireEvent.keyDown(restored,{key:'End'});expect(restored.getAttribute('aria-valuenow')).toBe('75');fireEvent.doubleClick(restored);expect(restored.getAttribute('aria-valuenow')).toBe('36');
});
it('keeps both panes and uses the default when a saved preference is invalid',()=>{
 localStorage.setItem('loop.production.preparation.listRatio.v1','invalid');render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('36');expect(screen.getByText('镜头')).toBeTruthy();expect(screen.getByText('详情')).toBeTruthy();
});

it('migrates the old automatically saved default to the compact default',()=>{
 localStorage.setItem('loop.production.preparation.listRatio.v1','41');render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('36');expect(localStorage.getItem('loop.production.preparation.listRatio.v2')).toBe('36');
});
it('preserves other old custom widths when migrating the preference',()=>{
 localStorage.setItem('loop.production.preparation.listRatio.v1','52');render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('52');expect(localStorage.getItem('loop.production.preparation.listRatio.v2')).toBe('52');
});
it('keeps an explicitly saved new 41 percent preference across remounts',()=>{
 localStorage.setItem('loop.production.preparation.listRatio.v1','41');localStorage.setItem('loop.production.preparation.listRatio.v2','41');const view=render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('41');view.unmount();render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('41');
});
