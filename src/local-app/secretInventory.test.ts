// @vitest-environment node
import{it,expect}from'vitest';
import{mkdtempSync,mkdirSync,writeFileSync,rmSync}from'node:fs';
import{join}from'node:path';
import{createHash}from'node:crypto';
import{SecretInventory}from'./secretInventory';
it('excludes migrated public literals including immutable historical aliases from secret metadata',async()=>{
 const dir=mkdtempSync('/private/tmp/loop-literal-inventory-'),root=join(dir,'.loop-control/local'),literal='00000000-0000-4000-8000-000000000001',alias='00000000-0000-4000-8000-000000000002',live='00000000-0000-4000-8000-000000000003';
 mkdirSync(join(root,'history/content'),{recursive:true,mode:0o700});
 const text=Buffer.from('old marker keychain:'+alias),sha=createHash('sha256').update(text).digest('hex');
 writeFileSync(join(root,'history/content',sha),text,{mode:0o600});
 writeFileSync(join(root,'secret-index.json'),JSON.stringify({version:1,entries:{live:{reference:live}},referenceAliases:{[alias]:literal},historicalLiterals:{[literal]:{}}}),{mode:0o600});
 try{
  const inventory=new SecretInventory({runtimeRoot:root,controlReferences:[]});
  const rows=await inventory.read({connections:[],intents:[],history:[{reference:literal,occurrences:2}],files:[{sha256:sha,bytes:text.length,logical_path:'.env.example'}]});
  expect(rows.some(r=>r.reference===literal||r.reference===alias)).toBe(false);
  expect(rows.some(r=>r.reference===live)).toBe(true);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
