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

type StoredPendingSale = {
  id: string;
  orgId: string;
  userId: string;
  createdAt: string;
  status: "pending" | "failed";
  iv?: ArrayBuffer;
  ciphertext?: ArrayBuffer;
  // Legacy plaintext fields are retained only to migrate already queued sales safely.
  sale?: Record<string, any>;
  rpcArgs?: Record<string, any>;
  lastError?: string;
};

const DB_NAME = "etihad-traders-offline";
const STORE = "pending-sales";
const KEYS = "encryption-keys";
const VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) {
      reject(new Error("Secure offline storage is unavailable in this browser."));
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
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: "userId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline storage."));
    request.onblocked = () => reject(new Error("Offline storage upgrade is blocked by another open tab."));
  });
}

async function getOrCreateKey(db: IDBDatabase, userId: string): Promise<CryptoKey> {
  const existing = await new Promise<CryptoKey | null>((resolve, reject) => {
    const request = db.transaction(KEYS, "readonly").objectStore(KEYS).get(userId);
    request.onsuccess = () => resolve((request.result as { userId: string; key: CryptoKey } | undefined)?.key || null);
    request.onerror = () => reject(request.error || new Error("Could not read offline encryption key."));
  });
  if (existing) return existing;
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return new Promise<CryptoKey>((resolve, reject) => {
    const tx = db.transaction(KEYS, "readwrite");
    tx.objectStore(KEYS).put({ userId, key: generated });
    tx.oncomplete = () => resolve(generated);
    tx.onerror = () => reject(tx.error || new Error("Could not protect pending offline sales."));
    tx.onabort = () => reject(tx.error || new Error("Offline encryption key save was cancelled."));
  });
}

async function encryptSale(db: IDBDatabase, item: PendingSale): Promise<StoredPendingSale> {
  const key = await getOrCreateKey(db, item.userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(item));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  return { id: item.id, orgId: item.orgId, userId: item.userId, createdAt: item.createdAt, status: item.status, iv: iv.buffer, ciphertext };
}

async function decryptSale(db: IDBDatabase, stored: StoredPendingSale): Promise<PendingSale> {
  if (stored.ciphertext && stored.iv) {
    const key = await getOrCreateKey(db, stored.userId);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(stored.iv) }, key, stored.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as PendingSale;
  }
  return {
    id: stored.id, orgId: stored.orgId, userId: stored.userId, createdAt: stored.createdAt,
    sale: stored.sale || {}, rpcArgs: stored.rpcArgs || {}, status: stored.status,
    ...(stored.lastError ? { lastError: stored.lastError } : {})
  };
}

export async function savePendingSale(item: PendingSale): Promise<void> {
  const db = await openDb();
  try {
    const stored = await encryptSale(db, item);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(stored);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save this sale on the device."));
      tx.onabort = () => reject(tx.error || new Error("Offline sale save was cancelled."));
    });
  } finally { db.close(); }
}

export async function listPendingSales(orgId: string, userId: string): Promise<PendingSale[]> {
  const db = await openDb();
  try {
    const stored = await new Promise<StoredPendingSale[]>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      request.onsuccess = () => resolve((request.result as StoredPendingSale[]).filter(x => x.orgId === orgId && x.userId === userId));
      request.onerror = () => reject(request.error || new Error("Could not read pending sales."));
    });
    const items = await Promise.all(stored.map(item => decryptSale(db, item)));
    const legacy = stored.filter(item => !item.ciphertext);
    if (legacy.length) {
      for (const item of items) if (legacy.some(old => old.id === item.id)) {
        const key = await getOrCreateKey(db, userId);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(item)));
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).put({ id:item.id, orgId:item.orgId, userId:item.userId, createdAt:item.createdAt, status:item.status, iv:iv.buffer, ciphertext } satisfies StoredPendingSale);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error("Could not encrypt an existing pending sale."));
        });
      }
    }
    return items.sort((a,b) => a.createdAt.localeCompare(b.createdAt));
  } finally { db.close(); }
}

export function updatePendingSale(item: PendingSale): Promise<void> {
  return savePendingSale(item);
}

export async function removePendingSale(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not clear a synchronised sale."));
      tx.onabort = () => reject(tx.error || new Error("Pending sale removal was cancelled."));
    });
  } finally { db.close(); }
}
