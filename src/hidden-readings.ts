import { join } from "node:path";

const STORE_PATH = join(import.meta.dir, "..", "hidden-readings.json");

type HiddenStore = Record<string, string[]>;

async function loadStore(): Promise<HiddenStore> {
  const file = Bun.file(STORE_PATH);
  if (!(await file.exists())) {
    return {};
  }
  return file.json();
}

async function saveStore(store: HiddenStore): Promise<void> {
  await Bun.write(STORE_PATH, JSON.stringify(store, null, 2));
}

export async function getHiddenHashes(serial: string): Promise<Set<string>> {
  const store = await loadStore();
  return new Set(store[serial] ?? []);
}

export async function hideHashes(serial: string, hashes: string[]): Promise<number> {
  const store = await loadStore();
  const merged = new Set([...(store[serial] ?? []), ...hashes]);
  store[serial] = [...merged];
  await saveStore(store);
  return merged.size;
}

export async function clearHidden(serial: string): Promise<number> {
  const store = await loadStore();
  const count = store[serial]?.length ?? 0;
  delete store[serial];
  await saveStore(store);
  return count;
}
