import { NextResponse } from "next/server";
import { collection as fsCollection, documentId, getDocs, limit as fsLimit, orderBy, query, startAfter } from "firebase/firestore";
import { getAuthenticatedFirestoreForRequest } from "@/lib/firebaseServerApp";
import { requireAdminCaller } from "@/lib/financeRouteAuth";
import { financeErrorResponse } from "@/lib/financeApiError";
import { assertBackupCollection, toWire } from "@/lib/financeBackupServer";
import type { WireData, WireDoc } from "@/lib/financeBackup";

export const dynamic = "force-dynamic";

const MAX_PAGE = 1000;

/**
 * GET ?collection=fin_transactions&after=<docId>&limit=1000
 * One page of a finance collection as wire JSON, ordered by document id.
 * Reads as the signed-in Admin (firestore.rules grant Admin read on every
 * finance collection), so export needs no service-account key. The browser
 * pages through every collection and builds the workbook itself, so the
 * export never hits the serverless response-size limit. Admin-only.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const collection = assertBackupCollection(url.searchParams.get("collection"));
    const after = url.searchParams.get("after");
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || MAX_PAGE, 1), MAX_PAGE);

    const { cleanup, firestore, userId } = await getAuthenticatedFirestoreForRequest(request);
    try {
      await requireAdminCaller(firestore, userId);
      const constraints = [orderBy(documentId()), ...(after ? [startAfter(after)] : []), fsLimit(limit)];
      const snapshot = await getDocs(query(fsCollection(firestore, collection), ...constraints));

      const docs: WireDoc[] = snapshot.docs.map((d) => ({ id: d.id, data: toWire(d.data()) as WireData }));
      const nextAfter = snapshot.size === limit ? snapshot.docs[snapshot.size - 1].id : null;
      return NextResponse.json({ success: true, collection, docs, nextAfter });
    } finally {
      await cleanup();
    }
  } catch (error) {
    return financeErrorResponse(error, "/backup/export GET");
  }
}
