import type { FileKind } from './library'

const DB_NAME = 't3d-asset-cache'
const DB_VERSION = 2
const FILES = 'files'
const META = 'meta'
const ARTIFACTS = 'artifacts'
const SCENE = 'scene'
const SCENE_KEY = 'current'

export const MODEL_IMPORTER_VERSION = 't3d-glb-artifact-1'

export interface CachedFile {
  id: string
  name: string
  kind: FileKind
  fileName: string
  hash: string
  thumb: string | null
  bytes: ArrayBuffer
}

export interface AssetMeta {
  id: string
  name: string
  kind: FileKind
  fileName: string
  hash: string
  thumb: string | null
  byteLength: number
  artifactReady: boolean
}

export interface ModelArtifactRecord {
  key: string
  hash: string
  importerVersion: string
  glb: ArrayBuffer
  savedAt: number
}

export interface SceneCacheRecord<T> {
  id: string
  document: T
}

let opening: Promise<IDBDatabase> | null = null

export function artifactKey(hash: string): string {
  return `${hash}__${MODEL_IMPORTER_VERSION}`
}

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function rememberFile(record: CachedFile): Promise<void> {
  const meta = metaFromFile(record, false)
  const db = await database()
  await transaction(db, [FILES, META], 'readwrite', stores => {
    stores[FILES].put(record)
    stores[META].put(meta)
  })
}

export async function updateCachedThumb(id: string, thumb: string): Promise<void> {
  const db = await database()
  const current = await request<AssetMeta | undefined>(db, META, 'readonly', store => store.get(id))
  if (!current) return
  current.thumb = thumb
  await request(db, META, 'readwrite', store => store.put(current))
}

export async function patchAssetMeta(id: string, patch: Partial<AssetMeta>): Promise<void> {
  const db = await database()
  const current = await request<AssetMeta | undefined>(db, META, 'readonly', store => store.get(id))
  if (!current) return
  await request(db, META, 'readwrite', store => store.put({ ...current, ...patch, id: current.id }))
}

export async function forgetFile(id: string): Promise<void> {
  const db = await database()
  const meta = await request<AssetMeta | undefined>(db, META, 'readonly', store => store.get(id))
  await transaction(db, [FILES, META, ARTIFACTS], 'readwrite', stores => {
    stores[FILES].delete(id)
    stores[META].delete(id)
    if (meta?.hash) stores[ARTIFACTS].delete(artifactKey(meta.hash))
  })
}

export async function readCachedFiles(): Promise<CachedFile[]> {
  const db = await database()
  return request<CachedFile[]>(db, FILES, 'readonly', store => store.getAll())
}

export async function readAssetMetas(): Promise<AssetMeta[]> {
  const db = await database()
  return request<AssetMeta[]>(db, META, 'readonly', store => store.getAll())
}

export async function readFileBytes(id: string): Promise<ArrayBuffer | null> {
  const db = await database()
  const row = await request<CachedFile | undefined>(db, FILES, 'readonly', store => store.get(id))
  return row?.bytes ?? null
}

export async function readModelArtifact(hash: string): Promise<ArrayBuffer | null> {
  const db = await database()
  const row = await request<ModelArtifactRecord | undefined>(db, ARTIFACTS, 'readonly', store => store.get(artifactKey(hash)))
  if (!row || row.importerVersion !== MODEL_IMPORTER_VERSION) return null
  return row.glb
}

export async function writeModelArtifact(hash: string, glb: ArrayBuffer): Promise<void> {
  const db = await database()
  const record: ModelArtifactRecord = {
    key: artifactKey(hash),
    hash,
    importerVersion: MODEL_IMPORTER_VERSION,
    glb,
    savedAt: Date.now(),
  }
  await request(db, ARTIFACTS, 'readwrite', store => store.put(record))
}

export async function readSceneDocument<T>(): Promise<T | null> {
  const db = await database()
  const row = await request<SceneCacheRecord<T> | undefined>(db, SCENE, 'readonly', store => store.get(SCENE_KEY))
  return row?.document ?? null
}

export async function writeSceneDocument<T>(document: T): Promise<void> {
  const db = await database()
  const record: SceneCacheRecord<T> = { id: SCENE_KEY, document }
  await request(db, SCENE, 'readwrite', store => store.put(record))
}

export async function migrateLegacyFilesToMeta(): Promise<void> {
  const metas = await readAssetMetas()
  if (metas.length > 0) return
  const files = await readCachedFiles()
  if (files.length === 0) return
  const db = await database()
  await transaction(db, [META], 'readwrite', stores => {
    for (const file of files) stores[META].put(metaFromFile(file, false))
  })
}

function metaFromFile(record: CachedFile, artifactReady: boolean): AssetMeta {
  return {
    id: record.id,
    name: record.name,
    kind: record.kind,
    fileName: record.fileName,
    hash: record.hash,
    thumb: record.thumb,
    byteLength: record.bytes.byteLength,
    artifactReady,
  }
}

function database(): Promise<IDBDatabase> {
  if (!opening) {
    opening = openDb().catch(error => {
      opening = null
      throw error
    })
  }
  return opening
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(ARTIFACTS)) db.createObjectStore(ARTIFACTS, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(SCENE)) db.createObjectStore(SCENE, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function request<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const query = run(db.transaction(storeName, mode).objectStore(storeName))
    query.onsuccess = () => resolve(query.result)
    query.onerror = () => reject(query.error)
  })
}

function transaction(
  db: IDBDatabase,
  storeNames: string[],
  mode: IDBTransactionMode,
  run: (stores: Record<string, IDBObjectStore>) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode)
    const stores: Record<string, IDBObjectStore> = {}
    for (const name of storeNames) stores[name] = tx.objectStore(name)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
    run(stores)
  })
}
