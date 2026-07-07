import type { DocumentBlock } from '../../types';

export type OutboxAction =
  | { type: 'add_vocab'; payload: Record<string, unknown> }
  | { type: 'review'; payload: { eventId: string; vocabId: number; grade: string; responseTimeMs?: number; reviewedAt: string } };

export interface OutboxStatus {
  pending: number;
  retrying: number;
  dead: number;
}

export interface OutboxStore {
  enqueue(action: OutboxAction, id?: string): Promise<string>;
  sync(): Promise<{ synced: number; failed: number }>;
  status(): Promise<OutboxStatus>;
}

export interface PaperSnapshotStore {
  download(paperId: string, onProgress?: (step: string) => void): Promise<boolean>;
  blocks(paperId: string): Promise<DocumentBlock[] | null>;
  contentVersion(paperId: string): Promise<number | null>;
}
