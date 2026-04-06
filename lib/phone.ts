export function normalizePhoneNumber(input: string) {
  const digits = input.replace(/\D/g, "");

  if (digits.length === 10) {
    return `91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }

  return null;
}

export function isValidOtp(value: string) {
  return /^\d{6}$/.test(value);
}
