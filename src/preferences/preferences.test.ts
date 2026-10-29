import {expect,it} from 'vitest';
import {defaultOwnerPreferences,parseOwnerPreferences} from './preferences';
it('normalizes display names and rejects unsupported preference fields at the boundary',()=>{
 expect(parseOwnerPreferences({...defaultOwnerPreferences,displayName:'  Dan  '})).toEqual({...defaultOwnerPreferences,displayName:'Dan'});
 for(const patch of [{displayName:'x'.repeat(61)},{displayName:'a\nb'},{language:'en-US'},{appearance:'blue'},{compactRows:'yes'},{unknown:true},{notifications:{review:true,failure:false}},{notifications:{review:true,failure:true,delivery:true,unknown:true}}])expect(()=>parseOwnerPreferences({...defaultOwnerPreferences,...patch})).toThrow();
});
it('reads legacy preferences without an avatar and validates bounded raster data URLs',()=>{
 const {avatar,...legacy}=defaultOwnerPreferences;expect(parseOwnerPreferences(legacy).avatar).toBeNull();
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5f8AAAAASUVORK5CYII=';
 expect(parseOwnerPreferences({...legacy,avatar:png}).avatar).toBe(png);
 for(const avatar of ['https://example.com/photo.png','data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,AAAA','data:image/jpeg;base64,iVBORw0KGgo=','data:image/png;base64,'+'A'.repeat(100000),true,42])expect(()=>parseOwnerPreferences({...legacy,avatar})).toThrow('头像');
});
