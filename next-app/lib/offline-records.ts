export type OfflineRecordMutation = {
  id: string;
  orgId: string;
  userId: string;
  collection: string;
  recordId: string;
  branchIds: string[];
  data: Record<string, any>;
  updatedBy: string;
  createdAt: number;
};
type Stored = { id: string; orgId: string; userId: string; iv: ArrayBuffer; ciphertext: ArrayBuffer };
const DB = "etihad-prime-offline-records";
const STORE = "mutations";
const KEYS = "keys";
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined"||!globalThis.crypto?.subtle){reject(new Error("Secure offline storage is unavailable."));return;}
    const req=indexedDB.open(DB,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:"id"});if(!db.objectStoreNames.contains(KEYS))db.createObjectStore(KEYS,{keyPath:"userId"});};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error||new Error("Could not open offline changes."));req.onblocked=()=>reject(new Error("Offline storage is busy."));
  });
}
async function keyFor(db:IDBDatabase,userId:string):Promise<CryptoKey>{
  const found=await new Promise<CryptoKey|null>((resolve,reject)=>{const q=db.transaction(KEYS,"readonly").objectStore(KEYS).get(userId);q.onsuccess=()=>resolve((q.result as any)?.key||null);q.onerror=()=>reject(q.error);});
  if(found)return found;
  const key=await crypto.subtle.generateKey({name:"AES-GCM",length:256},false,["encrypt","decrypt"]);
  await new Promise<void>((resolve,reject)=>{const tx=db.transaction(KEYS,"readwrite");tx.objectStore(KEYS).put({userId,key});tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});
  return key;
}
export async function saveOfflineRecordMutation(item:Omit<OfflineRecordMutation,"id"|"createdAt">):Promise<void>{
  const db=await openDb();try{// Scope the queue key to the organisation and user as well as the record.
// Otherwise two staff accounts editing the same product ID on one device
// could overwrite each other's encrypted pending change.
const mutation={...item,id:JSON.stringify([item.orgId,item.userId,item.collection,item.recordId]),createdAt:Date.now()};const key=await keyFor(db,item.userId);const iv=crypto.getRandomValues(new Uint8Array(12));const ciphertext=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(JSON.stringify(mutation)));await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put({id:mutation.id,orgId:item.orgId,userId:item.userId,iv:iv.buffer,ciphertext} satisfies Stored);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Offline change could not be saved."));});}finally{db.close();}
}
export async function listPendingRecordMutations(orgId:string,userId:string):Promise<OfflineRecordMutation[]>{
  const db=await openDb();try{const stored=await new Promise<Stored[]>((resolve,reject)=>{const q=db.transaction(STORE,"readonly").objectStore(STORE).getAll();q.onsuccess=()=>resolve((q.result as Stored[]).filter(x=>x.orgId===orgId&&x.userId===userId));q.onerror=()=>reject(q.error);});const key=await keyFor(db,userId);const items=await Promise.all(stored.map(async x=>JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM",iv:new Uint8Array(x.iv)},key,x.ciphertext))) as OfflineRecordMutation));return items.sort((a,b)=>a.createdAt-b.createdAt);}finally{db.close();}
}
export async function removePendingRecordMutation(id:string):Promise<void>{
  const db=await openDb();try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).delete(id);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}finally{db.close();}
}
