import{describe,it,expect}from'vitest';
import{mappedAssetPath}from'./mediaPaths';
describe('restored media mapping',()=>{
 it('maps frozen roots to the independent destination even when source still exists',()=>{
  expect(mappedAssetPath('/restore/media','/source/media/account',['/source/media'])).toBe('/restore/media/account');
  expect(mappedAssetPath('/restore/media','/legacy/account',['/source/media','/legacy'])).toBe('/restore/media/account');
  expect(mappedAssetPath('/restore/media','/restore/media/account',['/source/media'])).toBe('/restore/media/account');
 });
 it('uses the longest declared prefix and rejects undeclared/traversal/root aliases',()=>{
  expect(mappedAssetPath('/restore/media','/old/sub/account',['/old','/old/sub'])).toBe('/restore/media/account');
  for(const p of['/source/media-evil/account','/source/media/../escape','relative','/source/media'])expect(()=>mappedAssetPath('/restore/media',p,['/source/media'])).toThrow();
 });
});
it('accepts trailing separators in frozen roots while retaining all prefix and traversal checks',()=>{
 expect(mappedAssetPath('/restore/media','/source/media/account/',['/source/media'])).toBe('/restore/media/account');
 expect(mappedAssetPath('/restore/media','/restore/media/account/',['/source/media'])).toBe('/restore/media/account');
 for(const p of ['/source/media/../escape/','/source/media-evil/account/','/source/media/','relative/','/'])expect(()=>mappedAssetPath('/restore/media',p,['/source/media'])).toThrow();
});
