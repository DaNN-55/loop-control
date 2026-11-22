import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,expect,it} from 'vitest';
import {WorkspacePreparationLayout} from './WorkspacePreparationLayout';
const storageKey='loop.production.preparation.listWidth.v1';
afterEach(()=>{cleanup();localStorage.clear();});
function layout(){return render(<WorkspacePreparationLayout><section>镜头</section><aside>详情</aside></WorkspacePreparationLayout>);}
it('keeps fixed table columns and restores a keyboard-accessible pane divider',()=>{
 localStorage.setItem('loop.production.preparation.listRatio.v2','75');
 const view=layout();
 expect(view.container.firstElementChild?.classList.contains('is-fixed')).toBe(true);
 const divider=screen.getByRole('separator',{name:'调整镜头列表宽度'});
 expect(divider.getAttribute('aria-valuenow')).toBe('572');
 expect(screen.getByText('镜头')).toBeTruthy();expect(screen.getByText('详情')).toBeTruthy();
 fireEvent.keyDown(divider,{key:'ArrowRight'});
 expect(divider.getAttribute('aria-valuenow')).toBe('588');
 expect(localStorage.getItem(storageKey)).toBe('588');
 fireEvent.keyDown(divider,{key:'Home'});
 expect(divider.getAttribute('aria-valuenow')).toBe('572');
 fireEvent.doubleClick(divider);
 expect(divider.getAttribute('aria-valuenow')).toBe('572');
});
it('restores a saved width and reserves space for the right pane when the viewport narrows',()=>{
 localStorage.setItem(storageKey,'700');
 const view=layout(),grid=view.container.firstElementChild as HTMLElement;
 const divider=screen.getByRole('separator',{name:'调整镜头列表宽度'});
 expect(divider.getAttribute('aria-valuenow')).toBe('700');
 grid.getBoundingClientRect=()=>({width:1000,left:0} as DOMRect);
 fireEvent(window,new Event('resize'));
 expect(divider.getAttribute('aria-valuenow')).toBe('631');
 fireEvent.keyDown(divider,{key:'End'});
 expect(localStorage.getItem(storageKey)).toBe('631');
});
it('ignores an invalid stored preference',()=>{
 localStorage.setItem(storageKey,'NaN');layout();
 expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('572');
});

it('clamps legacy pane widths to the actual table minimum so actions stay visible',()=>{localStorage.setItem(storageKey,'455');layout();const divider=screen.getByRole('separator');expect(divider.getAttribute('aria-valuemin')).toBe('572');expect(divider.getAttribute('aria-valuenow')).toBe('572');fireEvent.keyDown(divider,{key:'Home'});expect(localStorage.getItem(storageKey)).toBe('572');});
