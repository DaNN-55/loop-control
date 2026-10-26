import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {root,projectRoot,container,docker,sql,writePrivateFile,verifiedSource} from './environment.mjs';
import {readBackup} from '../isolation/backup.mjs';
import {businessCopies} from './import.mjs';
const pointer=JSON.parse(readFileSync(join(projectRoot,'docs/verification/stage-c-t11/stage-c-backup.json'))),m=readBackup(pointer.root,verifiedSource());
const data=docker(['exec','-i',container,'pg_restore','--data-only','--no-owner','--no-privileges','--file=-'],readFileSync(join(pointer.root,'business.dump')));
const tables={};
for(const copy of businessCopies(data)){
 const current=docker(['exec','-i',container,'psql','-XqAt','-U','postgres','-d','loop_imported','-v','ON_ERROR_STOP=1'],`COPY public.${copy.table} (${copy.columns}) TO STDOUT;`);
 const records=current.split('\n').slice(0,-1),counts=new Map();for(const row of records)counts.set(row,(counts.get(row)??0)+1);
 for(const row of copy.records.split('\n').slice(0,-1)){const count=counts.get(row)??0;assert.ok(count>0,`Original row changed or missing in ${copy.table}`);counts.set(row,count-1);}
 tables[copy.table]={original:m.inventory[copy.table].count,current:records.length,allOriginalRecordsPreserved:true};
}
const result={at:new Date().toISOString(),sourceCreatedAt:m.createdAt,originalRows:Object.values(m.inventory).reduce((n,t)=>n+t.count,0),tables,allOriginalRecordsPreserved:true,newRows:'Explicit D synthetic configuration fixtures retained; original rows unchanged'};
writePrivateFile(join(root,'state/t14-original-history.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({allOriginalRecordsPreserved:true,tables:Object.keys(tables).length,originalRows:result.originalRows}));
