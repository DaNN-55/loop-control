import ts from '/Users/dan/.codex/worktrees/maintenance-20261111/loop-control/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';import cp from 'node:child_process';import crypto from 'node:crypto';
const files=cp.execFileSync('git',['ls-files','src','scripts'],{encoding:'utf8'}).trim().split('\n').filter(p=>/\.(?:[cm]?js|tsx?)$/.test(p));
const inventory=[],functions=[];
for(const f of files){
 const excluded=/\.test\.|\.integration\.|\.fixture\.|\/fixtures\/|\.prototype\.|\/ui\/dan-ui\/|database\.types\.ts|vite-env\.d\.ts/.test(f);inventory.push({file:f,excluded});
 if(excluded)continue;
 const code=fs.readFileSync(f,'utf8');const sf=ts.createSourceFile(f,code,ts.ScriptTarget.Latest,true,f.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 const visit=n=>{if((ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n)||ts.isArrowFunction(n)||ts.isMethodDeclaration(n))&&n.body){
  const body=n.body.getText(sf);const pmap=new Map();n.parameters.forEach((p,i)=>{if(ts.isIdentifier(p.name))pmap.set(p.name.text,'$p'+i)});
  const sc=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,body);const tokens=[];let t;while((t=sc.scan())!==ts.SyntaxKind.EndOfFileToken){let v=sc.getTokenText();if(t===ts.SyntaxKind.Identifier&&pmap.has(v))v=pmap.get(v);tokens.push(v)}
  if(tokens.length>=12){let name=n.name?.getText(sf);if(!name&&ts.isVariableDeclaration(n.parent))name=n.parent.name.getText(sf);if(!name)name='anonymous';functions.push({file:f,name,line:sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1,endLine:sf.getLineAndCharacterOfPosition(n.end).line+1,length:body.length,tokens:tokens.length,key:crypto.createHash('sha256').update(tokens.join(' ')).digest('hex'),body});}
 }ts.forEachChild(n,visit)};visit(sf)
}
const groups=new Map();for(const f of functions){const a=groups.get(f.key)??[];a.push(f);groups.set(f.key,a)}
const duplicateGroups=[...groups.values()].filter(a=>a.length>1).sort((a,b)=>b[0].tokens-a[0].tokens);
fs.writeFileSync('/tmp/loop-maint-step2-20261111/inventory.json',JSON.stringify({files:inventory,scanned:inventory.filter(f=>!f.excluded).length,functionCount:functions.length},null,2));
fs.writeFileSync('/tmp/loop-maint-step2-20261111/exact-groups.json',JSON.stringify(duplicateGroups,null,2));
console.log(JSON.stringify({totalFiles:files.length,scanned:inventory.filter(f=>!f.excluded).length,functions:functions.length,groups:duplicateGroups.map((a,i)=>({id:i,tokens:a[0].tokens,items:a.map(({file,name,line,endLine})=>({file,name,line,endLine}))}))},null,2));
