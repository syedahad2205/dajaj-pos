import { NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminFirestore } from "@/lib/firebaseAdmin";
import { financeErrorResponse } from "@/lib/financeApiError";
import { requireBackupAdmin } from "@/lib/financeBackupServer";

export const dynamic = "force-dynamic";

/**
 * POST { fileName, exportedAt, summary }
 * Records a finished restore in the finance audit log (written last, so a
 * restore of fin_audit_logs itself can't wipe it). Admin-only.
 */
export async function POST(request: Request) {
  try {
    const { userId, userName } = await requireBackupAdmin(request);
    const body = await request.json().catch(() => ({}));
    const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 200) : "backup";

    await getAdminFirestore()
      .collection("fin_audit_logs")
      .add({
        module: "backup",
        entityId: "finance",
        entityLabel: `Restored finance data from ${fileName}`,
        action: "restore",
        userId,
        userName,
        oldValue: null,
        newValue: {
          fileName,
          exportedAt: typeof body?.exportedAt === "string" ? body.exportedAt : null,
          summary: Array.isArray(body?.summary) ? body.summary.slice(0, 50) : null,
        },
        reason: null,
        timestamp: FieldValue.serverTimestamp(),
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    return financeErrorResponse(error, "/backup/complete POST");
  }
}
