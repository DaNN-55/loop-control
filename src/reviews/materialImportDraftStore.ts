import type { MaterialPurpose, MaterialType } from "./materialImport";

export interface StoredMaterialImportDraft {
  file: File;
  id: string;
  isMainScript: boolean;
  materialPurpose: MaterialPurpose | null;
  materialType: MaterialType;
}

const databaseName = "loop-control-material-imports";
const storeName = "episode-drafts";

export const materialImportDraftStorageAvailable = () => typeof indexedDB !== "undefined";

function openDatabase(): Promise<IDBDatabase | null> {
  if (!materialImportDraftStorageAvailable()) return Promise.resolve(null);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开材料草稿存储。"));
  });
}

export async function readMaterialImportDrafts(episodeId: string): Promise<StoredMaterialImportDraft[]> {
  const database = await openDatabase();
  if (!database) return [];
  return new Promise<StoredMaterialImportDraft[]>((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(episodeId);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error ?? new Error("无法读取材料草稿。"));
  }).finally(() => database.close());
}

export async function writeMaterialImportDrafts(episodeId: string, drafts: StoredMaterialImportDraft[]): Promise<void> {
  const database = await openDatabase();
  if (!database) return;
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    if (drafts.length) transaction.objectStore(storeName).put(drafts, episodeId);
    else transaction.objectStore(storeName).delete(episodeId);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("无法保存材料草稿。"));
  }).finally(() => database.close());
}
