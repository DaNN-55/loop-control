export function formatFileSize(bytes:number|string){const value=Number(bytes);return value>=1024**3?`${(value/1024**3).toFixed(2)} GB`:value>=1024**2?`${(value/1024**2).toFixed(1)} MB`:value>=1024?`${(value/1024).toFixed(1)} KB`:`${value.toLocaleString()} 字节`;}

export function formatStorageSize(bytes:number,locale:string){
 const unit=bytes>=1e9?'gigabyte':bytes>=1e6?'megabyte':bytes>=1e3?'kilobyte':'byte';
 const divisor={gigabyte:1e9,megabyte:1e6,kilobyte:1e3,byte:1}[unit];
 return new Intl.NumberFormat(locale,{style:'unit',unit,maximumFractionDigits:2}).format(bytes/divisor);
}
