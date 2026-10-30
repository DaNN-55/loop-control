import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,beforeEach,expect,it} from 'vitest';
import {WorkspacePreparationLayout} from './WorkspacePreparationLayout';
beforeEach(()=>localStorage.clear());afterEach(cleanup);
it('lets users adjust the split from the keyboard, retains it on remount and restores the default',()=>{
 const view=render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>),divider=screen.getByRole('separator',{name:'调整镜头列表宽度'});
 expect(divider.getAttribute('aria-valuenow')).toBe('41');fireEvent.keyDown(divider,{key:'ArrowLeft'});expect(divider.getAttribute('aria-valuenow')).toBe('39');view.unmount();render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);
 const restored=screen.getByRole('separator');expect(restored.getAttribute('aria-valuenow')).toBe('39');fireEvent.keyDown(restored,{key:'End'});expect(restored.getAttribute('aria-valuenow')).toBe('75');fireEvent.doubleClick(restored);expect(restored.getAttribute('aria-valuenow')).toBe('41');
});
it('keeps both panes and uses the default when a saved preference is invalid',()=>{
 localStorage.setItem('loop.production.preparation.listRatio.v1','invalid');render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('41');expect(screen.getByText('镜头')).toBeTruthy();expect(screen.getByText('详情')).toBeTruthy();
});
