import {it,expect} from 'vitest';
import {confirmedTtsRender} from '../worker/openchatcutProject.fixture';
import {importLegacyHtmlWorkspace} from './legacyHtmlWorkspace';
import {legacyHtmlFixture} from './legacyHtmlWorkspace.fixture';
it('imports all frozen intervals, the split layout, real narration duration and exact caption cues without mutating history',()=>{
 const render=confirmedTtsRender(),{snapshot,html}=legacyHtmlFixture(render,true),before=structuredClone(snapshot);
 const imported=importLegacyHtmlWorkspace(snapshot,html,'copy'),t=imported.project.timelines[0],visuals=t.items.filter(i=>i.kind==='video');
 expect(visuals).toHaveLength(2);expect(visuals.map(i=>i.src)).toEqual([render.members[0].relativePath,render.members[0].relativePath]);expect(visuals.map(i=>i.srcInFrame)).toEqual([0,0]);expect(visuals.map(i=>i.durationInFrames)).toEqual([60,60]);expect(imported.render.confirmedShots[0].composition!.layout).toBe('2up-vertical');expect(t.items.find(i=>i.kind==='audio')?.durationInFrames).toBe(60);expect(Object.values(t.tracks).flatMap(t=>t.captions?.sourceEntries??[])[0].words.map(c=>[c.start,c.end])).toEqual([[0,2000]]);expect(snapshot).toEqual(before);
});
it('uses exact absolute HTML timing for narration whose frozen member start is shot-local',()=>{
 const render=confirmedTtsRender(),second=structuredClone(render.storyboard.shots[0]);second.id='second';render.storyboard.shots.push(second);render.confirmedShots.push({...structuredClone(render.confirmedShots[0]),shotId:'second'});render.members.push({...structuredClone(render.members[0]),memberKey:'shot:second'},{...structuredClone(render.members[1]),memberKey:'narration:second'});
 const {snapshot,html}=legacyHtmlFixture(render),{project}=importLegacyHtmlWorkspace(snapshot,html,'copy');expect(project.timelines[0].items.find(i=>i.id==='main-tts-narration-second')?.startFrame).toBe(60);expect(snapshot.review_render.members.find((m:any)=>m.member_key==='narration:second').start_seconds).toBe(0);
});
it.each(['missing-video','moved-audio','extra-media','missing-cue','bad-source','bad-total','changed-media','extra-member'])('rejects incomplete or conflicting export %s rather than creating placeholders',kind=>{
 const {snapshot,html}=legacyHtmlFixture(confirmedTtsRender());let source=html;
 if(kind==='missing-video')source=source.replace(/<video[^>]*><\/video>/,'');if(kind==='moved-audio')source=source.replace('<audio id="audio-0" data-start="0"','<audio id="audio-0" data-start="1"');if(kind==='extra-media')source=source.replace('</body>','<audio id="unknown" data-start="0" data-duration="2"></audio></body>');if(kind==='missing-cue')source=source.replace(/<div id="caption[^]*?<\/div>/,'');if(kind==='bad-source')snapshot.review_render.members[0].clip_segments[0].end_seconds=9;if(kind==='bad-total')source=source.replace('data-duration="2"','data-duration="9"');if(kind==='changed-media')source=source.replace(/src="assets\/[^"]+"/,'src="assets/other.mp4"');if(kind==='extra-member')snapshot.review_render.members.push({...snapshot.review_render.members[0],member_key:'shot:unknown'});expect(()=>importLegacyHtmlWorkspace(snapshot,source,'copy')).toThrow(/原工程保持不变/);
});

it('rejects conflicting source in-points and a reordered multi-segment HTML export',()=>{
 const render=confirmedTtsRender();render.members[0].clipSegments=[{startSeconds:0,endSeconds:1},{startSeconds:1,endSeconds:2}];render.confirmedShots[0].clipSegments=render.members[0].clipSegments;
 const {snapshot,html}=legacyHtmlFixture(render);expect(importLegacyHtmlWorkspace(snapshot,html,'copy').project.timelines[0].items.filter(i=>i.kind==='video').map(i=>i.srcInFrame)).toEqual([0,30]);
 expect(()=>importLegacyHtmlWorkspace(snapshot,html.replace('data-media-start="0"','data-media-start="0.5"'),'copy')).toThrow(/原工程保持不变/);
 const videos=[...html.matchAll(/<video[^]*?<\/video>/g)].map(m=>m[0]);expect(()=>importLegacyHtmlWorkspace(snapshot,html.replace(videos[0]+videos[1],videos[1]+videos[0]),'copy')).toThrow(/原工程保持不变/);
});
it('quantizes visual and caption endpoints together so legacy fractional times remain editable within the shot',()=>{
 const render=confirmedTtsRender();render.members[0].clipSegments=[{startSeconds:0,endSeconds:1.012}];render.confirmedShots[0].clipSegments=render.members[0].clipSegments;render.members[0].durationSeconds=1.012;render.members[1].durationSeconds=1.012;render.confirmedShots[0].preparationContract.captions.cues[0].endMs=1012;
 const {snapshot,html}=legacyHtmlFixture(render),{project}=importLegacyHtmlWorkspace(snapshot,html,'copy'),t=project.timelines[0];expect(t.items.find(i=>i.kind==='video')?.durationInFrames).toBe(30);expect(Object.values(t.tracks).flatMap(t=>t.captions?.sourceEntries??[])[0].words[0].end).toBe(1000);
});
