import {test} from 'vitest';
import assert from 'node:assert/strict';
import {adaptBusinessSchema} from './import.mjs';
import {readFileSync} from 'node:fs';
test('C business schema can be imported without Auth or Vault services while secret operations fail closed',()=>{
 const {sql,dependencies}=adaptBusinessSchema(readFileSync('db/local/c-baseline.sql','utf8'));
 assert.doesNotMatch(sql,/\bauth\.|\bvault\./);
 assert.match(sql,/REFERENCES local_identity\.owners\(id\)/);
 assert.match(sql,/local_identity\.owner_id\(\)/);
 assert.equal(dependencies.vaultDisabled.length,5);
 assert.match(sql,/local connection secrets are not migrated/);
});
