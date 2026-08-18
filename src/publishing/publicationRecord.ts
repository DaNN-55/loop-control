export const publicationSources = ["manual", "automated"] as const;
export type PublicationSource = (typeof publicationSources)[number];

export const publicationStatuses = ["pending", "published", "failed"] as const;
export type PublicationStatus = (typeof publicationStatuses)[number];

export interface PublicationRecordInput {
  adapter: string | null;
  episodeId: string;
  externalContentId: string;
  externalUrl: string;
  notes: string;
  platform: string;
  publishedAt: string;
  publishingAccount: string;
  source: PublicationSource;
  status: PublicationStatus;
}

interface PublicationDraft {
  episodeId: string;
  externalContentId: string;
  externalUrl: string;
  notes: string;
  platform: string;
  publishedAt: string;
  publishingAccount: string;
}

export function createManualPublicationRecord(input: PublicationDraft): PublicationRecordInput {
  return createPublicationRecord({ ...input, adapter: null, source: "manual", status: "published" });
}

export function createAutomatedPublicationRecord(adapter: string, input: PublicationDraft): PublicationRecordInput {
  return createPublicationRecord({ ...input, adapter, source: "automated", status: "published" });
}

export function createPublicationRecord(input: PublicationRecordInput): PublicationRecordInput {
  const episodeId = input.episodeId.trim();
  const platform = input.platform.trim();
  const publishingAccount = input.publishingAccount.trim();
  const externalUrl = input.externalUrl.trim();
  const externalContentId = input.externalContentId.trim();
  const publishedAt = input.publishedAt.trim();
  const notes = input.notes.trim();
  if (!episodeId) throw new Error("发布记录缺少 Episode。");
  if (!platform) throw new Error("请填写目标平台。");
  if (!publishingAccount) throw new Error("请填写发布账号或频道。");
  if (!publishedAt || Number.isNaN(Date.parse(publishedAt))) throw new Error("请填写有效的实际发布时间。");
  if (externalUrl && !/^https?:\/\/\S+$/i.test(externalUrl)) throw new Error("外部 URL 必须以 http:// 或 https:// 开头。");
  if (input.status === "published" && !externalUrl && !externalContentId) throw new Error("已发布记录至少需要外部 URL 或内容 ID。");
  if (input.source === "automated" && !input.adapter?.trim()) throw new Error("自动发布记录缺少适配器标识。");
  return {
    adapter: input.adapter?.trim() || null,
    episodeId,
    externalContentId,
    externalUrl,
    notes,
    platform,
    publishedAt: new Date(publishedAt).toISOString(),
    publishingAccount,
    source: input.source,
    status: input.status,
  };
}
