// @vitest-environment node

import {expect,it} from 'vitest';
import {productionCopyId,remapProductionCopy} from './productionCopyMapping';
it('uses stable new identities and rewrites native references without altering creative text',()=>{
 const id='11111111-1111-4111-8111-111111111111',copy='22222222-2222-4222-8222-222222222222',mapped=productionCopyId(copy,id);expect(mapped).not.toBe(id);expect(productionCopyId(copy,id)).toBe(mapped);
 const result=remapProductionCopy({id:'workspace-narration-'+id,sourceAssetId:'audio-track-'+id,src:'old/source.mp3',loopControlShot:{clipId:id,text:'保留正文 '+id},props:{text:'字幕 '+id},durationInFrames:45,volume:0.6},{[id]:mapped,'old/source.mp3':'new/source.mp3'});
 expect(result).toEqual({id:'workspace-narration-'+mapped,sourceAssetId:'audio-track-'+mapped,src:'new/source.mp3',loopControlShot:{clipId:mapped,text:'保留正文 '+id},props:{text:'字幕 '+id},durationInFrames:45,volume:0.6});
});
