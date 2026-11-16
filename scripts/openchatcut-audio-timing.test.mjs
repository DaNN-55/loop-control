import {expect,it} from 'vitest';
import {needsTemplateAudioAlignment} from './openchatcut-audio-timing.mjs';
it('aligns only an adopted effect with explicitly filled template timing, including zero',()=>{
 const state={items:[{loopControlShot:{shotId:'one',renderPreferences:{sfxStart:0}}},{kind:'audio',loopControlAudio:{kind:'sfx',anchor:'shot',shotId:'one'}}]};
 expect(needsTemplateAudioAlignment(state)).toBe(true);delete state.items[0].loopControlShot.renderPreferences.sfxStart;expect(needsTemplateAudioAlignment(state)).toBe(false);
 state.items[0].loopControlShot.renderPreferences.sfxDuration=.4;state.items[1].loopControlAudio.shotId='another';expect(needsTemplateAudioAlignment(state)).toBe(false);
});
