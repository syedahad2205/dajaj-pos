import { NextResponse } from "next/server";
import { normalizePhoneNumber } from "@/lib/phone";
import { updateCustomerProfile } from "@/services/customerService";

export async function POST(request: Request) {
  try {
    const { phone, name, dob } = (await request.json()) as {
      phone?: string;
      name?: string;
      dob?: string;
    };

    const normalizedPhone = normalizePhoneNumber(phone || "");
    if (!normalizedPhone) {
      return NextResponse.json({ success: false, message: "Enter a valid phone number." }, { status: 400 });
    }

    const trimmedName = (name || "").trim();
    if (!trimmedName) {
      return NextResponse.json({ success: false, message: "Name is required." }, { status: 400 });
    }

    await updateCustomerProfile(normalizedPhone, {
      name: trimmedName,
      dob: dob || "",
    });

    return NextResponse.json({
      success: true,
      phone: normalizedPhone,
    });
  } catch (error) {
    return NextResponse.json(
      { success: false, message: error instanceof Error ? error.message : "Failed to complete profile." },
      { status: 500 },
    );
  }
}
