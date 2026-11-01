// @vitest-environment node
import {it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {mkdir,rename,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {embeddedStudioFixture} from './embeddedStudio.fixture';

it.skipIf(process.env.LOOP_WORKSPACE_ACCEPTANCE!=='1')('unassigned navigation counts physical collections across search, archive and frozen creative series, with Owner isolation',async()=>{
 const f=await embeddedStudioFixture({episodeRelativePath:id=>'unassigned/'+id});
 try{
  const account=(await f.c.query('SELECT account_id FROM public.episodes WHERE id=$1',[f.episode])).rows[0].account_id;
  const catalog=async(token=f.token)=>{const r=await fetch(f.origin+'/api/local/catalog?view=accounts&visibility=active&q=not-a-matching-production-'+randomUUID(),{headers:{Cookie:'loop_owner_session='+token}});expect(r.status).toBe(200);return r.json();};
  // Legacy productions without a registered container still count, independently of visible pages.
  let value=await catalog();expect(value.episodes).toHaveLength(0);expect(value.unassignedAccountCounts).toEqual({[account]:1});
  const series=randomUUID(),version=randomUUID(),unassigned=randomUUID(),seriesContainer=randomUUID();
  const unassignedStat=await lstat(join(f.assetRoot,'unassigned'),{bigint:true});
  await f.c.query("INSERT INTO local_identity.account_storage_containers(id,account_id,kind,series_id,directory_relative_path,device_id,inode_id) VALUES($1,$2,'unassigned',NULL,'unassigned',$3,$4)",[unassigned,account,String(unassignedStat.dev),String(unassignedStat.ino)]);
  await f.c.query("INSERT INTO public.series(id,account_id,name) VALUES($1,$2,'冻结创作系列')",[series,account]);
  await f.c.query('INSERT INTO public.series_versions(id,account_id,series_id,version,rules,created_by) VALUES($1,$2,$3,1,$4,$5)',[version,account,series,{},f.owner]);
  await f.c.query('UPDATE public.episodes SET series_version_id=$2,archived_at=now() WHERE id=$1',[f.episode,version]);
  value=await catalog();expect(value.unassignedAccountCounts).toEqual({[account]:1});
  expect((await catalog(f.otherToken)).unassignedAccountCounts).toEqual({});
  // An existing empty container does not create a visible navigation entry.
  const empty=randomUUID();await f.c.query("INSERT INTO public.accounts(id,name,slug,timezone) VALUES($1,'空账号',$2,'UTC')",[empty,'empty-'+empty]);
  await f.c.query("INSERT INTO public.account_memberships(account_id,user_id,role) VALUES($1,$2,'owner')",[empty,f.owner]);
  expect((await catalog()).unassignedAccountCounts[empty]).toBeUndefined();
  // Physical series storage wins even when the frozen creative series is later absent.
  const target=join(f.assetRoot,'series');await mkdir(target);await rename(join(f.assetRoot,f.episodeRelativePath),join(target,f.episode));
  const seriesStat=await lstat(target,{bigint:true});
  await f.c.query("INSERT INTO local_identity.account_storage_containers(id,account_id,kind,series_id,directory_relative_path,device_id,inode_id) VALUES($1,$2,'series',$3,'series',$4,$5)",[seriesContainer,account,series,String(seriesStat.dev),String(seriesStat.ino)]);
  await f.c.query("UPDATE local_identity.episode_asset_locations SET storage_series_id=$2,directory_relative_path=$3 WHERE episode_id=$1",[f.episode,series,'series/'+f.episode]);
  expect((await catalog()).unassignedAccountCounts).toEqual({});
  await f.c.query('UPDATE public.episodes SET series_version_id=NULL WHERE id=$1',[f.episode]);
  expect((await catalog()).unassignedAccountCounts).toEqual({});
 }finally{await f.close();}
},120000);
