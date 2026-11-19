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

type EncryptedSnapshot = { userId: string; cachedAt: number; iv: ArrayBuffer; ciphertext: ArrayBuffer };
const DB_NAME = "etihad-traders-offline-business";
const SNAPSHOTS = "snapshots";
const KEYS = "keys";
const VERSION = 2;
export const OFFLINE_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !globalThis.crypto?.subtle) {
      reject(new Error("Secure offline storage is unavailable in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: "userId" });
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS, { keyPath: "userId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open offline business storage."));
    request.onblocked = () => reject(new Error("Offline business storage is busy in another tab."));
  });
}

async function getOrCreateKey(db: IDBDatabase, userId: string): Promise<CryptoKey> {
  const existing = await new Promise<CryptoKey | null>((resolve, reject) => {
    const request = db.transaction(KEYS, "readonly").objectStore(KEYS).get(userId);
    request.onsuccess = () => resolve((request.result as { userId: string; key: CryptoKey } | undefined)?.key || null);
    request.onerror = () => reject(request.error || new Error("Could not read the offline encryption key."));
  });
  if (existing) return existing;
  const generated = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  return await new Promise<CryptoKey>((resolve, reject) => {
    const tx = db.transaction(KEYS, "readwrite");
    tx.objectStore(KEYS).put({ userId, key: generated });
    tx.oncomplete = () => resolve(generated);
    tx.onerror = () => reject(tx.error || new Error("Could not protect the offline business data."));
    tx.onabort = () => reject(tx.error || new Error("Offline encryption key save was cancelled."));
  });
}

export async function saveOfflineBusinessSnapshot(snapshot: OfflineBusinessSnapshot): Promise<void> {
  const db = await openDb();
  try {
    const key = await getOrCreateKey(db, snapshot.userId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(JSON.stringify(snapshot));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(SNAPSHOTS, "readwrite");
      tx.objectStore(SNAPSHOTS).put({ userId: snapshot.userId, cachedAt: snapshot.cachedAt, iv: iv.buffer, ciphertext } satisfies EncryptedSnapshot);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not save the offline business snapshot."));
      tx.onabort = () => reject(tx.error || new Error("Offline business snapshot save was cancelled."));
    });
  } finally { db.close(); }
}

export async function getOfflineBusinessSnapshot(userId: string): Promise<OfflineBusinessSnapshot | null> {
  const db = await openDb();
  try {
    const encrypted = await new Promise<EncryptedSnapshot | null>((resolve, reject) => {
      const request = db.transaction(SNAPSHOTS, "readonly").objectStore(SNAPSHOTS).get(userId);
      request.onsuccess = () => resolve((request.result as EncryptedSnapshot | undefined) || null);
      request.onerror = () => reject(request.error || new Error("Could not read the offline business snapshot."));
    });
    if (!encrypted) return null;
    const key = await getOrCreateKey(db, userId);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(encrypted.iv) }, key, encrypted.ciphertext);
    return JSON.parse(new TextDecoder().decode(plaintext)) as OfflineBusinessSnapshot;
  } catch {
    return null;
  } finally { db.close(); }
}

export async function clearOfflineBusinessSnapshot(userId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([SNAPSHOTS, KEYS], "readwrite");
      tx.objectStore(SNAPSHOTS).delete(userId);
      tx.objectStore(KEYS).delete(userId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Could not clear offline business data."));
    });
  } finally { db.close(); }
}
