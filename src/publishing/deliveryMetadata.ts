/** Store tag text without its display prefix; keep meaningful internal hashes. */
export function normalizeDeliveryTags(tags:readonly string[]):string[]{return tags.map(tag=>tag.trim().replace(/^(?:[#＃]\s*)+/u,'').trim());}
export function deliveryTagsError(tags:readonly string[]):string{
 if(tags.length>20)return '标签最多 20 个，请减少后重试。';
 if(tags.some(tag=>!tag))return '标签不能为空，请删除单独的井号或填写标签正文。';
 if(tags.some(tag=>tag.length>50))return '每个标签最多 50 个字符，请缩短后重试。';
 return '';
}
