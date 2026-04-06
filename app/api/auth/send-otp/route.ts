import { Timestamp, doc, serverTimestamp, setDoc } from "firebase/firestore";
import { NextResponse } from "next/server";
import { firestore } from "@/lib/firebase";
import { normalizePhoneNumber } from "@/lib/phone";

const VERIFICATION_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const TEMPLATE_NAME = "review_activity";
const TEMPLATE_LANGUAGE = "en";

export async function POST(request: Request) {
  try {
    const requestBody = (await request.json()) as { phone?: string };
    const { phone } = requestBody;
    const normalizedPhone = normalizePhoneNumber(phone || "");

    console.log("[send-otp] normalized:", normalizedPhone);

    if (!normalizedPhone) {
      return NextResponse.json({ success: false, message: "Invalid phone number." }, { status: 400 });
    }

    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!phoneNumberId || !accessToken) {
      return NextResponse.json({ success: false, message: "WhatsApp configuration is missing." }, { status: 500 });
    }

    // Store pending verification in Firestore
    const verificationRef = doc(firestore, "otp_verifications", normalizedPhone);
    await setDoc(verificationRef, {
      phone: normalizedPhone,
      status: "pending",
      createdAt: serverTimestamp(),
      expiresAt: Timestamp.fromDate(new Date(Date.now() + VERIFICATION_EXPIRY_MS)),
    });

    // Send review_activity template with phone number as body variable {{1}}
    const endpoint = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: normalizedPhone,
      type: "template",
      template: {
        name: TEMPLATE_NAME,
        language: { code: TEMPLATE_LANGUAGE },
        components: [
          {
            type: "body",
            parameters: [{ type: "text", text: normalizedPhone }],
          },
        ],
      },
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const responseData = (await response.json()) as unknown;
    console.log("[send-otp] WhatsApp response:", response.status, responseData);

    if (!response.ok) {
      console.error("[send-otp] WhatsApp API error:", responseData);
      return NextResponse.json({ success: false, message: "Failed to send WhatsApp message. Please try again." }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: "WhatsApp message sent", phone: normalizedPhone });
  } catch (error) {
    console.error("[send-otp] error:", error);
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to send verification." },
      { status: 500 },
    );
  }
}
