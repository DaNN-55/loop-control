import type { WorkerBlocker } from "./reviewSelectors";

export interface WorkerBlockerGuidance {
  primaryAction?: "blueprint";
  location: string;
  locationNote: string;
  title: string;
  summary: string;
  resolution: string[];
  retryLabel: string;
  technicalDetail: string;
}

function specializedMediaBlueprintGuidance(blocker: Pick<WorkerBlocker, "detail">): WorkerBlockerGuidance {
  return {
    primaryAction: "blueprint",
    title: "媒体适配器配置不完整",
    summary: "这个媒体任务缺少 Provider、Adapter、预算或其他必填字段，需要补齐当前生产单的冻结配置。",
    resolution: [
      "点击“修改配置并继续当前生产单”，在“媒体适配器”中找到对应的 A-roll、B-roll、旁白或配乐 / 音效卡片。",
      "按卡片提示补齐 Provider、Adapter、模型、Prompt 版本，以及该能力要求的预算、并发或声音参数。",
      "如果当前系列有同名媒体规则，先在“系列”页修正它；否则直接应用到当前生产单。已完成的工作和审核记录保留，只重建受阻任务，也不会新建蓝图版本。",
    ],
    retryLabel: "修改配置并继续当前生产单",
    location: "当前生产单 → 专用媒体配置",
    locationNote: "只修改当前生产单冻结的专用执行器声明；同名系列规则存在时，系列规则优先。",
    technicalDetail: blocker.detail,
  };
}

function specializedMediaUnavailableGuidance(blocker: Pick<WorkerBlocker, "detail">): WorkerBlockerGuidance {
  return {
    title: "当前媒体能力暂不可用",
    summary: "蓝图可以声明这个适配器，但当前 Worker 尚未注册可用的媒体适配器，不是继续填写字段即可解决。",
    resolution: [
      "确认运行 Worker 的版本是否已接入对应媒体适配器，以及供应商凭据和网络是否可用。",
      "如果尚未接入，需要先完成 Worker 能力接入；仅修改蓝图字段不能替代适配器实现。",
      "适配器可用后，在当前生产单中重新排队受阻任务；已完成工作不会重复执行。",
    ],
    retryLabel: "适配器恢复后继续当前生产单",
    location: "系统能力 / Worker 适配器",
    locationNote: "当前没有可操作的页面入口。",
    technicalDetail: blocker.detail,
  };
}

