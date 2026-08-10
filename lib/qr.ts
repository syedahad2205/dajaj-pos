import QRCode from 'qrcode';

/**
 * Renders text (e.g. a UPI payment link) as a QR code PNG data URL.
 * Works in the browser, so it's safe to call from client components
 * and from the react-pdf document builder (which also runs client-side).
 */
export async function generateQrDataUrl(text: string, size = 200): Promise<string> {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
  });
}
