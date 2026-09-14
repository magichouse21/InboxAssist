const DB_NAME = "inboxassist";
const DB_VERSION = 1;
const STORE_NAME = "emailChunks";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("emailId", "emailId", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open the local email index."));
  });
}

async function transaction(mode, operation) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = operation(database.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Local email index operation failed."));
  });
}

export async function listChunks() {
  return (await transaction("readonly", (store) => store.getAll())) || [];
}

export async function listChunksForEmail(emailId) {
  return (await transaction("readonly", (store) => store.index("emailId").getAll(emailId))) || [];
}

export async function putChunks(chunks) {
  if (!chunks.length) return;
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    chunks.forEach((chunk) => store.put(chunk));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("Unable to save the local email index."));
  });
}

export async function deleteChunksForEmail(emailId) {
  const chunks = await listChunksForEmail(emailId);
  if (!chunks.length) return;
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    chunks.forEach((chunk) => store.delete(chunk.id));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error || new Error("Unable to update the local email index."));
  });
}

export async function clearChunks() {
  await transaction("readwrite", (store) => store.clear());
}
