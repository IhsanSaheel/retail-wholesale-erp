export type OfflineBusinessRow = {
  collection: string;
  record_id: string;
  branch_ids: string[];
  data: Record<string, any>;
  updated_at?: string;
  updated_by?: string;
};

export type OfflineBusinessSnapshot = {
  userId: string;
  orgId: string;
  orgName: string;
  branchIds: string[];
  role: string;
  permissions: Record<string, boolean>;
  cachedAt: number;
  rows: OfflineBusinessRow[];
};

const DB_NAME = "etihad-traders-offline-business";
const STORE = "snapshots";
const VERSION = 1;
export const OFFLINE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Offline business storage is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "userId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline business storage."));
    request.onblocked = () => reject(new Error("Offline business storage is busy in another tab."));
  });
}

export async function saveOfflineBusinessSnapshot(snapshot: OfflineBusinessSnapshot): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(snapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save the offline business snapshot."));
      tx.onabort = () => reject(tx.error || new Error("Offline business snapshot save was cancelled."));
    });
  } finally { db.close(); }
}

export async function getOfflineBusinessSnapshot(userId: string): Promise<OfflineBusinessSnapshot | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(userId);
      request.onsuccess = () => resolve((request.result as OfflineBusinessSnapshot | undefined) || null);
      request.onerror = () => reject(request.error || new Error("Could not read the offline business snapshot."));
    });
  } finally { db.close(); }
}

export async function clearOfflineBusinessSnapshot(userId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not clear offline business data."));
    });
  } finally { db.close(); }
}
