import { basename, join } from '@tauri-apps/api/path';
import { open } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { ROOT_FOLDER_NAME, METADATA_FILE } from '@packages/core/config';
import { addRecentPlan, setLastPlanId } from '../bookmarkManager';
import { StorageManager, NotifyStorage } from './base';

export class TauriStorage implements StorageManager, NotifyStorage {
  type: 'tauri' = 'tauri';

  private directoryPath: string | null = null;
  private updateCallbacks: (() => void)[] = [];
  private notifyHandler: ((message: string, level: string) => void) | null = null;

  setNotifyHandler(handler: (message: string, level: string) => void) {
    this.notifyHandler = handler;
  }

  isSupported(): boolean {
    return typeof window !== 'undefined' && ('__TAURI__' in window || '__TAURI_INTERNALS__' in window);
  }

  async hasPermission(): Promise<boolean> {
    return !!this.directoryPath;
  }

  async requestPermission(): Promise<boolean> {
    const path = await this.selectFolder();
    return !!path;
  }

  private async getPlanFolderPath(create = false): Promise<string | null> {
    if (!this.directoryPath) return null;

    const selectedBaseName = await basename(this.directoryPath);
    if (selectedBaseName === ROOT_FOLDER_NAME) {
      if (create) {
        await mkdir(this.directoryPath, { recursive: true });
      }
      return this.directoryPath;
    }

    const planPath = await join(this.directoryPath, ROOT_FOLDER_NAME);
    if (create && !(await exists(planPath))) {
      await mkdir(planPath, { recursive: true });
    }

    if (!(await exists(planPath))) {
      return null;
    }

    return planPath;
  }

  async getFiles(): Promise<{ name: string; content: string }[]> {
    const folder = await this.getPlanFolderPath();
    if (!folder) return [];

    const entries = await readDir(folder);
    const files: { name: string; content: string }[] = [];

    for (const entry of entries) {
      if (!entry.isFile || !entry.name) continue;
      const filePath = await join(folder, entry.name);
      const content = await readTextFile(filePath);
      files.push({ name: entry.name, content });
    }

    return files;
  }

  async listFiles(): Promise<string[]> {
    const files = await this.getFiles();
    return files.map((f) => f.name);
  }

  async readFile(name: string): Promise<string | null> {
    const folder = await this.getPlanFolderPath();
    if (!folder) return null;

    const path = await join(folder, name);
    if (!(await exists(path))) return null;

    return readTextFile(path);
  }

  async writeFile(name: string, content: string): Promise<void> {
    const folder = await this.getPlanFolderPath(true);
    if (!folder) return;

    const path = await join(folder, name);
    await writeTextFile(path, content);
    this.notifyUpdate();
  }

  async deleteFile(name: string): Promise<void> {
    const folder = await this.getPlanFolderPath();
    if (!folder) return;

    const path = await join(folder, name);
    if (await exists(path)) {
      await remove(path);
      this.notifyUpdate();
    }
  }

  async clearPlanData(): Promise<void> {
    const folder = await this.getPlanFolderPath();
    if (!folder || !(await exists(folder))) return;

    await remove(folder, { recursive: true });
    this.notifyUpdate();
  }

  getDirectoryName(): string {
    if (!this.directoryPath) return ROOT_FOLDER_NAME;
    const parts = this.directoryPath.split(/[\\/]/);
    return parts.filter(Boolean).pop() || ROOT_FOLDER_NAME;
  }

  getDirectoryPath(): string {
    return this.directoryPath || ROOT_FOLDER_NAME;
  }

  onUpdate(callback: () => void): void {
    this.updateCallbacks.push(callback);
  }

  private notifyUpdate() {
    this.updateCallbacks.forEach((cb) => cb());
  }

  async hasEntry(name: string): Promise<boolean> {
    if (!this.directoryPath) return false;
    const path = await join(this.directoryPath, name);
    return exists(path);
  }

  async registerPlan(id: string, name: string): Promise<void> {
    if (!this.directoryPath) return;

    await addRecentPlan({
      id,
      name,
      path: this.directoryPath
    });
    await setLastPlanId(id);
  }

  async openBookmark(plan: any): Promise<boolean> {
    if (!plan.path) return false;

    this.directoryPath = plan.path;
    const folder = await this.getPlanFolderPath();
    if (!folder) return false;

    const metaPath = await join(folder, METADATA_FILE);
    return exists(metaPath);
  }

  async selectFolder(): Promise<string | null> {
    const selected = await open({
      directory: true,
      multiple: false,
      title: 'Select Plan Folder'
    });

    if (!selected || Array.isArray(selected)) {
      return null;
    }

    this.directoryPath = selected;
    return selected;
  }

  notify(message: string, level: 'info' | 'warning' | 'error' = 'info') {
    if (this.notifyHandler) {
      this.notifyHandler(message, level);
      return;
    }

    isPermissionGranted()
      .then((granted) => (granted ? true : requestPermission().then((result) => result === 'granted')))
      .then((granted) => {
        if (granted) {
          sendNotification({
            title: `Plan InPlace (${level})`,
            body: message
          });
        }
      })
      .catch(() => {
        if (level === 'error') console.error(message);
        else if (level === 'warning') console.warn(message);
        else console.log(message);
      });
  }
}
