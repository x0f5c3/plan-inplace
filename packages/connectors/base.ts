import { PlanConfig, PlanMetadata, Task } from '@packages/types/shared';

export type ConnectorSyncStatus = 'idle' | 'success' | 'error';

export interface ConnectorConfig {
  [key: string]: unknown;
}

export interface ConnectorConfigEntry {
  id: string;
  enabled: boolean;
  config: ConnectorConfig;
  lastSyncAt?: string;
  lastSyncStatus?: ConnectorSyncStatus;
  lastSyncMessage?: string;
}

export interface SyncPayload {
  planId: string;
  metadata: PlanMetadata;
  config: PlanConfig;
  tasks: Task[];
  timestamp: string;
}

export interface SyncResult {
  success: boolean;
  message?: string;
  tasks?: Task[];
}

export interface Connector {
  id: string;
  name: string;
  description: string;

  isConfigured(): boolean;
  configure(config: ConnectorConfig): Promise<void>;

  onTasksSaved?(tasks: Task[], metadata: PlanMetadata, config: PlanConfig): Promise<void>;
  onTasksLoaded?(tasks: Task[], metadata: PlanMetadata, config: PlanConfig): Promise<Task[] | null>;
  onPlanCreated?(metadata: PlanMetadata): Promise<void>;
  onPlanDeleted?(planId: string): Promise<void>;

  push(data: SyncPayload): Promise<SyncResult>;
  pull(planId: string): Promise<SyncPayload | null>;
  test(): Promise<{ ok: boolean; message?: string }>;
}

export interface ConnectorState extends ConnectorConfigEntry {
  name: string;
  description: string;
}
