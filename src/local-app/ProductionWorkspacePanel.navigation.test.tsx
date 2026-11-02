import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {ProductionWorkspacePanel} from './ProductionWorkspacePanel';
import {WorkspaceNavigationContext} from './catalogNavigation';
import {draftWorkspace} from './fixtures/workspaceDraftFixture';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('keeps the restored viewing step when an older workspace read finishes afterwards',async()=>{
 let finish:(response:Response)=>void=()=>{};vi.stubGlobal('fetch',vi.fn(async()=>new Promise<Response>(resolve=>{finish=resolve;})));const command=vi.fn();
 const panel=<ProductionWorkspacePanel episodeId="e" title="导航读取验证" stage="waiting_input" scriptRevisionId={null} materials={[]} command={command} onLegacy={()=>{}}/>;
 const app=render(<WorkspaceNavigationContext.Provider value={{episode:'e',step:null,tab:'visual',change:()=>{}}}>{panel}</WorkspaceNavigationContext.Provider>);
 app.rerender(<WorkspaceNavigationContext.Provider value={{episode:'e',step:'delivery',tab:'visual',change:()=>{}}}>{panel}</WorkspaceNavigationContext.Provider>);await screen.findByRole('button',{name:'检查与交付，当前查看'});
 await act(async()=>{finish(Response.json({workspace:draftWorkspace('e')}));});await waitFor(()=>expect(screen.queryByText('正在读取制作流程…')).toBeNull());expect(screen.getByRole('button',{name:'检查与交付，当前查看'})).toBeTruthy();expect(command).not.toHaveBeenCalled();
});
