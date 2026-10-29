// @vitest-environment node
import{it,expect,vi}from'vitest';import{decodeCopy,writeHistoryTables,protectedText}from'./history-consolidation.mjs';
vi.mock('./secrets.mjs',()=>({putNamedSecret:vi.fn(()=>'00000000-0000-4000-8000-000000000001')}));
import{putNamedSecret}from'./secrets.mjs';
it('preserves PostgreSQL JSON decimals and integers beyond JavaScript precision through the actual COPY writer',()=>{
 const source='{"fraction":0.123456789012345678901,"integer":9007199254740993,"nested":[1.0000000000000001]}',rows=decodeCopy({columns:'id, payload',records:'fixture\t'+source+'\n'},{payload:'jsonb'});let sql='';const count=writeHistoryTables({sql:value=>{sql=value;}},'00000000-0000-4000-8000-000000000001','a'.repeat(64),{'public.fixture':rows},{});
 expect(count).toBe(1);expect(sql).toContain('0.123456789012345678901');expect(sql).toContain('9007199254740993');expect(sql).toContain('1.0000000000000001');expect(sql).toContain('superseded-import-precision');
});
it('keeps empty template keys, following public lines and explicit documentation placeholders out of Keychain',()=>{
 const text='API_KEY=\nMODEL=example-model\nAPI_SECRET=  \r\n# public comment\nSUPABASE_SERVICE_ROLE_KEY=<仅限本机的 service role key>\nVITE_SUPABASE_PUBLISHABLE_KEY=<Supabase publishable key>\n',replacements=[];
 expect(protectedText(Buffer.from(text),'synthetic.env.example',replacements).toString()).toBe(text);
 expect(replacements).toEqual([]);
});
it('still protects nonempty credential lines without consuming the following public model',()=>{
 const replacements=[],text='PROVIDER_API_KEY=synthetic-credential\nMODEL=example-model\n';
 const protectedValue=protectedText(Buffer.from(text),'synthetic.env',replacements).toString();
 expect(protectedValue).toBe('PROVIDER_API_KEY=keychain:00000000-0000-4000-8000-000000000001\nMODEL=example-model\n');
 expect(putNamedSecret).toHaveBeenCalledWith('history/synthetic.env/PROVIDER_API_KEY','synthetic-credential');
 expect(replacements).toHaveLength(1);
});
