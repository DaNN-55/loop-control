import { createAutomatedPublicationRecord, type PublicationRecordInput } from "./publicationRecord";

export interface PublicationAdapterInput {
  episodeId: string;
  externalContentId: string;
  externalUrl: string;
  notes: string;
  platform: string;
  publishedAt: string;
  publishingAccount: string;
}

export interface AutomatedPublicationAdapter {
  readonly adapterId: string;
  publish(input: PublicationAdapterInput): Promise<PublicationRecordInput>;
}

export type PublicationRecordWriter = (input: PublicationRecordInput) => Promise<unknown>;

export function automatedPublicationResult(adapterId: string, input: PublicationAdapterInput): PublicationRecordInput {
  return createAutomatedPublicationRecord(adapterId, input);
}
