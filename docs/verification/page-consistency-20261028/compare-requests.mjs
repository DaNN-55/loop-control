import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const root='docs/verification/page-consistency-20261028';
const baseline=JSON.parse(fs.readFileSync(path.join(root,'baseline.json'),'utf8'));
const printer=ts.createPrinter({removeComments:true});
function calls(text,file){const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);const result=[];function visit(node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['localRequest','localCommand'].includes(node.expression.text)){result.push({fn:node.expression.text,args:node.arguments.map(arg=>printer.printNode(ts.EmitHint.Expression,arg,source))});}ts.forEachChild(node,visit);}visit(source);return result.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));}
const results=[];
for(const file of Object.keys(baseline.hashes)){if(!file.endsWith('.tsx')||file.includes('.test.'))continue;const before=fs.readFileSync(path.join(root,'before',file),'utf8'),after=fs.readFileSync(file,'utf8');if(before===after)continue;const original=calls(before,file),current=calls(after,file);if(original.length||current.length)results.push({file,calls:original.length,currentCalls:current.length,identical:JSON.stringify(original)===JSON.stringify(current)});}
fs.writeFileSync(path.join(root,'request-contracts.json'),JSON.stringify({note:'AST argument comparison of direct localRequest/localCommand calls; supports source review, not runtime proof.',results},null,2)+'\n');
console.log(JSON.stringify(results));
