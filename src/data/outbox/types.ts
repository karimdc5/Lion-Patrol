export type OpKind = 'insert' | 'upsert' | 'update' | 'delete' | 'rpc' | 'upload';
export type OpStatus = 'pending' | 'inflight' | 'done' | 'dead';

export interface OutboxOp {
  id: string;              // idempotency key
  seq: number;             // FIFO order
  priority: number;        // 0 = SOS (first), 5 = normal
  userId: string;
  orgId: string;
  kind: OpKind;
  table?: string;
  rpc?: string;
  payload: unknown;        // row | rows | rpc args | {attachmentId, path, mime}
  match?: Record<string, string>; // for 'update'
  entityKey: string;       // e.g. patrol_incidents:<id>
  dependsOn: string[];
  label: string;           // human label for the Sync screen
  status: OpStatus;
  attempts: number;
  nextAttemptAt: number;
  lastError?: { code: string; message: string; http?: number; at: number };
  createdAt: number;
  doneAt?: number;
}
