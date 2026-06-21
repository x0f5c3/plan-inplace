import { Connector, ConnectorConfig, SyncPayload, SyncResult } from '../base';

interface WebhookConnectorConfig extends ConnectorConfig {
  url?: string;
  secret?: string;
}

export class WebhookConnector implements Connector {
  id = 'webhook';
  name = 'Webhook';
  description = 'Fire-and-forget sync payloads to webhook receivers.';

  private config: WebhookConnectorConfig = {};

  isConfigured(): boolean {
    return !!this.config.url;
  }

  async configure(config: ConnectorConfig): Promise<void> {
    this.config = config as WebhookConnectorConfig;
  }

  async push(data: SyncPayload): Promise<SyncResult> {
    if (!this.config.url) return { success: false, message: 'Webhook URL is required' };

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.secret ? { 'x-plan-inplace-secret': this.config.secret } : {})
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        return { success: false, message: `HTTP ${response.status}` };
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Webhook failed' };
    }
  }

  async pull(): Promise<SyncPayload | null> {
    return null;
  }

  async test() {
    if (!this.config.url) {
      return { ok: false, message: 'Webhook URL is required' };
    }

    return { ok: true, message: 'Configured' };
  }
}
