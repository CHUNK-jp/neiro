// storage.js — IndexedDB persistence for Neiro posts.
// A post carries copies of every layer blob it is built from, so pruning an
// old parent post never breaks playback of its descendants.

const DB_NAME = 'neiro-db';
const DB_VERSION = 1;
const STORE = 'posts';

export const MAX_POSTS = 50;

// --- Pure helpers (unit-tested in tests/) ---

export function sortNewestFirst(posts) {
  return [...posts].sort((a, b) => b.createdAt - a.createdAt);
}

// Returns the posts that fall outside the newest `max` and should be deleted.
export function selectPostsToPrune(posts, max = MAX_POSTS) {
  if (posts.length <= max) return [];
  return sortNewestFirst(posts).slice(max);
}

// --- IndexedDB plumbing ---

let dbPromise = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function db() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

function tx(database, mode, run) {
  return new Promise((resolve, reject) => {
    const t = database.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = run(store);
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function getAllPosts() {
  const database = await db();
  const posts = await new Promise((resolve, reject) => {
    const req = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
  return sortNewestFirst(posts);
}

export async function getPost(id) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function addPost(post) {
  const database = await db();
  await tx(database, 'readwrite', (store) => store.put(post));
  await prune();
  return post;
}

// Overwrites just the title of an existing post, leaving everything else
// (layers, createdAt, etc.) untouched. Unlike addPost, this never prunes —
// it's an in-place edit, not a new post.
export async function renamePost(id, title) {
  const database = await db();
  const existing = await getPost(id);
  if (!existing) return null;
  const updated = { ...existing, title };
  await tx(database, 'readwrite', (store) => store.put(updated));
  return updated;
}

export async function deletePost(id) {
  const database = await db();
  await tx(database, 'readwrite', (store) => store.delete(id));
}

export async function prune(max = MAX_POSTS) {
  const posts = await getAllPosts();
  const doomed = selectPostsToPrune(posts, max);
  if (!doomed.length) return [];
  const database = await db();
  await tx(database, 'readwrite', (store) => {
    for (const post of doomed) store.delete(post.id);
  });
  return doomed.map((p) => p.id);
}
