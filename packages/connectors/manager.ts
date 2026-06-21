import { PlanConfig, PlanMetadata, Task } from '@packages/types/shared';
import { Connector, ConnectorConfig, ConnectorConfigEntry, ConnectorState, SyncPayload } from './base';

export class ConnectorManager {
  private registry = new Map<string, Connector>();
  private state = new Map<string, ConnectorConfigEntry>();

  register(connector: Connector) {
    this.registry.set(connector.id, connector);
    if (!this.state.has(connector.id)) {
      this.state.set(connector.id, {
        id: connector.id,
        enabled: false,
        config: {},
        lastSyncStatus: 'idle'
      });
    }
  }

  unregister(id: string) {
    this.registry.delete(id);
    this.state.delete(id);
  }

  getAll(): ConnectorState[] {
    return Array.from(this.registry.values()).map((connector) => {
      const current = this.state.get(connector.id) ?? {
        id: connector.id,
        enabled: false,
        config: {},
        lastSyncStatus: 'idle' as const
      };
      return {
        ...current,
        name: connector.name,
        description: connector.description
      };
    });
  }

  hydrate(entries?: ConnectorConfigEntry[]) {
    if (!entries) return;
    for (const entry of entries) {
      if (this.registry.has(entry.id)) {
        this.state.set(entry.id, {
          id: entry.id,
          enabled: !!entry.enabled,
          config: entry.config || {},
          lastSyncAt: entry.lastSyncAt,
          lastSyncStatus: entry.lastSyncStatus || 'idle',
          lastSyncMessage: entry.lastSyncMessage
        });
      }
    }
  }

  exportConfig(): ConnectorConfigEntry[] {
    return this.getAll().map(({ id, enabled, config, lastSyncAt, lastSyncStatus, lastSyncMessage }) => ({
      id,
      enabled,
      config,
      lastSyncAt,
      lastSyncStatus,
      lastSyncMessage
    }));
  }

  setEnabled(id: string, enabled: boolean) {
    const current = this.state.get(id);
    if (!current) return;
    this.state.set(id, { ...current, enabled });
  }

  setConfig(id: string, config: ConnectorConfig) {
    const current = this.state.get(id);
    if (!current) return;
    this.state.set(id, { ...current, config });
  }

  async test(id: string): Promise<{ ok: boolean; message?: string }> {
    const connector = this.registry.get(id);
    const state = this.state.get(id);
    if (!connector || !state) {
      return { ok: false, message: 'Connector not found' };
    }

    await connector.configure(state.config || {});
    return connector.test();
  }

  async onPlanCreated(metadata: PlanMetadata) {
    await this.runOnEnabled(async (connector) => connector.onPlanCreated?.(metadata));
  }

  async onPlanDeleted(planId: string) {
    await this.runOnEnabled(async (connector) => connector.onPlanDeleted?.(planId));
  }

  async onTasksSaved(tasks: Task[], metadata: PlanMetadata, config: PlanConfig) {
    await this.runOnEnabled(async (connector, state) => {
      await connector.configure(state.config || {});
      const payload: SyncPayload = {
        planId: metadata.id,
        metadata,
        config,
        tasks,
        timestamp: new Date().toISOString()
      };

      if (connector.onTasksSaved) {
        await connector.onTasksSaved(tasks, metadata, config);
      } else {
        await connector.push(payload);
      }
      this.markStatus(connector.id, 'success');
    });
  }

  async onTasksLoaded(tasks: Task[], metadata: PlanMetadata, config: PlanConfig): Promise<Task[] | null> {
    let mergedTasks: Task[] | null = null;

    await this.runOnEnabled(async (connector, state) => {
      await connector.configure(state.config || {});
      const result = connector.onTasksLoaded
        ? await connector.onTasksLoaded(mergedTasks ?? tasks, metadata, config)
        : null;

      if (result) {
        mergedTasks = result;
      }
      this.markStatus(connector.id, 'success');
    });

    return mergedTasks;
  }

  private async runOnEnabled(
    fn: (connector: Connector, state: ConnectorConfigEntry) => Promise<void>
  ) {
    for (const connector of this.registry.values()) {
      const state = this.state.get(connector.id);
      if (!state?.enabled) continue;
      const hasConfig = Object.keys(state.config || {}).length > 0;
      // Skip only when the connector reports not configured and there is no saved configuration to apply.
      if (!connector.isConfigured() && !hasConfig) continue;

      try {
        await fn(connector, state);
      } catch (error) {
        this.markStatus(
          connector.id,
          'error',
          error instanceof Error ? error.message : 'Sync failed'
        );
      }
    }
  }

  private markStatus(id: string, status: 'success' | 'error', message?: string) {
    const current = this.state.get(id);
    if (!current) return;

    this.state.set(id, {
      ...current,
      lastSyncStatus: status,
      lastSyncAt: new Date().toISOString(),
      lastSyncMessage: message
    });
  }
}
