import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,expect,it,vi} from 'vitest';
import {WorkspaceNarrationPanel} from './WorkspaceNarrationPanel';
import {WorkspaceAudioPreparation} from './WorkspaceAudioPanel';
import type {ProductionWorkspace} from '../productionWorkspace';
afterEach(()=>{cleanup();vi.restoreAllMocks();});
const selection={capability:'speech',provider:'provider',adapter:'adapter',connectionVersionId:'original',model:'original-model'};
const w={id:'w',episodeId:'e',project:{sha256:'sha'},clips:[{shotId:'S1',itemId:'item'}],usedNarration:[{shotId:'S1',taskId:'used-task',audioTrackId:'used',sha256:'used-sha',text:'实际采用正文',sourceInFrame:0,durationInFrames:90,fps:30}],candidates:[{kind:'audio',taskId:'used-task',audioTrackId:'used',sha256:'used-sha',relativePath:'original.mp3',speech:{selection,voice:'original-voice',languageCode:'zh-CN',speakingRate:1.25}}],narration:[{shotId:'S1',clipId:'c',defaults:{selection:{...selection,model:'new-default'},voice:'default-voice',languageCode:'zh-CN',speakingRate:1},execution:{taskId:'later-task',selection:{...selection,model:'later-model'},text:'后来未采用正文',voice:'later-voice',languageCode:'zh-CN',speakingRate:1.5}}],audio:{defaults:{selection:{provider:'new-default'}},preparations:[{id:'music',kind:'bgm',description:'原检索配乐',connection:{name:'原配乐连接',version:1},query:'original query',selection:{provider:'freesound'},adoptedItemId:'music-item',relativePath:'music.mp3',sha256:'music-sha',source:{provider:'freesound'}}],mix:{voices:[],sounds:[{itemId:'music-item',kind:'bgm',gainDb:-12,duckDepthDb:3,startSeconds:0,durationSeconds:3}]}}} as unknown as ProductionWorkspace;
it('shows actual adopted speech separately from a later request without mounting editable defaults or drafts',()=>{
 const command=vi.fn(),storage=vi.spyOn(Storage.prototype,'setItem'),fetch=vi.spyOn(globalThis,'fetch');
 render(<WorkspaceNarrationPanel readOnly workspace={w} episodeId="e" pending={false} command={command} onChanged={vi.fn()}/>);
 expect(screen.getByText('实际采用正文')).toBeTruthy();expect(screen.getByText('original-model')).toBeTruthy();expect(screen.getByText('后来未采用正文')).toBeTruthy();expect(screen.getByText('最近生成请求（当前未采用）')).toBeTruthy();expect(screen.queryByText('new-default')).toBeNull();expect(document.querySelector('input,textarea,select')).toBeNull();expect(command).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
it('shows frozen music selection and native adoption without polling, searching or writing',()=>{
 const command=vi.fn(),fetch=vi.spyOn(globalThis,'fetch');
 render(<WorkspaceAudioPreparation readOnly workspace={w} command={command} onChange={vi.fn()}/>);
 expect(screen.getByText('原检索配乐 · 当前采用')).toBeTruthy();expect(screen.getByText('original query')).toBeTruthy();expect(screen.getByRole('table',{name:'已保存配乐与音效'})).toBeTruthy();expect(document.querySelector('input,textarea,select')).toBeNull();expect(command).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
