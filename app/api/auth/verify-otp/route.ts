import { deleteDoc, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { CUSTOMER_BYPASS_OTP } from "@/lib/devAuthShared";
import { NextResponse } from "next/server";
import { firestore } from "@/lib/firebase";
import { isValidOtp, normalizePhoneNumber } from "@/lib/phone";
import { createCustomerProfile, getCustomerProfile, touchCustomerLogin } from "@/services/customerService";

const MAX_ATTEMPTS = 5;

export async function POST(request: Request) {
  try {
    const { phone, otp } = (await request.json()) as { phone?: string; otp?: string };
    const normalizedPhone = normalizePhoneNumber(phone || "");

    if (!normalizedPhone) {
      return NextResponse.json({ success: false, message: "Enter a valid phone number." }, { status: 400 });
    }

    const isBypassOtp = otp === CUSTOMER_BYPASS_OTP;

    if (!isBypassOtp && !isValidOtp(otp || "")) {
      return NextResponse.json({ success: false, message: "Enter a valid 6 digit OTP." }, { status: 400 });
    }

    const verificationRef = doc(firestore, "otp_verifications", normalizedPhone);
    const verificationSnapshot = await getDoc(verificationRef);

    if (!verificationSnapshot.exists()) {
      if (!isBypassOtp) {
        return NextResponse.json({ success: false, message: "OTP expired. Please request a new OTP." }, { status: 400 });
      }
    }

    const verification = (verificationSnapshot.data() as {
      otp: string;
      expiresAt?: { toMillis?: () => number };
      attempts?: number;
    }) || {
      otp: CUSTOMER_BYPASS_OTP,
      attempts: 0,
    };

    const attempts = verification.attempts ?? 0;
    if (attempts >= MAX_ATTEMPTS) {
      return NextResponse.json({ success: false, message: "Too many attempts. Please request a new OTP." }, { status: 429 });
    }

    const expiresAt = verification.expiresAt?.toMillis?.() ?? 0;
    if (expiresAt && Date.now() > expiresAt) {
      await deleteDoc(verificationRef);
      return NextResponse.json({ success: false, message: "OTP expired. Please request a new OTP." }, { status: 400 });
    }

    if (verification.otp !== otp && !isBypassOtp) {
      await updateDoc(verificationRef, {
        attempts: attempts + 1,
        updatedAt: serverTimestamp(),
      });

      return NextResponse.json({ success: false, message: "Invalid OTP." }, { status: 400 });
    }

    if (verificationSnapshot.exists()) {
      await deleteDoc(verificationRef);
    }

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
      phone: normalizedPhone,
      requiresName,
      customer,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to verify OTP." },
      { status: 500 },
    );
  }
}
