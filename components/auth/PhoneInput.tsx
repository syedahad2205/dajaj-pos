"use client";

export default function PhoneInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="phone" className="mb-1 block text-sm font-medium text-slate-700">
        Phone Number
      </label>
      <input
        id="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="+91 98765 43210"
        className="w-full rounded-2xl border border-slate-300 px-4 py-3"
      />
    </div>
  );
}
