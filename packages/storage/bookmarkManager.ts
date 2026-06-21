import { RecentPlan } from '@packages/types/shared';
import { appDataDir, join } from '@tauri-apps/api/path';
import { exists, mkdir, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { isTauriRuntime } from './isTauriRuntime';

const DB_NAME = 'PlanInPlaceDB';
const STORE_NAME = 'recent_plans';
const SETTINGS_STORE = 'settings';
const DB_VERSION = 2;
const TAURI_STORE_FILE = 'bookmarks.json';

type BookmarkStore = {
  recentPlans: RecentPlan[];
  lastPlanId: string | null;
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getTauriStorePath(): Promise<string> {
  const dir = await appDataDir();
  await mkdir(dir, { recursive: true });
  return join(dir, TAURI_STORE_FILE);
}

async function readTauriStore(): Promise<BookmarkStore> {
  const path = await getTauriStorePath();
  if (!(await exists(path))) {
    return { recentPlans: [], lastPlanId: null };
  }

  try {
    const content = await readTextFile(path);
    const parsed = JSON.parse(content) as BookmarkStore;
    return {
      recentPlans: Array.isArray(parsed.recentPlans) ? parsed.recentPlans : [],
      lastPlanId: parsed.lastPlanId || null
    };
  } catch {
    return { recentPlans: [], lastPlanId: null };
  }
}

async function writeTauriStore(store: BookmarkStore): Promise<void> {
  const path = await getTauriStorePath();
  await writeTextFile(path, JSON.stringify(store, null, 2));
}

export async function getRecentPlans(): Promise<RecentPlan[]> {
  if (isTauriRuntime()) {
    const store = await readTauriStore();
    return store.recentPlans.sort((a, b) => b.lastOpened - a.lastOpened);
  }

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = request.result as RecentPlan[];
        resolve(results.sort((a, b) => b.lastOpened - a.lastOpened));
      };
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    console.error('Failed to get recent plans', e);
    return [];
  }
}

export async function addRecentPlan(plan: Omit<RecentPlan, 'lastOpened'>): Promise<void> {
  if (isTauriRuntime()) {
    const store = await readTauriStore();
    const existing = store.recentPlans.find((p) => p.id === plan.id);
    const nextPlan: RecentPlan = {
      id: plan.id,
      name: plan.name,
      path: plan.path,
      lastOpened: Date.now()
    };

    if (existing) {
      Object.assign(existing, nextPlan);
    } else {
      store.recentPlans.push(nextPlan);
    }

    await writeTauriStore(store);
    return;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ ...plan, lastOpened: Date.now() });
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function removeRecentPlan(id: string): Promise<void> {
  if (isTauriRuntime()) {
    const store = await readTauriStore();
    store.recentPlans = store.recentPlans.filter((p) => p.id !== id);
    if (store.lastPlanId === id) {
      store.lastPlanId = null;
    }
    await writeTauriStore(store);
    return;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function setLastPlanId(id: string | null): Promise<void> {
  if (isTauriRuntime()) {
    const store = await readTauriStore();
    store.lastPlanId = id;
    await writeTauriStore(store);
    return;
  }

  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = transaction.objectStore(SETTINGS_STORE);
    const request = store.put(id, 'lastPlanId');
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getLastPlanId(): Promise<string | null> {
  if (isTauriRuntime()) {
    const store = await readTauriStore();
    return store.lastPlanId || null;
  }

  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(SETTINGS_STORE, 'readonly');
      const store = transaction.objectStore(SETTINGS_STORE);
      const request = store.get('lastPlanId');
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    return null;
  }
}
