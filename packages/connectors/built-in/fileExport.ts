import { writeTextFile } from '@tauri-apps/plugin-fs';
import { Connector, ConnectorConfig, SyncPayload, SyncResult } from '../base';

interface FileExportConfig extends ConnectorConfig {
  format?: 'json' | 'markdown' | 'csv';
  outputPath?: string;
  fileName?: string;
}

export class FileExportConnector implements Connector {
  id = 'file-export';
  name = 'File Export';
  description = 'Export plan snapshots to JSON, Markdown, or CSV.';

  private config: FileExportConfig = { format: 'json' };

  isConfigured(): boolean {
    return true;
  }

  async configure(config: ConnectorConfig): Promise<void> {
    this.config = {
      format: 'json',
      ...(config as FileExportConfig)
    };
  }

  async push(data: SyncPayload): Promise<SyncResult> {
    const content = this.render(data);
    const extension = this.config.format === 'markdown' ? 'md' : this.config.format;
    const fileName = this.config.fileName || `plan-inplace-${data.planId}.${extension}`;

    if (this.isTauri() && this.config.outputPath) {
      const path = this.config.outputPath.endsWith('/') || this.config.outputPath.endsWith('\\')
        ? `${this.config.outputPath}${fileName}`
        : `${this.config.outputPath}/${fileName}`;
      await writeTextFile(path, content);
      return { success: true };
    }

    if (typeof document !== 'undefined') {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      return { success: true };
    }

    return { success: false, message: 'No output target available' };
  }

  async pull(): Promise<SyncPayload | null> {
    return null;
  }

  async test() {
    return { ok: true, message: this.config.outputPath ? 'Ready to export' : 'Browser download mode' };
  }

  private render(payload: SyncPayload): string {
    if (this.config.format === 'markdown') {
      return [
        `# ${payload.metadata.name}`,
        '',
        ...payload.tasks.map((task) => `- [ ] ${task.title} (${task.priority})`)
      ].join('\n');
    }

    if (this.config.format === 'csv') {
      const header = 'id,title,priority,status';
      const rows = payload.tasks.map((task) => {
        const status = String(task.status || '').replaceAll('"', '""');
        return `"${task.id}","${task.title.replaceAll('"', '""')}","${task.priority}","${status}"`;
      });
      return [header, ...rows].join('\n');
    }

    return JSON.stringify(payload, null, 2);
  }

  private isTauri() {
    return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
  }
}
