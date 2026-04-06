import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { NextResponse } from "next/server";
import { firestore } from "@/lib/firebase";

interface WAMessage {
  from?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
}

interface WAWebhookBody {
  object?: string;
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: WAMessage[];
      };
    }>;
  }>;
}

// GET — webhook verification handshake from Meta
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && token === verifyToken) {
    console.log("[webhook] Verified successfully");
    return new Response(challenge ?? "", { status: 200 });
  }

  console.warn("[webhook] Verification failed — bad token");
  return new Response("Forbidden", { status: 403 });
}

// POST — incoming WhatsApp messages
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as WAWebhookBody;
    const messages = body.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

    for (const message of messages) {
      const from = message.from;
      if (!from) continue;

      // Handle both text reply ("YES") and quick-reply button tap
      const text = (
        message.text?.body ??
        message.button?.payload ??
        message.button?.text ??
        ""
      ).trim().toUpperCase();

      console.log(`[webhook] Message from ${from}: "${text}"`);

      if (text !== "YES") continue;

      const verificationRef = doc(firestore, "otp_verifications", from);
      const snapshot = await getDoc(verificationRef);

      if (snapshot.exists() && (snapshot.data() as { status: string }).status === "pending") {
        await updateDoc(verificationRef, {
          status: "confirmed",
          confirmedAt: serverTimestamp(),
        });
        console.log("[webhook] Confirmed login for:", from);
      }
    }

    // Always return 200 to WhatsApp so it doesn't retry
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[webhook] Error:", error);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
