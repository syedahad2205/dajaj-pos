import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { financeErrorResponse } from "@/lib/financeApiError";
import { assertBackupCollection, assertDocId, docFromWire, requireBackupAdmin } from "@/lib/financeBackupServer";

export const dynamic = "force-dynamic";

/** Firestore batches allow 500 writes; stay under it. */
const MAX_OPS = 450;

/**
 * POST { confirm: "RESTORE", collection, upserts: [{ id, data }], deletes: [id] }
 * Applies one chunk of a restore as a single atomic batch. `upserts` replace
 * the whole document (no merge) so it ends up exactly as in the sheet.
 * Re-running the same restore is safe: it converges on the sheet's state.
 * Admin-only.
 */
export async function POST(request: Request) {
  try {
    await requireBackupAdmin(request);
    const body = await request.json().catch(() => null);
    if (body?.confirm !== "RESTORE") throw new Error('Restore requests must include confirm: "RESTORE".');

    const collection = assertBackupCollection(body.collection);
    const upserts: unknown[] = Array.isArray(body.upserts) ? body.upserts : [];
    const deletes: unknown[] = Array.isArray(body.deletes) ? body.deletes : [];
    if (upserts.length + deletes.length === 0) return NextResponse.json({ success: true, written: 0, deleted: 0 });
    if (upserts.length + deletes.length > MAX_OPS) throw new Error(`At most ${MAX_OPS} changes per request.`);

    const db = getAdminFirestore();
    const batch = db.batch();
    const ref = (id: unknown) => db.collection(collection).doc(assertDocId(id));

    for (const item of upserts) {
      const { id, data } = (item ?? {}) as { id?: unknown; data?: unknown };
      batch.set(ref(id), docFromWire(data, db));
    }
    for (const id of deletes) batch.delete(ref(id));

    await batch.commit();
    return NextResponse.json({ success: true, written: upserts.length, deleted: deletes.length });
  } catch (error) {
    return financeErrorResponse(error, "/backup/apply POST");
  }
}
