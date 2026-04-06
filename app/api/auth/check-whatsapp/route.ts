import { deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { NextResponse } from "next/server";
import { firestore } from "@/lib/firebase";
import { normalizePhoneNumber } from "@/lib/phone";
import { createCustomerProfile, getCustomerProfile, touchCustomerLogin } from "@/services/customerService";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const phone = searchParams.get("phone") ?? "";
    const normalizedPhone = normalizePhoneNumber(phone);

    if (!normalizedPhone) {
      return NextResponse.json({ success: false, confirmed: false, message: "Invalid phone." }, { status: 400 });
    }

    const verificationRef = doc(firestore, "otp_verifications", normalizedPhone);
    const snapshot = await getDoc(verificationRef);

    if (!snapshot.exists()) {
      return NextResponse.json({ success: false, confirmed: false, message: "No pending verification." }, { status: 404 });
    }

    const data = snapshot.data() as {
      status: string;
      expiresAt?: { toMillis?: () => number };
    };

    // Check expiry
    const expiresAt = data.expiresAt?.toMillis?.() ?? 0;
    if (expiresAt && Date.now() > expiresAt) {
      await deleteDoc(verificationRef);
      return NextResponse.json({ success: false, confirmed: false, expired: true, message: "Verification expired. Please try again." }, { status: 400 });
    }

    if (data.status !== "confirmed") {
      return NextResponse.json({ success: true, confirmed: false });
    }

    // Confirmed — clean up Firestore and set up customer session
    await deleteDoc(verificationRef);

    let customer = await getCustomerProfile(normalizedPhone);
    let requiresName = false;

    if (!customer) {
      await createCustomerProfile(normalizedPhone);
      customer = await getCustomerProfile(normalizedPhone);
      requiresName = true;
    } else {
      await touchCustomerLogin(normalizedPhone);
      customer = await getCustomerProfile(normalizedPhone);
      requiresName = !customer?.name;
    }

    return NextResponse.json({
      success: true,
      confirmed: true,
      phone: normalizedPhone,
      requiresName,
      customer,
    });
  } catch (error) {
    console.error("[check-whatsapp] error:", error);
    return NextResponse.json(
      { success: false, confirmed: false, message: error instanceof Error ? error.message : "Failed to check status." },
      { status: 500 },
    );
  }
}
