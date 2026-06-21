import { Connector, ConnectorConfig, SyncPayload, SyncResult } from '../base';

interface GrpcConnectorConfig extends ConnectorConfig {
  endpoint?: string;
  servicePath?: string;
  authToken?: string;
}

export class GrpcConnector implements Connector {
  id = 'grpc';
  name = 'gRPC (gateway)';
  description = 'Sync through a gRPC-web compatible gateway endpoint.';

  private config: GrpcConnectorConfig = {};

  isConfigured(): boolean {
    return !!this.config.endpoint;
  }

  async configure(config: ConnectorConfig): Promise<void> {
    this.config = config as GrpcConnectorConfig;
  }

  async push(data: SyncPayload): Promise<SyncResult> {
    if (!this.config.endpoint) return { success: false, message: 'Endpoint is required' };

    const response = await fetch(this.getUrl('PushTasks'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ plan: data })
    });

    if (!response.ok) {
      return { success: false, message: `HTTP ${response.status}` };
    }

    return { success: true };
  }

  async pull(planId: string): Promise<SyncPayload | null> {
    if (!this.config.endpoint) return null;

    const response = await fetch(this.getUrl('PullTasks'), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ planId })
    });

    if (!response.ok) return null;

    const payload = await response.json();
    return payload?.plan || null;
  }

  async test() {
    if (!this.config.endpoint) {
      return { ok: false, message: 'Endpoint is required' };
    }

    try {
      const response = await fetch(this.getUrl('Health'), {
        method: 'GET',
        headers: this.getHeaders()
      });
      return { ok: response.ok, message: response.ok ? 'Connected' : `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Connection failed' };
    }
  }

  private getUrl(method: string) {
    const base = this.config.endpoint!.replace(/\/$/, '');
    const servicePath = this.config.servicePath || 'PlanService';
    return `${base}/${servicePath}/${method}`;
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-protocol': 'grpc-web'
    };

    if (this.config.authToken) {
      headers.Authorization = this.config.authToken;
    }

    return headers;
  }
}
