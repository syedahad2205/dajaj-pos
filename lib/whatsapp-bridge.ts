import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { firestore } from "./firebase";
import { getNextOrderNumber } from "./firestore-counter";
import type { CartItem } from "@/components/cart/CartProvider";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CustomerInfo {
  name: string;
  phone: string;
}

export interface PendingOrderItem {
  name: string;
  qty: number;
  price: number;
  total: number;
}

export interface PendingOrderData {
  customerName: string;
  customerPhone: string;
  items: PendingOrderItem[];
  total: number;
  notes?: string;
}

export interface SaveOrderResult {
  orderNumber: string;
  orderId: string;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Saves a pending order to Firestore `pending_orders` collection.
 * Generates a unique sequential order number via atomic counter transaction.
 * Returns the order number and document ID on success.
 */
export async function savePendingOrder(
  orderData: PendingOrderData,
): Promise<SaveOrderResult> {
  const orderNumber = await getNextOrderNumber();
  const orderNumberStr = String(orderNumber);

  const docRef = await addDoc(collection(firestore, "pending_orders"), {
    restaurantId: "dajaj_main",
    orderNumber: orderNumberStr,
    channel: "whatsapp",
    status: "pending",
    customerName: orderData.customerName,
    customerPhone: orderData.customerPhone,
    items: orderData.items,
    total: orderData.total,
    notes: orderData.notes || "",
    rejectionReason: null,
    createdAt: serverTimestamp(),
    processedAt: null,
  });

  return {
    orderNumber: orderNumberStr,
    orderId: docRef.id,
  };
}

/**
 * Formats the WhatsApp pre-filled message with order details.
 * Includes order number, itemized list with quantities and prices, and total.
 */
export function formatWhatsAppMessage(
  orderNumber: string,
  items: CartItem[],
  total: number,
): string {
  const itemLines = items.map(
    (item) => `${item.quantity}x ${item.categoryName} - ${item.variantName} — ₹${item.totalPrice}`,
  );

  const message = [
    `🍗 *DAJAJ Order #${orderNumber}*`,
    "",
    ...itemLines,
    "",
    `*Total: ₹${total}*`,
    "",
    "Please confirm this order. Thank you!",
  ].join("\n");

  return message;
}

/**
 * Opens WhatsApp with a pre-filled message using the wa.me deep link.
 * The phone number should include country code (e.g., "919876543210").
 */
export function openWhatsApp(phoneNumber: string, message: string): void {
  const cleanPhone = phoneNumber.replace(/\D/g, "");
  const encodedMessage = encodeURIComponent(message);
  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
  window.open(whatsappUrl, "_blank");
}

/**
 * Orchestrates the full WhatsApp order submission flow:
 * 1. Validates cart is not empty
 * 2. Saves order to Firestore pending_orders collection
 * 3. Formats the WhatsApp message
 * 4. Opens WhatsApp with the pre-filled message
 *
 * If save fails, throws an error — caller should display error and preserve cart.
 * WhatsApp is ONLY opened after a successful Firestore save.
 */
export async function submitOrderViaWhatsApp(
  cartItems: CartItem[],
  customerInfo: CustomerInfo,
  restaurantPhoneNumber: string,
): Promise<void> {
  // Block submission if cart is empty
  if (cartItems.length === 0) {
    throw new Error("Cart is empty. Add items before placing an order.");
  }

  // Map CartItems to PendingOrderItems for Firestore
  const pendingItems: PendingOrderItem[] = cartItems.map((item) => ({
    name: `${item.categoryName} - ${item.variantName}`,
    qty: item.quantity,
    price: item.basePrice + item.modifiers.reduce((sum, mod) => sum + mod.price, 0),
    total: item.totalPrice,
  }));

  const total = cartItems.reduce((sum, item) => sum + item.totalPrice, 0);

  // Save to Firestore FIRST — do NOT open WhatsApp until this succeeds
  const { orderNumber } = await savePendingOrder({
    customerName: customerInfo.name,
    customerPhone: customerInfo.phone,
    items: pendingItems,
    total,
  });

  // Format message and open WhatsApp only after successful save
  const message = formatWhatsAppMessage(orderNumber, cartItems, total);
  openWhatsApp(restaurantPhoneNumber, message);
}
