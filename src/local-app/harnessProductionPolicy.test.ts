// @vitest-environment node
import {describe,it,expect} from 'vitest';
import type {IncomingMessage} from 'node:http';
import {authorizeHarnessProduction} from './harnessProductionPolicy';
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const scope={owner:{id,email:'test@example.invalid'},episodeIds:[id]};
const request=(url:string,method='GET')=>({url,method,headers:{host:'loop-control.internal'}} as IncomingMessage);
describe('Harness production capability',()=>{
 it('reads only allowed native pages in episode scope',async()=>{
  await expect(authorizeHarnessProduction(scope,request('/api/local/episodes/'+id),async()=>({}))).resolves.toBeUndefined();
  for(const url of ['/api/local/episodes/'+other,'/api/local/secrets','/api/local/../secrets','/api/local/catalog?view=accounts'])await expect(authorizeHarnessProduction(scope,request(url),async()=>({}))).rejects.toMatchObject({status:403});
 });
 it('denies generation, configuration and cross-episode mutations',async()=>{
  const operation=(command:string,episodeId=id)=>({command,data:{episodeId},idempotencyKey:id});
  for(const body of [operation('generateWorkspaceVisuals'),operation('create'),operation('exportWorkspace',other)])await expect(authorizeHarnessProduction(scope,request('/api/local/episode-commands','POST'),async()=>body)).rejects.toMatchObject({status:403});
  const body=operation('prepareWorkspace');await expect(authorizeHarnessProduction(scope,request('/api/local/episode-commands','POST'),async()=>body)).resolves.toEqual(body);
 });
});
