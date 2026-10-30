import {afterEach,expect,it} from 'vitest';
import {cleanup,fireEvent,render,screen} from '@testing-library/react';
import {useWorkspaceCanvas} from './useWorkspaceCanvas';
afterEach(cleanup);
function Canvas(){const {root,canvas}=useWorkspaceCanvas();return <aside className="lc-production-workspace" data-testid="scroller"><section ref={root}><fieldset ref={canvas} data-testid="canvas"/></section></aside>;}
it('keeps the working canvas at 800px while the outer page scrolls up and down',()=>{
 render(<Canvas/>);const scroller=screen.getByTestId('scroller'),canvas=screen.getByTestId('canvas');
 Object.defineProperty(scroller,'clientHeight',{configurable:true,value:953});Object.defineProperty(scroller,'clientWidth',{configurable:true,value:1440});
 scroller.getBoundingClientRect=()=>({top:0,width:1455} as DOMRect);canvas.getBoundingClientRect=()=>({top:160-scroller.scrollTop} as DOMRect);
 fireEvent(window,new Event('resize'));const height=()=>parseFloat(canvas.style.getPropertyValue('--workspace-canvas-height')||'800');expect(height()).toBe(800);
 for(const top of [40,100,160,300,100,0]){scroller.scrollTop=top;fireEvent.scroll(scroller);expect(height()).toBe(800);}
});
