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
it('groups the same connection name with current first and numeric historical versions descending, keeping canonical references unique',async()=>{
 const dir=mkdtempSync('/private/tmp/loop-version-inventory-'),root=join(dir,'.loop-control/local'),refs=['00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'];
 mkdirSync(root,{recursive:true,mode:0o700});writeFileSync(join(root,'secret-index.json'),JSON.stringify({version:1,entries:{'provider-secret':{reference:refs[2],previous:[refs[1],refs[0]]}},nameAliases:{'provider-alias':{reference:refs[2],previous:[refs[0]]}},referenceAliases:{[refs[3]]:refs[0]}}),{mode:0o600});
 try{
  const rows=await new SecretInventory({runtimeRoot:root,controlReferences:[]}).read({connections:[{reference:refs[1],connectionId:'connection',name:'合成同名连接',provider:'synthetic',version:2,current:false,revoked:false},{reference:refs[0],connectionId:'connection',name:'合成同名连接',provider:'synthetic',version:10,current:false,revoked:false},{reference:refs[2],connectionId:'connection',name:'合成同名连接',provider:'synthetic',version:3,current:true,revoked:false}],intents:[],history:[],files:[]});
  expect(rows.filter(row=>row.connections.length).map(row=>row.reference)).toEqual([refs[2],refs[0],refs[1]]);
  expect(rows.filter(row=>row.connections.length).map(row=>row.names[0])).toEqual(['合成同名连接','合成同名连接','合成同名连接']);expect(rows.filter(row=>row.reference===refs[0])).toHaveLength(1);expect(rows.find(row=>row.reference===refs[0])?.aliases).toContain(refs[3]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
