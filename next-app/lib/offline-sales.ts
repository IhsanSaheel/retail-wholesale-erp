export type PendingSale = {
  id: string;
  orgId: string;
  userId: string;
  createdAt: string;
  sale: Record<string, any>;
  rpcArgs: Record<string, any>;
  status: "pending" | "failed";
  lastError?: string;
};

const DB_NAME = "etihad-traders-offline";
const STORE = "pending-sales";
const VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Offline storage is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("owner", ["orgId", "userId"], { unique: false });
        store.createIndex("status", "status", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline storage."));
    request.onblocked = () => reject(new Error("Offline storage upgrade is blocked by another open tab."));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason?: any) => void) => void): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    run(tx.objectStore(STORE), resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error || new Error("Offline storage transaction failed.")); };
    tx.onabort = () => { db.close(); reject(tx.error || new Error("Offline storage transaction was cancelled.")); };
  });
}

export function savePendingSale(item: PendingSale): Promise<void> {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.put(item);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not save this sale on the device."));
  });
}

export function listPendingSales(orgId: string, userId: string): Promise<PendingSale[]> {
  return withStore<PendingSale[]>("readonly", (store, resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve((request.result as PendingSale[]).filter(x => x.orgId === orgId && x.userId === userId).sort((a,b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => reject(request.error || new Error("Could not read pending sales."));
  });
}

export function updatePendingSale(item: PendingSale): Promise<void> {
  return savePendingSale(item);
}

export function removePendingSale(id: string): Promise<void> {
  return withStore<void>("readwrite", (store, resolve, reject) => {
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error("Could not clear a synchronised sale."));
  });
}
