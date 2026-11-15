// @vitest-environment node
import {expect,it} from 'vitest';
import {archiveCopies} from './native-backup-format.mjs';
const copy=columns=>'COPY local_identity.production_shot_versions ('+columns+') FROM stdin;\nrevision\tepisode\tshot-01\t1\tscript\tretained\t{}\n\\.\n';
it('retains the original unquoted COPY column contract',()=>{
 const rows=archiveCopies(copy('preparation_revision_id, episode_id, shot_id, position, origin, baseline_text, snapshot'));
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({table:'local_identity.production_shot_versions',columns:'preparation_revision_id, episode_id, shot_id, position, origin, baseline_text, snapshot',rows:1,records:'revision\tepisode\tshot-01\t1\tscript\tretained\t{}\n'});
});
it('preserves pg_dump quoted reserved column names for exact COPY restore and verification',()=>{
 const columns='preparation_revision_id, episode_id, shot_id, "position", origin, baseline_text, snapshot';
 expect(archiveCopies(copy(columns))[0]).toMatchObject({table:'local_identity.production_shot_versions',columns,rows:1});
});
it.each(['position; DROP TABLE public.tasks','"position"; SELECT 1','"position", pg_sleep(1)','"position" -- comment','"position, other"','"position""escape"','schema.position','"position','position"'])('rejects SQL expressions and escaping outside the fixed identifier grammar: %s',columns=>{
 expect(()=>archiveCopies(copy(columns))).toThrow('Unsupported');
});
it('still rejects duplicate COPY tables',()=>{
 expect(()=>archiveCopies(copy('"position"')+copy('"position"'))).toThrow('duplicate archive tables');
});
