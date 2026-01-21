/**
 * Send bill link via WhatsApp
 * Opens WhatsApp with pre-filled message containing bill details and link
 */
export function sendBillOnWhatsApp({
  mobile,
  billNo,
  grandTotal,
  publicToken
}: {
  mobile: string;
  billNo: string;
  grandTotal: number;
  publicToken: string;
}) {
  // Validate mobile number (should be 10 digits)
  const cleanMobile = mobile.replace(/^\+91/, '').replace(/^91/, '').replace(/\D/g, '');
  
  if (cleanMobile.length !== 10) {
    alert('Invalid mobile number. Please enter a 10-digit mobile number.');
    return;
  }

  if (!billNo) {
    alert('Bill number is required');
    return;
  }

  if (!publicToken) {
    alert('Bill token is required');
    return;
  }

  // Get base URL - prefer NEXT_PUBLIC_APP_URL, fallback to window.location.origin
  const baseUrl = 
    (typeof window !== 'undefined' && process.env.NEXT_PUBLIC_APP_URL) 
      ? process.env.NEXT_PUBLIC_APP_URL 
      : (typeof window !== 'undefined' ? window.location.origin : '');

  // Include token in bill URL
  const billUrl = `${baseUrl}/bill/${billNo}?token=${publicToken}`;

  // Format message exactly as specified
  const message = `Thank you for ordering from DAJAJ 🍗
Bill No: ${billNo}
Total: ₹${grandTotal.toFixed(2)}

View & Download Bill:
${billUrl}`;

  // Encode message for URL
  const encodedMessage = encodeURIComponent(message);

  // Open WhatsApp in new tab
  const whatsappUrl = `https://wa.me/91${cleanMobile}?text=${encodedMessage}`;
  window.open(whatsappUrl, '_blank');
}

