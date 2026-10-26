import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
let input='';for await(const chunk of process.stdin)input+=chunk;const p=JSON.parse(input);
if(p.capability!=='visual_planning'||!p.visualAssetPreparation?.externalInputs.length||p.visualAssetPreparation.imageGeneration)throw Error('Fixture supports only supplied reference preparation');
let blocked=false;try{await fetch('https://example.invalid/blocked');}catch{blocked=true;}if(!blocked)throw Error('Network guard missing');
if(existsSync("/Users/dan/.codex/worktrees/local-first-optimization/loop-control/.loop-control/stage-d/state/t16-20261024/planner-gate")){writeFileSync("/Users/dan/.codex/worktrees/local-first-optimization/loop-control/.loop-control/stage-d/state/t16-20261024/gate-ready-"+p.task.id,'ready',{mode:0o600});while(existsSync("/Users/dan/.codex/worktrees/local-first-optimization/loop-control/.loop-control/stage-d/state/t16-20261024/planner-gate"))await new Promise(r=>setTimeout(r,50));}
const text='# T16 controlled offline visual manifest\n\n'+p.assets.inputs.map(i=>'Supplied input: '+i.relativePath+' SHA256 '+i.sha256).join('\n')+'\nNo missing assets. Synthetic acceptance only.\n';
writeFileSync(join(p.assets.allowedRoot,p.output.relativePath),text,{flag:'wx',mode:0o600});
process.stdout.write(JSON.stringify({version:'worker-result/v1',taskId:p.task.id,status:'completed',artifacts:[{artifactType:'visual_asset_manifest',relativePath:p.output.relativePath,sha256:createHash('sha256').update(text).digest('hex'),fileSize:Buffer.byteLength(text)}],visualAssetRequests:[],validation:{passed:true,checks:[{name:'offline_supplied_inputs',passed:true,detail:'Controlled fixture used only supplied immutable inputs.'}]},actualCostCents:0,blockers:[],retry:{shouldRetry:false,reason:'Completed controlled local preparation.'},nextStep:'Owner reviews supplied visual manifest.'}));
