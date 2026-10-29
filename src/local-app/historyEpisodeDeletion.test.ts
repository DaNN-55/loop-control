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
