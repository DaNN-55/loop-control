// @vitest-environment node
import {it,expect} from 'vitest';
import {blueprintSelectionErrors} from '../worker/runtimePreflight';
const policy={executors:{storyboard_planning:{provider:'codex',adapter:'codex',model:'configured-model',prompt_version:'storyboard-v1',harness_id:'synthetic-id'}}};
it('keeps existing static Adapter/model/Harness/path constraints without collecting online evidence',()=>{
 expect(blueprintSelectionErrors({})).not.toEqual([]);
 expect(blueprintSelectionErrors(policy)).toEqual([]);
 expect(blueprintSelectionErrors({...policy,b_roll:{execution_path:'manual'}})).toEqual([]);
 expect(blueprintSelectionErrors({...policy,b_roll:{execution_path:'external',executor:{provider:'pexels',adapter:'pexels_video',model:'unsupported-model',prompt_version:'b-roll-v1'},credential_ref:'00000000-0000-4000-8000-000000000000'}})).not.toEqual([]);
 expect(blueprintSelectionErrors({...policy,b_roll:{executor:{provider:'pexels',adapter:'pexels_video',model:'pexels-video-v1',prompt_version:'b-roll-v1'}}})).not.toEqual([]);
});
