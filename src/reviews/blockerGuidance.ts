import type { WorkerBlocker } from "./reviewSelectors";

export interface WorkerBlockerGuidance {
  title: string;
  summary: string;
  resolution: string[];
  retryLabel: string;
  technicalDetail: string;
}

export function workerBlockerGuidance(blocker: Pick<WorkerBlocker, "code" | "detail">): WorkerBlockerGuidance {
  const normalized = `${blocker.code} ${blocker.detail}`.toLowerCase();

  if (/allowed.?tools|read\s*\/\s*write|asset\.?(allowedroot|root)|asset_root/.test(normalized)) {
    return {
      title: "资产目录权限或路径配置有问题",
      summary: "Worker 无法在账号资产目录中创建必需产物，通常是允许工具或本地资产路径与任务要求不匹配。",
      resolution: [
        "在账号蓝图或系列规则中确认任务需要的 read、write 工具已启用。",
        "确认 asset_root 位于已挂载的媒体库内，并且 Worker 使用同一台机器和同一目录。",
        "修正配置后创建新的任务配置；旧任务已经冻结，不能直接复用。",
      ],
      retryLabel: "修正配置后创建新的任务",
      technicalDetail: blocker.detail,
    };
  }

  if (/media_provider|provider_unavailable|api.?key|credential|network|适配器未配置/.test(normalized)) {
    return {
      title: "媒体供应商暂不可用",
      summary: "Worker 无法调用当前媒体供应商，可能是供应商适配器、凭据或网络配置问题。",
      resolution: [
        "确认任务使用的供应商和适配器已在蓝图或系列规则中声明。",
        "确认对应 API key 已写入本机 Worker 环境，并且没有过期或为空。",
        "确认网络可访问供应商；修正后创建新的任务配置。",
      ],
      retryLabel: "修正供应商配置后创建新的任务",
      technicalDetail: blocker.detail,
    };
  }

  if (/executor|adapter/.test(normalized)) {
    return {
      title: "Worker 执行器配置不完整",
      summary: "任务没有可用的执行器或适配器，Worker 不会自行替换供应商继续执行。",
      resolution: [
        "检查 provider、model、prompt_version 和 adapter 是否都已填写。",
        "确认该执行器与当前镜头或媒体类型兼容。",
        "修正蓝图或系列规则后创建新的任务配置。",
      ],
      retryLabel: "修正执行器后创建新的任务",
      technicalDetail: blocker.detail,
    };
  }

  if (/budget|预算/.test(normalized)) {
    return {
      title: "任务预算不足或配置无效",
      summary: "当前任务的单项预算、总预算或剩余预算无法满足执行要求。",
      resolution: [
        "检查账号蓝图或系列规则中的单项预算和总预算。",
        "确认已失败或被替换的任务没有继续占用旧预算。",
        "调整预算后创建新的任务配置，不要直接重试旧任务。",
      ],
      retryLabel: "调整预算后创建新的任务",
      technicalDetail: blocker.detail,
    };
  }

  if (/input|artifact|asset|missing|缺少|冻结输入|前置产物/.test(normalized)) {
    return {
      title: "缺少任务要求的前置产物",
      summary: "Worker 找不到任务冻结时要求的输入文件、产物索引或哈希一致的修订。",
      resolution: [
        "先回到上一个审核阶段，确认必需产物已经生成并通过审核。",
        "检查产物索引中的相对路径、文件大小和 SHA-256 是否与本地文件一致。",
        "修正输入后创建新的任务或新的生产修订。",
      ],
      retryLabel: "补齐前置产物后创建新的任务",
      technicalDetail: blocker.detail,
    };
  }

  if (/query|search|检索词/.test(normalized)) {
    return {
      title: "媒体检索词不符合要求",
      summary: "冻结的媒体检索词为空、过长或不符合供应商的格式限制。",
      resolution: [
        "查看技术详情中的冻结检索词和目标镜头。",
        "使用简短、可被供应商理解的关键词重新生成分镜或媒体配置。",
        "用新的检索词创建新的任务，不直接重试旧任务。",
      ],
      retryLabel: "修正检索词后创建新的任务",
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
      technicalDetail: blocker.detail,
    };
  }

  return {
    title: "Worker 任务需要人工处理",
    summary: "Worker 无法继续执行当前冻结任务，必须先确认配置、输入或外部依赖。",
    resolution: [
      "打开技术详情，确认任务类型、执行器、输入产物和错误原因。",
      "修正账号蓝图、系列规则、本地素材或外部服务配置。",
      "修正后创建新的任务配置，不要在原因未解决时重复点击重试。",
    ],
    retryLabel: "修正原因后创建新的任务",
    technicalDetail: blocker.detail,
  };
}
