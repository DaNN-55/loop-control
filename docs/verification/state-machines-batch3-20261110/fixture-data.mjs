import media from './media.json' with {type:'json'};
export const scenarios=['no-export','checks-failed','blocked','await-confirmation','confirmed','outdated','stale','delivery-ready','delivery-running','delivery-failed','delivery-unverified','verified-history','historical-and-latest-failed'];
export function scenario(name){
 const source={id:'current-export',projectContentVersion:7,contentSha256:'c'.repeat(64),status:'ready',current:true,confirmed:false,confirmedAt:null,artifact:{relativePath:'exports/current.mp4',...media['fixture.mp4']},checks:[{name:'technical',passed:true,detail:'隔离 MP4 检查通过'}]};
 const w={id:'stage3-workspace',episodeId:'stage3-fixture',revision:7,contentSha256:'c'.repeat(64),stale:false,project:{sha256:'a'.repeat(64)},readiness:{placeholders:[],missingSources:[]},exports:[source],exportIssues:[],deliveries:[]};
 const record=status=>({id:'latest-delivery',exportId:source.id,taskId:'delivery-task',status,verified:false,error:status==='failed'?'隔离交付失败':null,artifacts:[],createdAt:'2026-11-10T10:00:00Z'});
 const history={...record('completed'),id:'verified-history',exportId:'old-export',verified:true,artifacts:[{artifactType:'final_render',relativePath:'delivery/history-final.mp4',...media['fixture.mp4']},{artifactType:'cover',relativePath:'delivery/cover.png',...media['cover.png']}]};
 if(name==='no-export')w.exports=[];
 if(name==='checks-failed'){source.status='failed';source.artifact=null;source.checks=[{name:'decode',passed:false,detail:'请处理未通过的检查'}];}
 if(name==='blocked')w.exportIssues=[{id:'issue',exportId:source.id,reason:'需要调整画面',resolved:false}];
 if(['confirmed','outdated','stale','delivery-ready','delivery-running','delivery-failed','delivery-unverified','verified-history','historical-and-latest-failed'].includes(name))source.confirmed=true;
 if(name==='outdated'||name==='verified-history'){source.current=false;source.artifact.relativePath='exports/old.mp4';}
 if(name==='stale')w.stale=true;
 if(name==='delivery-ready')w.deliveries=[record('ready')];
 if(name==='delivery-running')w.deliveries=[record('running')];
 if(name==='delivery-failed')w.deliveries=[record('failed')];
 if(name==='delivery-unverified')w.deliveries=[record('completed')];
 if(name==='verified-history')w.deliveries=[history];
 if(name==='historical-and-latest-failed')w.deliveries=[record('failed'),history];
 return w;
}
