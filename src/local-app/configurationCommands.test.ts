// @vitest-environment node
import {it,expect} from 'vitest';
import {validateConfigurationPolicy} from './configurationCommands';
it('blocks unavailable connections and secret fields in nonsecret blueprint configuration',()=>{
 expect(()=>validateConfigurationPolicy({narration:{execution_path:'external'}})).toThrow();
 expect(()=>validateConfigurationPolicy({narration:{credential_ref:'synthetic-version'}})).toThrow();
 expect(()=>validateConfigurationPolicy({api_key:'synthetic'})).toThrow();
 expect(()=>validateConfigurationPolicy({positioning:'local',approval_gates:[]})).not.toThrow();
});
