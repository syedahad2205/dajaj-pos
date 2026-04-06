"use client";

import { useEffect, useRef } from "react";

export default function OTPInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div>
      <label htmlFor="otp" className="mb-1 block text-sm font-medium text-slate-700">
        OTP
      </label>
      <input
        ref={inputRef}
        id="otp"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 6))}
        placeholder=""
        className="w-full rounded-2xl border border-slate-300 px-4 py-3 text-center text-2xl tracking-[0.45em]"
      />
    </div>
  );
}
