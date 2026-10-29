import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';
const evidence='docs/verification/visual-audit-20261028';
const graph=JSON.parse(fs.readFileSync('docs/verification/dan-ui-rollout-20261027/reachable-ui.json','utf8'));
const config=ts.readConfigFile('tsconfig.app.json',ts.sys.readFile).config;
const parsed=ts.parseJsonConfigFileContent(config,ts.sys,process.cwd());
const program=ts.createProgram(parsed.fileNames,parsed.options),checker=program.getTypeChecker(),rows=[];
for(const file of graph.tsx.filter(f=>!f.includes('/dan-ui/'))){const source=program.getSourceFile(path.resolve(file));if(!source)continue;
 function add(node,value,expression){const type=expression?checker.typeToString(checker.getTypeAtLocation(expression)):'static string';rows.push({file,line:source.getLineAndCharacterOfPosition(node.getStart()).line+1,rendered:value.slice(0,400),type:type.slice(0,240),optional:/\b(undefined|null)\b/.test(type),limit:expression?'See FIELD-MAP.md; no display limit inferred from CSS':'Finite literal or enum in source'});}
 function hasJsx(node){if(ts.isJsxElement(node)||ts.isJsxSelfClosingElement(node)||ts.isJsxFragment(node))return true;return node.getChildren(source).some(hasJsx);}
 function visit(node){if(ts.isJsxText(node)&&node.getText().trim())add(node,node.getText().trim());
  if(ts.isJsxExpression(node)&&node.expression&&!ts.isJsxAttribute(node.parent)&&!hasJsx(node.expression))add(node,node.expression.getText(),node.expression);
  if(ts.isJsxAttribute(node)&&['value','label','hint','placeholder','aria-label','title','alt'].includes(node.name.getText())&&node.initializer){let n=node.initializer;add(node,node.name.getText()+': '+n.getText(),ts.isJsxExpression(n)?n.expression:undefined);}
  ts.forEachChild(node,visit);
 }visit(source);
}
fs.writeFileSync(evidence+'/rendered-values.json',JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({productTsx:graph.tsx.filter(f=>!f.includes('/dan-ui/')).length,renderedValues:rows.length}));
