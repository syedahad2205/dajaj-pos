"use client";

export default function NameForm({
  name,
  dob,
  onNameChange,
  onDobChange,
}: {
  name: string;
  dob: string;
  onNameChange: (value: string) => void;
  onDobChange: (value: string) => void;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium text-slate-700">
          Name
        </label>
        <input
          id="name"
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          className="w-full rounded-2xl border border-slate-300 px-4 py-3"
        />
      </div>
      <div>
        <label htmlFor="dob" className="mb-1 block text-sm font-medium text-slate-700">
          Date of Birth (Optional)
        </label>
        <input
          id="dob"
          type="date"
          value={dob}
          onChange={(event) => onDobChange(event.target.value)}
          className="w-full rounded-2xl border border-slate-300 px-4 py-3"
        />
      </div>
    </div>
  );
}
