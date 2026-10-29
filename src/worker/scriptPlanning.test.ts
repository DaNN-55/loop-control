import {it,expect} from 'vitest';
import {parseProductionScript,productionScriptTemplate} from '../reviews/productionScript';
import {storyboardFromScript} from './scriptPlanning';
import {validateStoryboardManifest} from './contracts';
it('produces a reviewable storyboard without asking a model to rewrite typed settings',()=>{
 const script=parseProductionScript(productionScriptTemplate.replace('- 音效素材：无','- 音效素材：流水\n- 音效起点（秒）：0.3\n- 音效时长（秒）：1'))!;
 const inputs=[{artifactType:'main_script',relativePath:'episodes/e/script.md',sha256:'a'.repeat(64),fileSize:100},{artifactType:'visual_reference',relativePath:'episodes/e/first.png',sha256:'b'.repeat(64),fileSize:100}];
 const board=storyboardFromScript(script,inputs);expect(validateStoryboardManifest(board,inputs)).toEqual(board);expect(board.shots[0].productionMethod).toBe(script.segments[0].videoPrompt);expect(board.audioCues[0]).toMatchObject({kind:'sfx',startSeconds:0.3,durationSeconds:1});
});
