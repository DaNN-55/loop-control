export const workbookMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const workbookLimit=6*1024*1024;
export const orderColumns=['生产单编号','标题','脚本正文','目标时长'] as const;
export const shotColumns=['生产单编号','镜头序号','画面描述','视频提示词','口播','字幕','镜头时长'] as const;

export interface WorkbookOrder {
 row:number;
 itemId:string;
 orderNo:string;
 title:string;
 sourceText:string;
 duration:string;
 seriesName:string;
}
export interface WorkbookShot {
 row:number;
 orderNo:string;
 sequence:string;
 visual:string;
 videoPrompt:string;
 narration:string;
 caption:string;
 duration:string;
}
export interface WorkbookPreview {
 name:string;
 orders:WorkbookOrder[];
 shots:WorkbookShot[];
}
