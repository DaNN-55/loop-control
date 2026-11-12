// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {historyBlobTargets,type HistoryDeleteInventory} from './historyEpisodeDeletion';
it('checks runtime path dependencies even with no blob candidates, without treating readable history as execution inputs',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'history-ref-test-'))),history=join(root,'history'),media=join(root,'media'),episode='10000000-0000-4000-8000-000000000001',path=join(media,'episodes',episode);
 const inventory:HistoryDeleteInventory={episodeId:episode,title:'Fixture',revision:'',live:null,records:[],files:[],blobs:[]};
 try{mkdirSync(history);mkdirSync(path,{recursive:true});writeFileSync(join(history,'past-path.json'),JSON.stringify({formerPath:path}));
  writeFileSync(join(media,'standalone.png'),Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aMwoAAAAASUVORK5CYII=','base64'),Buffer.from(path)]));
  expect((await historyBlobTargets(history,inventory,[media],[path])).targets).toHaveLength(0);
  writeFileSync(join(media,'current-project.json'),JSON.stringify({input:`episodes/${episode}/source.mp4`}));
  await expect(historyBlobTargets(history,inventory,[media],[path])).rejects.toThrow('其他留存文件仍引用');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('verifies real history blob bytes and rejects a same-size content change',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'history-blob-digest-'))),sha='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',path=join(root,sha);
 const inventory:HistoryDeleteInventory={episodeId:'10000000-0000-4000-8000-000000000001',title:'Fixture',revision:'',live:null,records:[],files:[],blobs:[{sha256:sha,bytes:3}]};
 try{
  writeFileSync(path,'abc');expect((await historyBlobTargets(root,inventory,[],[])).targets).toMatchObject([{sha,path,bytes:3}]);
  writeFileSync(path,'abd');await expect(historyBlobTargets(root,inventory,[],[])).rejects.toThrow('历史文件已变化');
 }finally{rmSync(root,{recursive:true,force:true});}
});
