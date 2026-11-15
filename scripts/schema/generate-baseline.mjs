// Input must be pg_dump --schema-only --no-owner of a fresh immutable forward chain.
// node scripts/schema/generate-baseline.mjs <schema.sql> <db/current directory>
import {readFileSync,readdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
export function generateEffectiveBaseline(schema,sources){
 if(/^(?:INSERT INTO|COPY )/m.test(schema))throw Error('Schema-only dump required');
 const sha=body=>createHash('sha256').update(body).digest('hex');
 const body='-- clean-v3: effective schema after immutable forwards through 200. No historical ledger rows.\n'+schema.replace(/^\\(?:un)?restrict .*\n/gm,'')+'\nGRANT loop_owner TO loop_app;\n';
 return{body,manifest:{generation:'clean-v3',baselineSha256:sha(body),covered:Object.fromEntries(sources.map(s=>[s.version,sha(s.body)]))}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,current,check,...extra]=process.argv.slice(2);if(!input||!current||extra.length||check&&check!=="--check")throw Error('Usage: generate-baseline.mjs <schema.sql> <db/current directory> [--check]');
 const files=['baseline.sql',...readdirSync(current).filter(n=>/^[0-9]{3}-[a-z0-9-]+\.sql$/.test(n)).sort()];
 const sources=files.map(n=>({version:n==='baseline.sql'?'clean-v2.sql':n,body:readFileSync(join(current,n),'utf8')}));
 const {body,manifest}=generateEffectiveBaseline(readFileSync(input,'utf8'),sources);
 const encoded=JSON.stringify(manifest,null,2)+'\n';
 const manifestExists=existsSync(join(current,'effective-manifest.json')),baselineExists=existsSync(join(current,'effective-baseline.sql'));
 if(manifestExists!==baselineExists)throw Error('Incomplete immutable clean-v3 baseline pair; retain both artifacts for recovery');
 if(manifestExists&&(readFileSync(join(current,'effective-manifest.json'),'utf8')!==encoded||readFileSync(join(current,'effective-baseline.sql'),'utf8')!==body))throw Error('Immutable clean-v3 baseline changed; create a new generation instead');
 if(check){if(!existsSync(join(current,'effective-manifest.json')))throw Error('Effective baseline is missing');}else if(!manifestExists){writeFileSync(join(current,'effective-baseline.sql'),body,{flag:'wx'});writeFileSync(join(current,'effective-manifest.json'),encoded,{flag:'wx'});}
}
