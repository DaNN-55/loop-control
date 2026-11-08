import {expect,it} from 'vitest';
import {soundIntentQuery} from './soundIntent';
it('extracts sound words rather than the visual event or timing',()=>{
 expect(soundIntentQuery('第一束阳光出现在山顶时，一声空灵泛音，不盖过旁白')).toBe('ethereal chime');
 expect(soundIntentQuery('切镜时开门一声轻响')).toBe('door');
 expect(soundIntentQuery('脚步声与风声')).toBe('footsteps wind');
 expect(soundIntentQuery('soft metallic click')).toBe('soft metallic click');
 expect(soundIntentQuery('在这个位置加入合适的声音')).toBe('');
});
