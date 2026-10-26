import {act,cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {afterEach,it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import type {ComponentProps} from 'react';
import {EpisodeProductionView} from './EpisodeProduction';
import {clearLocalArtifactCache} from '../reviews/localArtifactPreview';
vi.mock('../lib/supabase',()=>({supabase:{auth:{getSession:vi.fn().mockResolvedValue({data:{session:{access_token:'synthetic-owner'}}})}}}));
const at='2026-10-25T00:00:00Z',text='完全不相干的正文',textFingerprint=createHash('sha256').update(text).digest('hex');
function fixture(){
 const episodeId='10000000-0000-4000-8000-000000000001',reviewId='10000000-0000-4000-8000-000000000002',trackId='10000000-0000-4000-8000-000000000003';
 const artifact={id:'storyboard',artifact_type:'storyboard',created_at:at,episode_id:episodeId,file_size:12,producer_task_id:'storyboard-task',relative_path:`episodes/${episodeId}/storyboard.json`,sha256:'a'.repeat(64)};
 const review={id:reviewId,artifact_id:artifact.id,context_snapshot:{},created_at:at,episode_id:episodeId,invalidated_at:null,invalidated_reason:null,revision_number:1,stage:'storyboard_review',task_id:'storyboard-task',task_run_id:'storyboard-run'};
 const track={id:trackId,created_at:at,cue_id:'shot-1',duration_seconds:3,episode_id:episodeId,file_size:12,relative_path:`episodes/${episodeId}/audio.mp3`,sha256:'b'.repeat(64),source_artifact_id:'audio',source_material_revision_id:null,source_review_package_id:reviewId,source_task_id:'audio-task',start_seconds:0,track_kind:'narration'};
 const cue={id:'phrase-1',text,startMs:0,endMs:3000,confidence:0.838};
 const draft={id:'draft-1',episode_id:episodeId,review_package_id:reviewId,shot_id:'shot-1',created_at:at,updated_at:at,audio_mode:'tts',audio_status:'ready',current_audio_track_id:track.id,caption_text_confirmation:null,acoustic_alignment:{version:'acoustic-alignment/v1',status:'completed',method:'local_whisperx',granularity:'phrase',inputVersion:'c'.repeat(64),audioSha256:track.sha256,textFingerprint,provider:'whisperx',model:'wav2vec2',connectionVersionId:null,wordCount:1,cues:[cue],attempts:[],detail:'时序对齐完成，平均分 0.838。',generatedAt:at},caption_contract:{version:'shot-captions/v1',enabled:true,contentMode:'independent',text,cues:[cue],spatial:{version:'shot-caption-space/v1',anchor:'bottom-center',safeArea:'title-safe',maxLines:2,maxCharactersPerLine:18}},subtitle_text:text,subtitles_enabled:true,tts_text:text,tts_voice:'voice-a',tts_speaking_rate:1,clip_segments:[{start_seconds:0,end_seconds:3}],selected_material_revision_id:'material-1',source_video_duration_seconds:3,video_status:'ready',confirmation_status:'pending',preparation_contract_status:'current',preparation_input_fingerprint:'d'.repeat(32)};
 const material={id:'material-1',created_at:at,created_by:'owner',episode_id:episodeId,file_size:12,is_main_script:false,material_purpose:'a_roll',material_type:'video',mime_type:'video/mp4',revision_number:1,sha256:'e'.repeat(64),source_kind:'file',source_path:'clip.mp4',storage_path:`episodes/${episodeId}/clip.mp4`};
 vi.stubGlobal('fetch',vi.fn(async(_path:unknown,init?:RequestInit)=>init?.method==='POST'?Response.json({url:'/_local-artifact?ticket=fixture'}):Response.json({version:'storyboard/v1',audioCues:[],shots:[{id:'shot-1',durationSeconds:3,inputBasis:[{relativePath:'script.md',sha256:'a'.repeat(64)}],productionMethod:'人工',scriptSegment:text,shotType:'a_roll',targetSpec:'9:16'}]})));
 const props={artifacts:[artifact],audioTrackAnnotations:[],audioTracks:[track],blueprint:{id:'blueprint',account_id:'account',policy:{},version:1},episode:{id:episodeId,account_id:'account',blueprint_version_id:'blueprint',stage:'storyboard_approved',created_at:at,updated_at:at,title:'正文核对',tts_language_code:'zh-CN',tts_voice:'voice-a',tts_speaking_rate:1},isMaterialPending:false,isStoryboardAnnotationPending:false,isTransitionPending:false,materialRevisions:[material],reviewAnnotations:[],reviewPackages:[review],shotPreparationDrafts:[draft],tasks:[],transitions:[],onCreateAudioTrackAnnotation:vi.fn(),onCreateStoryboardAnnotation:vi.fn(),onImportMaterial:vi.fn(),onRequestRevision:vi.fn(),onTransition:vi.fn(),onConfirmShotCaptionText:vi.fn().mockResolvedValue(undefined)} as unknown as ComponentProps<typeof EpisodeProductionView>;
 return{props,draft,track,review};
}
afterEach(()=>{cleanup();clearLocalArtifactCache();vi.unstubAllGlobals();});
it('keeps a completed high-score mismatch awaiting Owner text review and blocks preview',async()=>{
 const f=fixture();await act(async()=>{render(<EpisodeProductionView {...f.props}/>);});
 const review=await screen.findByRole('region',{name:'shot-1 正文核对'});
 expect(review.textContent).toContain('时序对齐不验证正文');
 expect(review.textContent).toContain('正文待人工核对');
 expect(review.textContent).not.toContain('正文已核对');
 fireEvent.click(within(screen.getByRole('tablist',{name:'shot-1 镜头工作区'})).getByRole('tab',{name:'3 同步预览与确认'}));
 expect((screen.getByRole('button',{name:'生成同步预览'}) as HTMLButtonElement).disabled).toBe(true);
});

it('saves an explicit review identity, keeps it on refresh and invalidates local text edits',async()=>{
 const f=fixture();let props=f.props;
 const view=render(<EpisodeProductionView {...props}/>);
 const review=await screen.findByRole('region',{name:'shot-1 正文核对'});
 fireEvent.click(within(review).getByRole('button',{name:'我已核对当前音频正文'}));
 await waitFor(()=>expect(props.onConfirmShotCaptionText).toHaveBeenCalledWith({episodeId:f.draft.episode_id,reviewPackageId:f.review.id,shotId:'shot-1',audioTrackId:f.track.id,audioSha256:f.track.sha256,textFingerprint,alignmentInputVersion:'c'.repeat(64)}));
 const confirmation={version:'caption-text-confirmation/v1',audioTrackId:f.track.id,audioSha256:f.track.sha256,textFingerprint,alignmentInputVersion:'c'.repeat(64),confirmedText:text,confirmedBy:'owner',confirmedAt:at};
 props={...props,shotPreparationDrafts:[{...f.draft,caption_text_confirmation:confirmation}] as never};
 view.rerender(<EpisodeProductionView {...props}/>);
 expect(review.textContent).toContain('Owner 已核对当前音频正文');
 view.rerender(<EpisodeProductionView {...props} audioTracks={[{...f.track}] as never}/>);
 expect(review.textContent).toContain('Owner 已核对当前音频正文');
 fireEvent.change(screen.getByLabelText('shot-1 字幕正文'),{target:{value:'更正后的正文'}});
 expect(review.textContent).toContain('正文待人工核对');
 expect((within(review).getByRole('button',{name:'我已核对当前音频正文'}) as HTMLButtonElement).disabled).toBe(true);
});

it('does not count a historical preview confirmation as current text review',async()=>{
 const f=fixture();f.props.shotPreparationDrafts=[{...f.draft,confirmation_status:'confirmed',preview_status:'ready',current_preview_input_fingerprint:f.draft.preparation_input_fingerprint}] as never;
 await act(async()=>{render(<EpisodeProductionView {...f.props}/>);});
 await screen.findByRole('region',{name:'shot-1 正文核对'});
 expect(screen.getByRole('navigation',{name:'镜头确认概览'}).textContent).toContain('已确认 0 / 1 个镜头');
});

it('does not promote a new audio or alignment identity when an old confirmation callback arrives late',async()=>{
 const f=fixture();let finish!:()=>void;
 f.props.onConfirmShotCaptionText=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 const view=render(<EpisodeProductionView {...f.props}/>);
 const review=await screen.findByRole('region',{name:'shot-1 正文核对'});
 fireEvent.click(within(review).getByRole('button',{name:'我已核对当前音频正文'}));
 await waitFor(()=>expect(finish).toBeTypeOf('function'));
 const nextTrack={...f.track,id:'20000000-0000-4000-8000-000000000003',sha256:'f'.repeat(64)};
 const nextDraft={...f.draft,current_audio_track_id:nextTrack.id,updated_at:'2026-10-25T01:00:00Z',acoustic_alignment:{...f.draft.acoustic_alignment,audioSha256:nextTrack.sha256,inputVersion:'e'.repeat(64)}};
 view.rerender(<EpisodeProductionView {...f.props} audioTracks={[nextTrack] as never} shotPreparationDrafts={[nextDraft] as never}/>);
 await act(async()=>{finish();});
 expect(review.textContent).toContain('正文待人工核对');
 expect(review.textContent).not.toContain('Owner 已核对当前音频正文');
 expect(f.props.onConfirmShotCaptionText).toHaveBeenCalledTimes(1);
});

it.each(['audio','text','alignment'])('invalidates an already saved content review when the %s identity changes',async kind=>{
 const f=fixture();const confirmation={version:'caption-text-confirmation/v1',audioTrackId:f.track.id,audioSha256:f.track.sha256,textFingerprint,alignmentInputVersion:'c'.repeat(64),confirmedText:text,confirmedBy:'owner',confirmedAt:at};
 const saved={...f.draft,caption_text_confirmation:confirmation};
 const view=render(<EpisodeProductionView {...f.props} shotPreparationDrafts={[saved] as never}/>);
 const review=await screen.findByRole('region',{name:'shot-1 正文核对'});expect(review.textContent).toContain('Owner 已核对当前音频正文');
 const track=kind==='audio'?{...f.track,sha256:'f'.repeat(64)}:f.track;
 const draft={...saved,updated_at:'2026-10-25T01:00:00Z',...(kind==='text'?{subtitle_text:'更正后的正文',caption_contract:{...saved.caption_contract,text:'更正后的正文'}}:{}),acoustic_alignment:{...saved.acoustic_alignment,...(kind==='alignment'?{inputVersion:'e'.repeat(64)}:{}),...(kind==='audio'?{audioSha256:track.sha256}:{})}};
 await act(async()=>{view.rerender(<EpisodeProductionView {...f.props} audioTracks={[track] as never} shotPreparationDrafts={[draft] as never}/>);});
 expect(review.textContent).toContain('正文待人工核对');expect(review.textContent).not.toContain('Owner 已核对当前音频正文');
});
