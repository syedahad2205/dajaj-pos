"use client";

import { firebaseAuthedFetch } from "@/lib/firebaseAuthFetch";
import {
  BACKUP_COLLECTIONS,
  buildBackupWorkbook,
  diffCollection,
  parseBackupWorkbook,
  stableStringify,
  type CollectionDiff,
  type ParsedBackup,
  type WireDoc,
} from "@/lib/financeBackup";

async function readJson(response: Response) {
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) throw new Error(payload?.message || `Request failed (${response.status}).`);
  return payload;
}

async function loadExcelJS(): Promise<typeof import("exceljs")> {
  const mod = await import("exceljs");
  return ((mod as unknown as { default?: typeof import("exceljs") }).default ?? mod) as typeof import("exceljs");
}

async function fetchCollection(name: string): Promise<WireDoc[]> {
  const docs: WireDoc[] = [];
  let after: string | null = null;
  do {
    const params = new URLSearchParams({ collection: name });
    if (after) params.set("after", after);
    const payload = await readJson(await firebaseAuthedFetch(`/api/finance/backup/export?${params.toString()}`));
    docs.push(...(payload.docs as WireDoc[]));
    after = payload.nextAfter as string | null;
  } while (after);
  return docs;
}

/** Reads every finance collection (one full read of each — mind the Firestore daily quota). */
export async function fetchAllFinanceData(onProgress?: (label: string, done: number, total: number) => void): Promise<Record<string, WireDoc[]>> {
  const result: Record<string, WireDoc[]> = {};
  for (let i = 0; i < BACKUP_COLLECTIONS.length; i += 1) {
    const config = BACKUP_COLLECTIONS[i];
    onProgress?.(config.label, i, BACKUP_COLLECTIONS.length);
    result[config.name] = await fetchCollection(config.name);
  }
  onProgress?.("Done", BACKUP_COLLECTIONS.length, BACKUP_COLLECTIONS.length);
  return result;
}

export function backupFileName(prefix: string, date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${prefix}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.xlsx`;
}

export async function buildBackupBlob(collections: Record<string, WireDoc[]>, exportedBy: string): Promise<Blob> {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DAJAJ Finance";
  workbook.created = new Date();
  const counts: Record<string, number> = {};
  for (const [name, docs] of Object.entries(collections)) counts[name] = docs.length;
  buildBackupWorkbook(workbook, collections, { exportedAt: new Date().toISOString(), exportedBy, counts });
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function parseBackupFile(file: File): Promise<ParsedBackup> {
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    return { meta: {}, collections: {}, errors: ["Could not read this file as an .xlsx workbook."] };
  }
  return parseBackupWorkbook(workbook);
}

export function diffAgainstCurrent(parsed: ParsedBackup, current: Record<string, WireDoc[]>): CollectionDiff[] {
  return BACKUP_COLLECTIONS.filter((c) => parsed.collections[c.name]).map((c) =>
    diffCollection(c.name, parsed.collections[c.name], current[c.name] ?? []),
  );
}

export interface RestoreStep {
  collection: string;
  upserts: WireDoc[];
  deletes: string[];
}

/** Writes needed to make each selected collection match the sheet. `mirror` also deletes records that are not in the sheet. */
export function buildRestorePlan(
  parsed: ParsedBackup,
  current: Record<string, WireDoc[]>,
  selected: Set<string>,
  mirror: boolean,
): RestoreStep[] {
  return diffAgainstCurrent(parsed, current)
    .filter((diff) => selected.has(diff.collection))
    .map((diff) => {
      const touched = new Set([...diff.added, ...diff.changed.map((c) => c.id)]);
      return {
        collection: diff.collection,
        upserts: parsed.collections[diff.collection].filter((d) => touched.has(d.id)),
        deletes: mirror ? diff.removed : [],
      };
    })
    .filter((step) => step.upserts.length > 0 || step.deletes.length > 0);
}

const MAX_OPS_PER_REQUEST = 400;
const MAX_BYTES_PER_REQUEST = 1_500_000;

export async function applyRestorePlan(plan: RestoreStep[], onProgress?: (done: number, total: number, collection: string) => void): Promise<void> {
  const total = plan.reduce((sum, step) => sum + step.upserts.length + step.deletes.length, 0);
  let done = 0;

  for (const step of plan) {
    let upserts: WireDoc[] = [];
    let deletes: string[] = [];
    let bytes = 0;

    const flush = async () => {
      if (upserts.length + deletes.length === 0) return;
      await readJson(
        await firebaseAuthedFetch("/api/finance/backup/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ confirm: "RESTORE", collection: step.collection, upserts, deletes }),
        }),
      );
      done += upserts.length + deletes.length;
      onProgress?.(done, total, step.collection);
      upserts = [];
      deletes = [];
      bytes = 0;
    };

    for (const doc of step.upserts) {
      const size = stableStringify(doc.data).length + doc.id.length;
      if (upserts.length + deletes.length >= MAX_OPS_PER_REQUEST || (bytes + size > MAX_BYTES_PER_REQUEST && upserts.length > 0)) await flush();
      upserts.push(doc);
      bytes += size;
    }
    for (const id of step.deletes) {
      if (upserts.length + deletes.length >= MAX_OPS_PER_REQUEST) await flush();
      deletes.push(id);
    }
    await flush();
  }
}

export async function recordRestore(fileName: string, exportedAt: string | undefined, summary: string[]): Promise<void> {
  await readJson(
    await firebaseAuthedFetch("/api/finance/backup/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileName, exportedAt, summary }),
    }),
  );
}
