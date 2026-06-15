import { invoke } from "@tauri-apps/api/core";

export async function loadStoreValue<T>(key: string): Promise<T | null> {
  try {
    const raw = await invoke<string | null>("mesh_store_get", { key });
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function saveStoreValue(key: string, value: unknown): Promise<void> {
  try {
    await invoke("mesh_store_set", {
      key,
      value: JSON.stringify(value),
    });
  } catch {
    // Web dev outside Tauri.
  }
}

export const STORE_KEYS = {
  navigation: "ui:navigation",
  sidebar: "ui:sidebar",
  explorer: "ui:explorer",
  serverTabs: "ui:server-tabs",
  deployForm: "ui:deploy-form",
} as const;
