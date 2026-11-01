# 百炼兼容首帧视频模型协议核查

2026-11-01。只读官方文档研究；未读取Key或调用生成接口。当前应用北京凭据，保留既有720P／1080P界面，本轮实现7个旧img_url模型。

| 模型 | 本轮分辨率 | 时长（秒） | 声音 |
| --- | --- | --- | --- |
| wan2.6-i2v-flash | 720P、1080P | 整数2～15 | 可选择；audio可为false |
| wan2.6-i2v | 720P、1080P | 整数2～15 | 固定有声，不发送audio字段 |
| wan2.5-i2v-preview | 720P、1080P | 5、10 | 固定有声，不发送audio字段 |
| wan2.2-i2v-flash | 720P、1080P | 固定5，省略duration | 无声 |
| wan2.2-i2v-plus | 1080P | 固定5，省略duration | 无声 |
| wanx2.1-i2v-plus | 720P | 固定5，省略duration | 无声 |
| wanx2.1-i2v-turbo | 720P | 3、4、5 | 无声 |

七款均走 `POST /api/v1/services/aigc/video-generation/video-synthesis`，`X-DashScope-Async: enable`，`input.img_url`＋prompt；查询 `GET /api/v1/tasks/{id}`。均支持negative_prompt≤500字符、prompt_extend、watermark、seed整数0～2147483647。只有2.6两款支持shot_type，并且只在prompt_extend=true时生效。audio布尔字段只支持2.6 Flash，其他有声模型自动配声，不能假装关闭声音。依据：[旧首帧API官方文档](https://help.aliyun.com/zh/model-studio/legacy-image-to-video-api-reference)。

旧协议首帧宽高均240～8000px，JPEG／PNG无透明／BMP／WEBP；2.5／2.6上限20MB，2.2／2.1上限10MB。当前应用首帧构图按画布输出并转为RGB；文件大小、MIME及模型限制仍在提交前检查。旧协议没有声明1:8～8:1输入比例限制，未移植新版限制。依据：[首帧指南](https://help.aliyun.com/zh/model-studio/image-to-video-guide)。

2.7／3.0虽路径相同，要求新版input.media协议，不属于本轮兼容旧payload的模型；文生视频、参考视频、首尾帧、编辑模型也不能仅替换model字段。未适配项显示具体原因，不自动启用。依据：[2.7 API](https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference)、[3.0 API](https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference)。

价格按模型、分辨率、音频和地域变化；任务usage计费时长不是实际扣费金额。新明确制作提交使用Owner费用预留，不复用Flash历史每秒15分假设。历史任务沿用冻结输入与原预算规则，不改写。依据：[官方价格](https://help.aliyun.com/zh/model-studio/model-pricing)。

地域范围：现有凭据解析仅北京；北京2.1 ID为wanx2.1-*，新加坡部分ID为wan2.1-*，不能当作通用别名。接口表与新加坡2.2 Flash价格表存在1080P列差异，未宣称跨地域完整支持。目录中的新ID仍须匹配已核实协议契约，不能仅按名称或VG标签执行。
