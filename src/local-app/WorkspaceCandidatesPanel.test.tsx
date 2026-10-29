import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceCandidatesPanel} from './WorkspaceCandidatesPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(cleanup);
it('preserves a local text draft across tool remounts and discards it for a newer narration input',()=>{
 const workspace={id:'workspace',episodeId:'episode',revision:1,stale:false,candidates:[],narration:[{shotId:'S1',clipId:'clip',text:'当前已保存正文',inputFingerprint:'a'.repeat(64),status:'completed'}]} as unknown as ProductionWorkspace;
 const drafts=new Map<string,{inputFingerprint:string;text:string}>(),command=vi.fn(),props={workspace,drafts,command,onChange:vi.fn()};const first=render(<WorkspaceCandidatesPanel {...props}/>);
 fireEvent.change(screen.getByLabelText('局部口播正文'),{target:{value:'尚未生成的局部改稿'}});first.unmount();const next=render(<WorkspaceCandidatesPanel {...props}/>);expect((screen.getByLabelText('局部口播正文') as HTMLTextAreaElement).value).toBe('尚未生成的局部改稿');expect(command).not.toHaveBeenCalled();
 next.rerender(<WorkspaceCandidatesPanel {...props} workspace={{...workspace,narration:[{...workspace.narration![0],inputFingerprint:'b'.repeat(64),text:'另一个已保存输入'}]}}/>);expect((screen.getByLabelText('局部口播正文') as HTMLTextAreaElement).value).toBe('另一个已保存输入');
});
