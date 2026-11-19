import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {WorkspacePreparationLayout} from './WorkspacePreparationLayout';
afterEach(()=>{cleanup();localStorage.clear();});
it('uses the fixed layout even when an old split preference exists, retaining both panes',()=>{
 localStorage.setItem('loop.production.preparation.listRatio.v2','75');
 const view=render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);
 expect(view.container.firstElementChild?.classList.contains('is-fixed')).toBe(true);
 expect(screen.queryByRole('separator')).toBeNull();expect(screen.getByText('镜头')).toBeTruthy();expect(screen.getByText('详情')).toBeTruthy();
});
