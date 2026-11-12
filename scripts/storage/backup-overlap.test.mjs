import {expect,it,vi} from 'vitest';
import {createNativeBackup} from './backup.mjs';

const backupRoot='/fixture/backups/fixture';
function fixture(mediaRoot){
 const input={projectRoot:'/fixture/program',database:'fixture',mediaRoot,backupRoot,jobId:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'};
 const ensurePrivateDirectory=vi.fn(()=>{throw Error('Reached independent backup directory');});
 return{input,ensurePrivateDirectory,runtime:{root:'/fixture',projectRoot:input.projectRoot,database:input.database,mediaRoot,dailyRuntime:true,assertDatabase:vi.fn(),ensurePrivateDirectory}};
}
it.each([backupRoot,'/fixture/backups',backupRoot+'/nested'])('rejects overlapping daily backup roots before any filesystem write: %s',async mediaRoot=>{
 const f=fixture(mediaRoot);
 await expect(createNativeBackup(f.input,undefined,f.runtime)).rejects.toThrow('Backup and media roots must not overlap');
 expect(f.ensurePrivateDirectory).not.toHaveBeenCalled();
});
it.each([backupRoot+'-sibling','/separate/media'])('allows a distinct root through the overlap guard: %s',async mediaRoot=>{
 const f=fixture(mediaRoot);
 await expect(createNativeBackup(f.input,undefined,f.runtime)).rejects.toThrow('Reached independent backup directory');
 expect(f.ensurePrivateDirectory).toHaveBeenCalledExactlyOnceWith(backupRoot);
});
