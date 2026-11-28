# DeepSeek Harness → Loop Control 商品视频交接 v1

同一台 Mac 使用。策稿交付用户确认过的 v3 脚本和商品图；Loop Control 独立接单、制作、剪辑、验收和落盘。此协议的 `v1` 与脚本模板的 `v3` 分别演进。原自由正文草案不是可导入的生产格式，本接收器不接受或静默转换该草案。

## 目录与权限

```text
handoff/
  in/<handoff_id>/v0001/
    manifest.json
    script.md
    images/front.jpg
  out/<handoff_id>/v0001/
    result.json
    exports/final.mp4
```

使用同机当前用户拥有的私有绝对真实目录（建议 `0700`，不放在不可信父目录或同步盘内）。策稿只写 `in/`，Loop Control 是 `out/` 的唯一写方，Harness 只读结果。两程序不交换数据库或 Keychain 凭据；共享目录不是同一操作系统用户下的应用隔离机制。首版每个根目录只跑一个 Loop Control 写方。

## 输入

`manifest.json` 是 UTF-8 JSON，最大 64 KiB：

| 字段 | 规则 |
|---|---|
| `schema` | `loop-control-handoff/v1` |
| `handoff_id` | 一个视频选题一个稳定编号，最多 80 字符，小写英文、数字和单个短横线分隔；与目录名一致。 |
| `revision` | 1–9999 的整数，与 `vNNNN` 一致。修订不可覆写。 |
| `product_id`、`title` | 非空文本，最多 200 字符。 |
| `product_images` | 1–12 项 `images/<文件名>`，只接受 PNG/JPEG，单图 10 MiB、总计 30 MiB。无子目录或符号链接；文件名按 Unicode 规范化、不分大小写判断是否重复。 |

`script.md` 是原样可导入 Loop Control 的 UTF-8 v3 结构化脚本，最大 256 KiB，不含交接 YAML。商品事实可放允许的制作约束字段，不能自动写入口播。素材名写文件名，不写路径。接单时商品图登记为参考图，图片是否采用由 Loop Control 的操作决定。作者在同一文件系统的临时目录写齐整个包，再原子发布正式修订；接收器不扫描临时目录。

## 接单

Loop Control 收到包后校验并持久记录内容摘要。Owner 在 Loop Control 核对账号、可选系列，以及脚本中明确写出的画幅和时长后接单。未指定的继续按现有制作设置处理；要改已审核 v3 正文，回上游发布新修订。接单不会启动制作或授权付费生成。

同编号同修订同摘要重放复用原接单凭据；并发和中断恢复不能创建第二张生产单。不同摘要不覆盖原单；新修订经 Owner 确认后单独建单，旧脚本、工程、成片保留。

## 回写与成片

Loop Control 原子替换 `result.json`。`schema` 为 `loop-control-handoff-result/v1`，包括 `handoff_id`、`revision`、`status`、`updated_at`、`message`、可选 `reason_code`、`production_order`、`outputs`、`metrics`。

- `received`：已接收，可能还未建单；`production_order` 在建单前为 `null`，建单后含 `id` 和本机控制台 `url`。
- `producing`：生产中，未交付；`needs_attention`：等待确认、修正或排查；`failed`：正式交付失败，应去 Loop Control 检查。
- `delivered`：经过正式交付校验，并已复制同一份 MP4；`outputs.video` 固定为 `exports/final.mp4`，另附 `video_sha256` 和 `video_file_size`。**已交付不代表已发布。** 无可核对的费用或时长时使用 `null`，不得从报价臆测实扣。

## 隔离试用

Loop Control 仅在显式为本次运行传入 `LOOP_HARNESS_HANDOFF_ROOT` 与 `LOOP_HARNESS_HANDOFF_OWNER_ID` 且启用现有本机 Worker 时启动接收器。两个 Harness bundle 配置同一交接根，生产入口 bundle 还需配置隔离 Loop Control 的本机 origin。不要把测试变量、测试账户或交接根写进日常部署。停用两端入口不会删包或改变已接单生产单。
