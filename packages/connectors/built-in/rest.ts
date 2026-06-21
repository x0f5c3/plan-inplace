import { Connector, ConnectorConfig, SyncPayload, SyncResult } from '../base';

interface RestConnectorConfig extends ConnectorConfig {
  endpoint?: string;
  authToken?: string;
  authHeader?: string;
}

export class RestConnector implements Connector {
  id = 'rest';
  name = 'REST API';
  description = 'Sync plan data with a REST endpoint.';

  private config: RestConnectorConfig = {};

  isConfigured(): boolean {
    return !!this.config.endpoint;
  }

  async configure(config: ConnectorConfig): Promise<void> {
    this.config = config as RestConnectorConfig;
  }

  async push(data: SyncPayload): Promise<SyncResult> {
    if (!this.config.endpoint) return { success: false, message: 'Endpoint is required' };

    const response = await fetch(this.config.endpoint, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      return { success: false, message: `HTTP ${response.status}` };
    }

    return { success: true };
  }

  async pull(planId: string) {
    if (!this.config.endpoint) return null;
    const url = new URL(this.config.endpoint);
    url.searchParams.set('planId', planId);

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: this.getHeaders()
    });

    if (!response.ok) return null;
    return response.json();
  }

  async test() {
    if (!this.config.endpoint) {
      return { ok: false, message: 'Endpoint is required' };
    }

    try {
      const response = await fetch(this.config.endpoint, {
        method: 'HEAD',
        headers: this.getHeaders()
      });
      return { ok: response.ok, message: response.ok ? 'Connected' : `HTTP ${response.status}` };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : 'Connection failed' };
    }
  }

  private getHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.config.authToken) {
      const headerName = this.config.authHeader || 'Authorization';
      headers[headerName] = this.config.authToken;
    }

    return headers;
  }
}
