import {readFileSync,existsSync,copyFileSync,chmodSync} from 'node:fs';
import {join,resolve,relative} from 'node:path';
import {root,projectRoot,ensurePrivateDirectory,verifiedSource} from './environment.mjs';
import {assertPrivatePath} from '../isolation/environment.mjs';
import {readBackup,digest} from '../isolation/backup.mjs';
const pointer=JSON.parse(readFileSync(join(projectRoot,'docs/verification/stage-c-t11/stage-c-backup.json')));
const manifest=readBackup(pointer.root,verifiedSource()),destinationRoot=join(root,'media');ensurePrivateDirectory(destinationRoot);
for(const file of manifest.media){
 const destination=resolve(destinationRoot,file.path);assertPrivatePath(destination);if(relative(destinationRoot,destination).startsWith('..'))throw Error('Unsafe media reference');
 ensurePrivateDirectory(resolve(destination,'..'));
 if(!existsSync(destination)){copyFileSync(join(pointer.root,'media',file.path),destination);chmodSync(destination,0o600);}
 if(digest(readFileSync(destination))!==file.sha256)throw Error('Media fingerprint mismatch; refusing overwrite');
}
console.log(JSON.stringify({copiedAndVerified:manifest.media.length,productionMediaUntouched:true}));
