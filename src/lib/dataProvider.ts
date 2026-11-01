import { invoke } from "@tauri-apps/api/core";
import { supabase } from "./supabase";

export type DataMode = "desktop-local" | "cloud";
export type LocalRecord = Record<string, unknown> & { id?: string; company_id?: string };

const isDesktopRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const getDataMode = (): DataMode =>
  isDesktopRuntime() ? "desktop-local" : "cloud";

/**
 * Shared company-scoped data gateway.
 * Desktop uses the local SQLite store and records durable outbox events.
 * Browser/PWA continues to use the existing Supabase tenant/RLS path.
 *
 * This is deliberately an explicit collection API rather than a fake
 * Supabase query-builder shim: each screen can migrate collection-by-collection
 * and retain its current business validation.
 */
export async function listRecords<T extends LocalRecord = LocalRecord>(
  collection: string,
  companyId: string,
): Promise<T[]> {
  if (isDesktopRuntime()) {
    return invoke<T[]>("local_list_records", { collection, companyId });
  }
  if (!supabase) throw new Error("Cloud database is not configured.");
  const { data, error } = await supabase
    .from(collection)
    .select("*")
    .eq("hotel_id", companyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as T[];
}

export async function saveRecord<T extends LocalRecord = LocalRecord>(
  collection: string,
  companyId: string,
  record: T,
): Promise<T> {
  if (isDesktopRuntime()) {
    return invoke<T>("local_upsert_record", { collection, companyId, record });
  }
  if (!supabase) throw new Error("Cloud database is not configured.");
  const payload = { ...record, hotel_id: companyId };
  if (record.id) {
    const { data, error } = await supabase
      .from(collection)
      .update(payload)
      .eq("hotel_id", companyId)
      .eq("id", record.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as T;
  }
  const { data, error } = await supabase
    .from(collection)
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return data as T;
}

export async function removeRecord(
  collection: string,
  companyId: string,
  recordId: string,
): Promise<void> {
  if (isDesktopRuntime()) {
    return invoke<void>("local_delete_record", {
      collection,
      companyId,
      recordId,
    });
  }
  if (!supabase) throw new Error("Cloud database is not configured.");
  const { error } = await supabase
    .from(collection)
    .delete()
    .eq("hotel_id", companyId)
    .eq("id", recordId);
  if (error) throw error;
}

export async function getLocalRuntimeStatus() {
  if (!isDesktopRuntime()) return null;
  return invoke<{
    mode: string;
    database: string;
    company_count: number;
    sync_mode: string;
  }>("local_runtime_status");
}
