// Read-only candidate census. Run from the repository root; stdout is JSON.
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import ts from 'typescript';

const tracked=execFileSync('git',['ls-files','-z','--','src','scripts','db/local'],{encoding:'utf8'}).split('\0').filter(Boolean);
const files=tracked.filter(file=>/\.(?:tsx?|mjs|sql)$/.test(file)&&!/(?:\.test\.|\.fixture\.|\.prototype\.|\.d\.ts$|\/dan-ui\/|\/e2e\/|\/fixtures\/)/.test(file));
const signals=[];
for(const file of files){
 const source=readFileSync(file,'utf8'),entries=[];
 if(file.endsWith('.sql')){
  const lines=source.split('\n');
  lines.forEach((line,index)=>{
   if(/CREATE TYPE.*(?:status|stage)|CHECK\s*\(.*(?:status|state|phase|outcome)|(?:status|state|phase|outcome).*CHECK\s*\(/i.test(line))entries.push({line:index+1,kind:'sql-constraint',text:line.trim().slice(0,260)});
  });
 }else{
  const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  const add=(node,kind,text)=>entries.push({line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,kind,text:text.slice(0,260)});
  function visit(node){
   if(ts.isVariableDeclaration(node)&&node.initializer&&ts.isCallExpression(node.initializer)&&/^(?:React\.)?use(?:State|Reducer|Ref)$/.test(node.initializer.expression.getText(ast)))add(node,'react-state-or-ref',node.getText(ast));
   if(ts.isUnionTypeNode(node)&&node.types.some(type=>ts.isLiteralTypeNode(type)&&ts.isStringLiteral(type.literal)))add(node,'literal-union',node.getText(ast));
   if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&/\.(?:status|state|phase|stage|outcome)$/.test(node.left.getText(ast)))add(node,'control-write',node.getText(ast));
   if(ts.isPropertyAssignment(node)&&/^(?:status|state|phase|stage|outcome)$/.test(node.name.getText(ast)))add(node,'control-field',node.getText(ast));
   ts.forEachChild(node,visit);
  }
  visit(ast);
 }
 if(entries.length)signals.push({file,entries});
}
process.stdout.write(JSON.stringify({
 baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 scope:'Tracked application TypeScript/TSX, runtime/storage scripts and SQL migrations. Excludes tests, fixtures, prototypes, generated .d.ts, dan-ui primitives and e2e scripts. Includes archived protocol code still tracked. SQL is historical source, not a live database schema.',
 limitations:'Candidates only: refs may be DOM handles; literal unions may be choices rather than temporal states. Closure booleans, SQL bodies, timestamps and cross-process protocols require manual review. See docs/architecture/state-machines.md.',
 scannedFiles:files,filesWithSignals:signals.length,signalCount:signals.reduce((count,file)=>count+file.entries.length,0),signals,
},null,2)+'\n');