function structuredPreflightGuidance(blocker: Pick<WorkerBlocker, "detail" | "action" | "check" | "status">): WorkerBlockerGuidance | undefined {
  if (blocker.check === "capability_registration") {
    return {
      title: "Worker 能力未注册",
      summary: "当前 Worker 没有注册这个能力的执行器，蓝图字段不能替代 Worker 接入。",
      resolution: ["确认 Worker 版本已安装并注册当前 Provider / Adapter。", "确认 Worker 使用的是当前运行环境，而不是另一台未更新的机器。", "能力注册完成后，重新执行当前任务。"],
      retryLabel: "能力注册后重试当前任务",
      location: "系统能力 / Worker 适配器",
      locationNote: "当前页面没有可修改的环境入口。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.check === "credential_presence") {
    return {
      title: "Worker 凭据缺失",
      summary: "Worker 环境没有发现当前 Provider 所需的凭据，蓝图不会保存或显示密钥。",
      resolution: ["在运行 Worker 的机器上配置对应 Provider 的凭据环境变量。", "重启或刷新 Worker，使它重新读取环境变量。", "凭据出现后，重新执行当前任务。"],
      retryLabel: "配置凭据后重试当前任务",
      location: "Worker 运行环境 / Provider 凭据",
      locationNote: "当前页面没有可修改的凭据入口。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.check === "credential_validity") {
    return {
      title: "Worker 凭据无效",
      summary: "Provider 已收到 Worker 请求，但拒绝了当前凭据。",
      resolution: ["在 Worker 环境中更新或更换对应 Provider 凭据。", "确认凭据属于正确的供应商账户，并具备当前能力权限。", "更新后重新执行当前任务。"],
      retryLabel: "更新凭据后重试当前任务",
      location: "Worker 运行环境 / Provider 凭据",
      locationNote: "当前页面不会展示或编辑秘密。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.check === "model_permission") {
    const retry = blocker.status === "retryable" || blocker.action === "retry";
    return {
      title: retry ? "模型权限探测暂时失败" : "模型权限不可用",
      summary: retry ? "Worker 尚未完成真实模型权限探测，当前网络或模型服务暂时没有返回结果。" : "Worker 已执行真实模型权限探测，但当前模型或账户没有可用权限。",
      resolution: retry ? ["确认模型服务网络恢复。", "等待 Worker 完成模型权限探测。", "探测恢复后重新执行当前任务。"] : ["确认 Worker 使用的模型名称与供应商账户授权一致。", "在 Worker 运行环境或供应商账户中补齐模型访问权限。", "权限恢复后重新执行当前任务。"],
      retryLabel: retry ? "模型服务恢复后重试当前任务" : "模型权限恢复后重试当前任务",
      location: "Worker 运行环境 / 模型账户",
      locationNote: "当前页面没有可修改的模型账户入口。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.check === "network_connectivity" || blocker.check === "network_request" || blocker.check === "connection") {
    const retry = blocker.action === "retry";
    return {
      title: retry ? "网络连接暂时失败" : "Worker 网络不可用",
      summary: "Worker 已执行真实网络探测，但当前网络或供应商连接未通过。",
      resolution: ["确认运行 Worker 的机器可以访问对应供应商服务。", "检查代理、防火墙、DNS 和供应商服务状态。", "网络恢复后重新执行当前任务。"],
      retryLabel: retry ? "网络恢复后重试当前任务" : "网络恢复后重试当前任务",
      location: "Worker 运行环境 / 网络连接",
      locationNote: "当前页面没有可修改的网络入口。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.check === "asset_root" || blocker.check === "media_library") {
    return {
      title: "资产目录不可用",
      summary: "Worker 无法访问或写入当前账号的资产目录，生产不能安全继续。",
      resolution: ["确认 asset_root 位于已挂载的媒体库内，并且路径使用绝对路径。", "确认运行 Worker 的账号对该目录有读写权限且剩余空间足够。", "目录恢复后重新执行当前任务。"],
      retryLabel: "目录恢复后重试当前任务",
      location: "Worker 运行环境 / 资产目录",
      locationNote: "当前页面不能替代本机挂载和文件权限配置。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.check === "command_availability") {
    return {
      title: "Worker 命令不可用",
      summary: "Worker 已注册执行路径，但本机找不到或无法调用所需命令。",
      resolution: ["确认命令已安装，并且 Worker 进程的 PATH 可以找到它。", "确认命令版本与当前 Worker 适配器兼容。", "命令恢复后重新执行当前任务。"],
      retryLabel: "命令恢复后重试当前任务",
      location: "Worker 运行环境 / 命令依赖",
      locationNote: "当前页面没有可修改的命令入口。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.action === "retry") {
    return {
      title: "Worker 外部依赖暂时失败",
      summary: "这是临时运行故障，不是蓝图配置缺失。",
      resolution: ["确认网络或供应商服务恢复。", "等待 Worker 依赖恢复后重新执行当前任务。", "如果连续失败，打开技术详情检查返回原因。"],
      retryLabel: "重试当前任务",
      location: "Worker 运行环境",
      locationNote: "无需修改蓝图配置。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.action === "edit_blueprint") {
    return {
      primaryAction: "blueprint",
      title: "蓝图能力配置需要修复",
      summary: "Worker 已识别到当前蓝图声明缺失或无效。",
      resolution: ["打开蓝图配置，修正当前能力的 Provider、Adapter、模型或工具声明。", "保存配置后修复当前受阻生产单。", "已完成工作和审核记录会保留。"],
      retryLabel: "修改配置并继续当前生产单",
      location: "账号蓝图 → 能力配置",
      locationNote: "只修复当前能力的声明，不修改 Worker 秘密。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.action === "manage_connection") {
    return {
      title: "外部连接需要更新",
      summary: "当前连接引用仍然有效，但供应商拒绝了认证材料或连接秘密已不可用。",
      resolution: ["打开外部连接管理，重新提交 Pexels API Key。", "点击测试连接，确认供应商接受新的认证材料。", "连接恢复后重新执行当前任务。"],
      retryLabel: "管理连接并重试当前任务",
      location: "外部连接管理 → Pexels",
      locationNote: "连接秘密不会写入蓝图、Episode、任务或普通日志。",
      technicalDetail: blocker.detail,
    };
  }
  if (blocker.action === "contact_environment_admin") {
    return {
      title: "Worker 运行环境暂不可用",
      summary: "问题位于 Worker 注册、凭据、权限、网络或挂载环境，不是蓝图创作字段。",
      resolution: ["确认 Worker 已注册当前能力并加载对应适配器。", "确认本机凭据、模型权限、工具权限和媒体库挂载状态。", "环境恢复后重新执行当前任务。"],
      retryLabel: "环境恢复后重试当前任务",
      location: "Worker 运行环境",
      locationNote: "当前页面没有可修改的环境入口。",
      technicalDetail: blocker.detail,
    };
  }
  return undefined;
}

export function workerBlockerGuidance(blocker: Pick<WorkerBlocker, "code" | "detail" | "action" | "check" | "status">): WorkerBlockerGuidance {
  const structured = structuredPreflightGuidance(blocker);
  if (structured) return structured;
  const normalized = `${blocker.code} ${blocker.detail}`.toLowerCase();
  const isSpecializedMedia = /a[_-]?roll|b[_-]?roll|narration|soundtrack|sound.?effect/.test(normalized);

  if (isSpecializedMedia && /retries_exhausted|重试耗尽|model.*not supported|模型.*不支持/.test(normalized)) {
    return {
      title: "媒体任务执行已重试耗尽",
      summary: "任务已按冻结配置重试到上限，通常是模型、账户权限或运行环境不支持，继续修改蓝图字段不会解决。",
      resolution: [
        "打开技术详情，确认 Worker 返回的模型、账户权限或运行环境错误。",
        "修复对应 Worker 或供应商账户后，再创建新的任务配置。",
        "不要在根因未修复前继续重试；已完成工作会保留。",
      ],
      retryLabel: "修复 Worker 或账户后重建任务",
      location: "Worker 运行环境 / 供应商账户",
      locationNote: "当前页面没有可修改的模型账户入口。",
      technicalDetail: blocker.detail,
    };
  }

  const isRegisteredCapabilityGap = /a_roll_executor_unavailable|soundtrack_executor_unavailable/.test(normalized);
  if (isSpecializedMedia && (isRegisteredCapabilityGap || /provider_unavailable|api.?key|credential|network/.test(normalized))) {
    return specializedMediaUnavailableGuidance(blocker);
  }

  if (isSpecializedMedia && /executor|adapter|budget|allowed.?tools|provider|voice|scheduling|适配器|配置|预算|声音|并发/.test(normalized)) {
    return specializedMediaBlueprintGuidance(blocker);
  }

  if (/allowed.?tools|read\s*\/\s*write|asset\.?(allowedroot|root)|asset_root/.test(normalized)) {
    return {
      title: "资产目录权限或路径配置有问题",
      summary: "Worker 无法在账号资产目录中创建必需产物，通常是允许工具或本地资产路径与任务要求不匹配。",
      resolution: [
        "在账号蓝图的“本地资产与审批”中确认资产目录和 read、write 工具。",
        "确认 asset_root 位于已挂载的媒体库内，并且 Worker 使用同一台机器和同一目录。",
        "修正本机目录后创建新的任务配置；旧任务会保留为历史记录。",
      ],
      retryLabel: "修正本机目录后重建任务",
      location: "账号蓝图 → 本地资产与审批",
      locationNote: "点击按钮后，进入对应账号蓝图的编辑入口。",
      technicalDetail: blocker.detail,
    };
  }

  if (/media_provider|provider_unavailable|api.?key|credential|network|适配器未配置/.test(normalized)) {
    return {
      title: "媒体供应商暂不可用",
      summary: "Worker 无法调用当前媒体供应商，通常是供应商适配器、凭据或网络状态问题。",
      resolution: [
        "确认本机 Worker 环境中的 API key 已填写、未过期且没有为空。",
        "确认运行 Worker 的电脑可以访问对应供应商；这不是账号蓝图里的创作字段。",
        "供应商恢复后，用新的冻结配置重新创建任务；旧任务不会自动更新。",
      ],
      retryLabel: "供应商恢复后重建任务",
      location: "Worker 运行环境 / 供应商凭据",
      locationNote: "当前页面没有可修改的凭据入口，由本机 Worker 配置维护。",
      technicalDetail: blocker.detail,
    };
  }

  if (/budget|预算/.test(normalized)) {
    return {
      title: "任务预算不足或配置无效",
      summary: "当前任务的单项预算、总预算或剩余预算无法满足执行要求。",
      resolution: [
        "在账号蓝图的“阶段预算”中检查对应阶段的预算上限。",
        "确认已失败或被替换的任务没有继续占用旧预算。",
        "修正后创建新的任务配置；系统会释放旧预算并保留历史记录。",
      ],
      retryLabel: "调整预算后重建任务",
      location: "账号蓝图 → 阶段预算",
      locationNote: "需要实际计费的任务不能使用 0 分预算。",
      technicalDetail: blocker.detail,
    };
  }

  if (/executor|adapter/.test(normalized)) {
    return {
      primaryAction: "blueprint",
      title: "Worker 执行器配置不完整",
      summary: "任务没有可用的通用执行器，Worker 不会自行替换供应商继续执行。",
      resolution: [
        "点击“修改配置并继续当前生产单”，检查当前任务的 Provider、模型和 Prompt 版本。",
        "只有系统已登记或支持的执行器才能使用；不要随意填写未知 adapter。",
        "直接应用到当前生产单；已完成任务不会重跑，也不会新建蓝图版本。",
      ],
      retryLabel: "修正执行器并继续当前生产单",
      location: "当前生产单 → 执行器配置",
      locationNote: "这里只修改当前生产单的通用脚本、视觉或分镜执行器。",
      technicalDetail: blocker.detail,
    };
  }

  if (/input|artifact|asset|missing|缺少|冻结输入|前置产物/.test(normalized)) {
    return {
      title: "缺少任务要求的前置产物",
      summary: "Worker 找不到任务冻结时要求的输入文件、产物索引或哈希一致的修订。",
      resolution: [
        "回到当前生产单的材料或产物区域，确认必需文件已经导入并通过审核。",
        "检查产物索引中的相对路径、文件大小和 SHA-256 是否与本地文件一致。",
        "修正输入后创建新的任务或新的生产修订，不要直接重试旧任务。",
      ],
      retryLabel: "补齐前置产物后创建新的任务",
      location: "当前生产单 → 材料 / 产物预览",
      locationNote: "先补齐或审核前置产物，再重新创建任务。",
      technicalDetail: blocker.detail,
    };
  }

  if (/query|search|检索词/.test(normalized)) {
    return {
      title: "媒体检索词不符合要求",
      summary: "冻结的媒体检索词为空、过长或不符合供应商的格式限制。",
      resolution: [
        "回到当前生产单的分镜或审核包，查看目标镜头和冻结检索词。",
        "使用简短、可被供应商理解的关键词重新生成分镜或媒体配置。",
        "用新的检索词创建新的任务，不直接重试旧任务。",
      ],
      retryLabel: "修正检索词后创建新的任务",
      location: "当前生产单 → 分镜审核包",
      locationNote: "检索词来自已冻结的分镜内容，不在阻塞项里直接修改。",
      technicalDetail: blocker.detail,
    };
  }

  if (/lease|租约/.test(normalized)) {
    return {
      title: "Worker 执行租约已过期",
      summary: "任务在 Worker 报告结果前失去了执行租约，系统需要先确认 Worker 是否恢复。",
      resolution: [
        "确认 Worker 进程仍在运行，且外置媒体库可以访问。",
        "等待系统回收过期租约并将任务恢复为可领取状态。",
        "确认没有重复 Worker 同时领取同一任务后再重试。",
      ],
      retryLabel: "确认 Worker 恢复后可以重试",
      location: "Worker 运行状态",
      locationNote: "这类问题通常不需要修改蓝图。",
      technicalDetail: blocker.detail,
    };
  }

  return {
    title: "Worker 任务需要人工处理",
    summary: "Worker 无法继续执行当前冻结任务，必须先确认配置、输入或外部依赖。",
    resolution: [
      "打开技术详情，确认任务类型、执行器、输入产物和错误原因。",
      "根据原因修正账号蓝图、系列规则、本地素材或外部服务配置。",
      "修正后创建新的任务配置，不要在原因未解决时重复点击重试。",
    ],
    retryLabel: "先修正原因，再继续当前生产单",
    location: "技术详情 / Worker 运行环境",
    locationNote: "当前没有足够信息提供自动跳转入口。",
    technicalDetail: blocker.detail,
  };
}
