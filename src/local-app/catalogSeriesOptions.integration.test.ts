// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {nativeWorkspaceFixture} from './nativeWorkspace.fixture';
import {productionWorkspaceMigrations} from './productionWorkspace.fixture';
import {parseCatalogQuery,readLocalCatalog} from './catalog';

it('counts populated series before pagination and filters, within the Owner and account scope',async()=>{
 const f=await nativeWorkspaceFixture({migrations:productionWorkspaceMigrations});
 try{
  const account=randomUUID(),otherAccount=randomUUID(),series=randomUUID(),emptySeries=randomUUID(),version=randomUUID();
  for(const [id,owner] of [[account,f.owner],[otherAccount,f.other]]){
   await f.c.query("INSERT INTO public.accounts(id,slug,name,timezone) VALUES($1,$2,'系列筛选验收','Asia/Shanghai')",[id,'series-filter-'+id]);
   await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[id,owner]);
   await f.c.query("INSERT INTO public.account_blueprint_versions(id,account_id,version,policy) VALUES($1,$1,1,'{}')",[id]);
  }
  await f.c.query("INSERT INTO public.series(id,account_id,name) VALUES($1,$3,'有内容'),($2,$3,'空系列')",[series,emptySeries,account]);
  await f.c.query("INSERT INTO public.series_versions(id,account_id,series_id,version,rules,created_by) VALUES($1,$2,$3,1,'{}',$4)",[version,account,series,f.owner]);
  for(let n=0;n<24;n++)await f.c.query("INSERT INTO public.episodes(id,account_id,blueprint_version_id,title,stage,archived_at,series_version_id) VALUES($1,$2,$2,$3,'waiting_input',$4,$5)",[randomUUID(),n===23?otherAccount:account,'筛选 '+n,n===22?'2026-01-01':null,n<21?version:null]);
  const read=(patch:Record<string,string>={})=>readLocalCatalog(f.pool,f.owner,parseCatalogQuery(new URLSearchParams({view:'operations',accountId:account,...patch})));
  const first=await read();expect(first.episodes).toHaveLength(20);
  expect(first.filterAccountCounts).toEqual({[account]:22});expect(first.visibilityCounts).toEqual({active:22,archived:1});
  expect(first.seriesEpisodeCounts).toEqual({[series]:21,unassigned:1});
  const patches:Record<string,string>[]=[{page:'2'},{seriesId:series},{status:'done'},{q:'没有匹配'}];
  for(const patch of patches){const result=await read(patch);expect(result.seriesEpisodeCounts).toEqual(first.seriesEpisodeCounts);expect(result.filterAccountCounts).toEqual(first.filterAccountCounts);expect(result.visibilityCounts).toEqual(first.visibilityCounts);}
  expect((await read({view:'episodes',visibility:'archived'})).filterAccountCounts).toEqual({[account]:1});
  expect((await read({view:'episodes',visibility:'all'})).filterAccountCounts).toEqual({[account]:23});
  expect((await read({accountId:otherAccount})).seriesEpisodeCounts).toEqual({});
  expect((await read({accountId:''})).seriesEpisodeCounts).toEqual(first.seriesEpisodeCounts);
 }finally{await f.close();}
},60000);
