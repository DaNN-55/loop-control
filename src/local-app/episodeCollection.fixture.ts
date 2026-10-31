import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import {csrfFor} from './sessions';
import type {embeddedStudioFixture} from './embeddedStudio.fixture';
type Fixture=Awaited<ReturnType<typeof embeddedStudioFixture>>;
export function collectionOwnerPost(f:Pick<Fixture,'origin'|'token'>){return async(route:string,command:string,data:Record<string,unknown>,key=randomUUID())=>{const r=await fetch(f.origin+'/api/local/'+route,{method:'POST',headers:{Cookie:'loop_owner_session='+f.token,Origin:f.origin,'Content-Type':'application/json','X-CSRF-Token':csrfFor(f.token)},body:JSON.stringify({command,idempotencyKey:key,data})});return{status:r.status,body:await r.json()};};}
/** Existing public commands only; no fixture path projection or replacement authority. */
export async function prepareCollectionTargets(f:Fixture){
 const post=collectionOwnerPost(f),account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
 const a=await post('configuration','createSeries',{accountId:account,name:'收纳 A [100% #?]',rules:{positioning:'A创作规则'}}),b=await post('configuration','createSeries',{accountId:account,name:'收纳 B _✨',rules:{positioning:'B创作规则'}});expect(a.status,JSON.stringify(a.body)).toBe(200);expect(b.status,JSON.stringify(b.body)).toBe(200);
 const adoption=await post('account-commands','planLegacyStorageAdoption',{accountId:account});expect(adoption.status,JSON.stringify(adoption.body)).toBe(200);expect(adoption.body.conflicts).toEqual([]);expect((await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:adoption.body.id})).status).toBe(200);
 return{post,account,a:a.body,b:b.body,adoption:adoption.body};
}
export async function moveCollection(f:Fixture,account:string,seriesId:string|null){
 const post=collectionOwnerPost(f),planned=await post('account-commands','planEpisodeCollectionMove',{episodeId:f.episode,seriesId});expect(planned.status,JSON.stringify(planned.body)).toBe(200);expect(planned.body.conflicts).toEqual([]);
 const result=await post('account-commands','executeAssetDirectoryMigration',{accountId:account,migrationId:planned.body.id});if(result.status!==200)console.error((await f.c.query('SELECT error FROM local_identity.account_directory_migrations WHERE id=$1',[planned.body.id])).rows);expect(result.status,JSON.stringify(result.body)).toBe(200);return result.body;
}
