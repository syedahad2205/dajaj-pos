// UPI VPA for the DAJAJ PhonePe merchant QR (Terminal 1-Q026838173), decoded from the printed QR code.
export const UPI_VPA = 'Q026838173@ybl';
export const UPI_PAYEE_NAME = 'DAJAJ';

/**
 * Builds a UPI deep link that pre-fills the payment amount, so scanning the
 * generated QR on a bill takes the customer straight to "confirm & pay"
 * instead of requiring them to type the amount themselves.
 */
export function buildUpiPaymentLink(amount: number, billNo: string): string {
  const params = new URLSearchParams({
    pa: UPI_VPA,
    pn: UPI_PAYEE_NAME,
    am: amount.toFixed(2),
    cu: 'INR',
    tn: `Bill ${billNo}`,
  });
  return `upi://pay?${params.toString()}`;
}
