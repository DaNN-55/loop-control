// Synthetic fixtures only. No production API or log collection.
export type MockLog={operationId:string;time:string;level:'INFO'|'WARN'|'ERROR';episode:string;source:string;message:string;data:Record<string,string|number|boolean>};
export type LogDescription={location:string;message:string;result?:string;reason?:string;impact?:string;action?:string};
export const logs: MockLog[]=[
{operationId:'OP-001',time:'10:20:01.120',level:'INFO',episode:'EP-001',source:'createLocalHandler',message:'收到主脚本上传请求',data:{requestId:'REQ-001',command:'importMaterial',sourcePath:'主脚本.md',materialType:'script',materialPurpose:'main_script',mimeType:'text/markdown',isMainScript:true,scriptCharacters:26,authorization:'[未记录]',scriptContent:'[未记录]'}},
{operationId:'OP-001',time:'10:20:01.128',level:'INFO',episode:'EP-001',source:'snapshotInput',message:'脚本内容校验通过',data:{requestId:'REQ-001',sourcePath:'主脚本.md',mimeType:'text/markdown',fileSize:52}},
{operationId:'OP-001',time:'10:20:01.177',level:'INFO',episode:'EP-001',source:'snapshotInput',message:'主脚本快照已保存',data:{requestId:'REQ-001',sourcePath:'主脚本.md',storagePath:'materials/9c4f2a10-主脚本.md',sha256:'9c4f2a10b6e8d39708a71f42b0d635ea9b51d087f4a18c2de63278b7a8315f20',fileSize:52}},
{operationId:'OP-001',time:'10:20:01.192',level:'INFO',episode:'EP-001',source:'executeCommand',message:'主脚本材料登记成功',data:{requestId:'REQ-001',command:'importMaterial',materialRevisionId:'MAT-001',isMainScript:true}},
{operationId:'OP-002',time:'10:20:02.015',level:'INFO',episode:'EP-001',source:'createLocalHandler',message:'收到生产单启动请求',data:{requestId:'REQ-002',command:'start',episodeId:'EP-001'}},
{operationId:'OP-002',time:'10:20:02.033',level:'INFO',episode:'EP-001',source:'verifyEpisodeFile',message:'已核对主脚本文件，指纹和大小一致',data:{requestId:'REQ-002',materialRevisionId:'MAT-001',sourcePath:'主脚本.md',fileSize:52,verified:true}},
{operationId:'OP-002',time:'10:20:02.080',level:'INFO',episode:'EP-001',source:'executeCommand',message:'生产单启动事务已提交',data:{requestId:'REQ-002',command:'start',mainScriptRevisionId:'MAT-001',receiptSaved:true,transaction:'committed'}},
{operationId:'OP-002',time:'10:20:02.081',level:'INFO',episode:'EP-001',source:'scheduler.wake',message:'已通知后台调度器处理本期任务',data:{requestId:'REQ-002',episodeId:'EP-001',event:'scheduler_wake_requested',taskId:'TASK-001'}},
{operationId:'OP-003',time:'10:21:04.002',level:'INFO',episode:'EP-002',source:'createLocalHandler',message:'收到主脚本上传请求',data:{requestId:'REQ-003',command:'importMaterial',sourcePath:'雨巷清晨.md',materialType:'script',isMainScript:true}},
{operationId:'OP-003',time:'10:21:04.010',level:'ERROR',episode:'EP-002',source:'snapshotInput',message:'主脚本内容校验失败，上传未完成',data:{requestId:'REQ-003',sourcePath:'雨巷清晨.md',error:'模拟：脚本正文为空',errorCode:'DEMO_EMPTY_SCRIPT',httpStatus:400}},
{operationId:'OP-002',time:'10:20:02.130',level:'INFO',episode:'EP-001',source:'worker.run',message:'后台任务开始处理主脚本',data:{requestId:'REQ-WORKER-001',taskId:'TASK-001',attempt:1,materialRevisionId:'MAT-001',stage:'started'}}
];
export const names: Record<string,string>={'EP-001':'日照金山','EP-002':'雨巷清晨'};
export const levelNames: Record<string,string>={INFO:'记录',WARN:'提醒',ERROR:'错误'};
export const descriptions: LogDescription[]=[
{location:'上传入口',message:'收到主脚本.md，开始处理上传请求',result:'上传请求已收到，保存结果请看后续日志。'},
{location:'内容检查',message:'主脚本.md 内容校验通过',result:'脚本内容通过检查，文件保存结果请看后续日志。'},
{location:'文件保存',message:'主脚本.md 已保存，文件校验通过',result:'本次脚本文件保存完成。'},
{location:'材料登记',message:'主脚本.md 已登记为本期主脚本',result:'主脚本上传登记完成，可以继续启动本期制作。'},
{location:'制作启动',message:'收到启动请求，开始检查制作条件',result:'启动请求已收到，正在检查本期材料。'},
{location:'文件核对',message:'主脚本.md 与保存记录一致，文件可用',result:'文件内容和大小与保存时一致，核对通过。'},
{location:'制作启动',message:'本期启动结果已保存',result:'启动记录已保存，后台处理结果请看后续日志。'},
{location:'后台调度',message:'已通知后台处理本期，后续结果待记录',result:'后台处理通知已发出；是否生成成功，仍需查看后续结果。'},
{location:'上传入口',message:'收到雨巷清晨.md，开始处理上传请求',result:'上传请求已收到，保存结果请看后续日志。'},
{location:'内容检查',message:'雨巷清晨.md 上传失败：正文为空',reason:'脚本正文为空。',impact:'本次主脚本上传未完成，尚未继续启动制作。',action:'填写脚本正文后，重新上传。'},
{location:'后台处理',message:'后台已开始处理主脚本，尚无完成结果',result:'只确认后台任务已开始；当前示例没有制作完成或失败的记录。'}
];

export const operationNames: Record<string,string>={'OP-001':'上传主脚本','OP-002':'启动生产单','OP-003':'上传主脚本'};
// Preview policy only. No disk storage, actual expiry jobs or production retention.
export const retention={days:14,capacityGB:1,asOf:'2026-11-11',earliestDate:'2026-10-28',expiredDate:'2026-10-22'} as const;
