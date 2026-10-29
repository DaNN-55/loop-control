import {render,screen,fireEvent,cleanup} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {WorkspaceNarrationPanel} from './WorkspaceNarrationPanel';
import type {ProductionWorkspace,WorkspaceNarration} from '../productionWorkspace';
const narration:WorkspaceNarration={clipId:'clip',shotId:'S01',mode:'tts',text:'当前口播',voice:'fixture',languageCode:'zh-CN',speakingRate:1,override:false,inputFingerprint:'input',confirmed:true,taskId:'task',status:'completed',error:null,audioTrackId:'audio',artifactId:'artifact',relativePath:'episodes/e/voice.mp3',sha256:'a'.repeat(64),fileSize:10,durationSeconds:2.4,itemId:'voice',adoptedAudioTrackId:null};
afterEach(cleanup);
function show(nativeEditRevision:number,n:WorkspaceNarration=narration){const workspace={id:'w',episodeId:'e',revision:1,nativeEditRevision,stale:false,narration:[n]} as ProductionWorkspace;render(<WorkspaceNarrationPanel episodeId="e" workspace={workspace} pending={false} command={vi.fn()} onChanged={vi.fn()}/>);fireEvent.click(screen.getByText('S01'));}
it.each(['edited','locked','replacement'] as const)('guides %s speech to the existing candidate workflow instead of an unusable direct adoption',kind=>{show(kind==='edited'?1:0,{...narration,...(kind==='locked'?{requiresCandidateAdoption:true}:{}),...(kind==='replacement'?{adoptedAudioTrackId:'older-audio'}:{})});expect(screen.queryByRole('button',{name:'采用口播'})).toBeNull();expect(screen.getByRole('status').textContent).toContain('剪辑工作台的口播版本');});
it('keeps direct first assembly available on an untouched draft',()=>{show(0);expect((screen.getByRole('button',{name:'采用口播'}) as HTMLButtonElement).disabled).toBe(false);expect(screen.queryByRole('status')).toBeNull();});
