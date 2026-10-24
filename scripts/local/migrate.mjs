import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {projectRoot,sql,verifiedSource} from './environment.mjs';
for(const database of ['loop_empty','loop_imported']){
 sql('create table if not exists local_identity.schema_migrations(version text primary key,sha256 text not null,applied_at timestamptz not null default now())',database);
 for(const file of ['002-owner.sql','003-media-roots.sql','004-configuration.sql','005-configuration-lock.sql','006-configuration-revision-lock.sql','007-connections.sql','008-connection-qualification.sql','009-episode-input.sql','010-input-scheduler-turn.sql','011-input-owner-lock.sql','012-input-worker-fence-call.sql','013-storyboard.sql','014-narration.sql','015-narration-retry.sql']){
  const body=readFileSync(join(projectRoot,'db/local',file),'utf8'),hash=createHash('sha256').update(body).digest('hex');
  const previous=sql(`select sha256 from local_identity.schema_migrations where version='${file}'`,database);
  if(previous){if(previous!==hash)throw Error('Applied local migration changed');continue;}
  sql(`begin;${body}\ninsert into local_identity.schema_migrations(version,sha256) values('${file}','${hash}');commit;`,database);
 }
 const sourceRoot=verifiedSource().mediaRoot.replaceAll("'","''");
 sql(`update local_identity.import_record set source_media_root='${sourceRoot}' where source_media_root is null`,database);
 console.log(JSON.stringify({database,migrated:true}));
}
