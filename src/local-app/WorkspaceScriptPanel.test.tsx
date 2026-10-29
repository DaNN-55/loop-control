import {render,screen,fireEvent,cleanup,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceScriptPanel} from './WorkspaceScriptPanel';
afterEach(cleanup);
it('confirms a new script through material registration and start without asking for visuals',async()=>{
 const command=vi.fn(async()=>({id:'new-script'})),confirmed=vi.fn();render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId={null} script="" stage="waiting_input" readOnly={false} pending={false} command={command} onConfirmed={confirmed}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'这是第一镜的口播。'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本'}));
 await waitFor(()=>expect(confirmed).toHaveBeenCalledOnce());expect(command.mock.calls).toEqual([['importMaterial',expect.objectContaining({episodeId:'e',materialType:'script',isMainScript:true,sourcePath:'script.md'})],['start',{episodeId:'e'}]]);
});
it('keeps revision text after a failed confirmation and requires an explicit reason',async()=>{
 const command=vi.fn(async()=>{throw Error('版本已变化，请刷新。');});render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script="原文" stage="storyboard_approved" readOnly={false} pending={false} command={command} onConfirmed={()=>{}}/>);
 fireEvent.change(screen.getByRole('textbox',{name:'主脚本'}),{target:{value:'新口播'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));await screen.findByText('请填写修订原因。');expect(command).not.toHaveBeenCalled();
 fireEvent.change(screen.getByRole('textbox',{name:'脚本修订原因'}),{target:{value:'调整叙事'}});fireEvent.click(screen.getByRole('button',{name:'确认脚本修订'}));await screen.findByText('版本已变化，请刷新。');expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).value).toBe('新口播');expect(command).toHaveBeenCalledWith('reconfirmScript',{episodeId:'e',expectedScriptRevisionId:'old',text:'新口播',reason:'调整叙事'});
});
it('keeps completed script evidence readable with no write action',()=>{
 render(<WorkspaceScriptPanel episodeId="e" scriptRevisionId="old" script="历史原文" stage="production_completed" readOnly pending={false} command={vi.fn()} onConfirmed={()=>{}}/>);expect((screen.getByRole('textbox',{name:'主脚本'}) as HTMLTextAreaElement).readOnly).toBe(true);expect(screen.queryByRole('button',{name:'确认脚本'})).toBeNull();
});
