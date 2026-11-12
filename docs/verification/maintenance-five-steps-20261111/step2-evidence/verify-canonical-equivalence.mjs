import ts from '/Users/dan/.codex/worktrees/maintenance-20261111/loop-control/node_modules/typescript/lib/typescript.js';
import fs from 'node:fs';import crypto from 'node:crypto';
const names=['configurationCommands','episodeLifecycle','recycleBin','scriptProductionStore','workspaceVisualCandidates','episodeCommands','accountCommands','episodeCollection','commandReceipt'];
const aliases={episodeLifecycle:'fingerprint',recycleBin:'digest',scriptProductionStore:'productionHash',workspaceVisualCandidates:'hash'};
const template=ts.createSourceFile('expr.ts',"createHash('sha256').update(JSON.stringify(canonical(__input))).digest('hex')",ts.ScriptTarget.Latest,true).statements[0].expression;
const synthesize=node=>{ts.setTextRange(node,{pos:-1,end:-1});ts.forEachChild(node,synthesize);};synthesize(template);
const normalize=code=>{const scanner=ts.createScanner(ts.ScriptTarget.Latest,true,ts.LanguageVariant.Standard,code),tokens=[];let token;while((token=scanner.scan())!==ts.SyntaxKind.EndOfFileToken)tokens.push([token,token===ts.SyntaxKind.StringLiteral?scanner.getTokenValue():scanner.getTokenText()]);return JSON.stringify(tokens);};
const printer=ts.createPrinter({removeComments:true}),results=[];
for(const name of names){
 const file='src/local-app/'+name+'.ts',paths=['/tmp/loop-maint-step2-20261111/group5-before/'+file,file],calls=[[],[]],expanded=[];
 for(let index=0;index<paths.length;index++){
  const source=ts.createSourceFile(file,fs.readFileSync(paths[index],'utf8'),ts.ScriptTarget.Latest,true);
  const result=ts.transform(source,[context=>root=>{
   const replaceTemplate=argument=>{
    const substitute=node=>ts.isIdentifier(node)&&node.text==='__input'?ts.visitNode(argument,visit):ts.visitEachChild(node,substitute,context);
    return ts.visitNode(template,substitute);
   };
   const visit=node=>{
    if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node))return undefined;
    if(ts.isFunctionDeclaration(node)&&node.name?.text==='canonicalFingerprint')return undefined;
    if(ts.isVariableStatement(node)&&node.declarationList.declarations.length===1&&node.declarationList.declarations[0].name.getText(source)===aliases[name])return undefined;
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&[aliases[name],'canonicalFingerprint'].filter(Boolean).includes(node.expression.text)){
     if(node.arguments.length!==1)throw Error('Unexpected arity: '+file);
     calls[index].push({name:node.expression.text,line:source.getLineAndCharacterOfPosition(node.getStart(source)).line+1,argument:node.arguments[0].getText(source)});
     return replaceTemplate(node.arguments[0]);
    }
    return ts.visitEachChild(node,visit,context);
   };return ts.visitNode(root,visit);
  }]);
  expanded.push(printer.printFile(result.transformed[0]));result.dispose();
 }
 const equal=normalize(expanded[0])===normalize(expanded[1]);results.push({file,equal,oldExpandedCalls:calls[0],newExpandedCalls:calls[1],expandedSha256:expanded.map(s=>crypto.createHash('sha256').update(normalize(s)).digest('hex'))});
 if(!equal){fs.writeFileSync('/tmp/loop-maint-step2-20261111/'+name+'-before-expanded.ts',expanded[0]);fs.writeFileSync('/tmp/loop-maint-step2-20261111/'+name+'-after-expanded.ts',expanded[1]);}
}
fs.writeFileSync('/tmp/loop-maint-step2-20261111/canonical-equivalence.json',JSON.stringify({method:'Remove imports/export aliases and deduplicated leaf declarations; inline the unchanged canonical SHA-256 expression at each exact alias/helper call; print remaining statements and compare non-trivia token streams including literal values; template nodes are synthetic to avoid source-offset reuse. Import bindings and the removed leaf bodies are reviewed separately.',results,allEqual:results.every(r=>r.equal)},null,2));
console.log(results.map(({file,equal,oldExpandedCalls,newExpandedCalls})=>({file,equal,oldCalls:oldExpandedCalls.length,newCalls:newExpandedCalls.length})));
if(!results.every(r=>r.equal))process.exitCode=1;
