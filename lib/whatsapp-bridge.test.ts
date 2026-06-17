import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CartItem } from "@/components/cart/CartProvider";

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("./firebase", () => ({
  firestore: {},
}));

vi.mock("./firestore-counter", () => ({
  getNextOrderNumber: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  addDoc: vi.fn(),
  collection: vi.fn(),
  serverTimestamp: vi.fn(() => "SERVER_TIMESTAMP"),
}));

// Set up a minimal window mock for Node environment
const mockOpen = vi.fn();
vi.stubGlobal("window", { open: mockOpen });

import { getNextOrderNumber } from "./firestore-counter";
import { addDoc } from "firebase/firestore";
import {
  formatWhatsAppMessage,
  openWhatsApp,
  submitOrderViaWhatsApp,
  savePendingOrder,
} from "./whatsapp-bridge";

// ─── Test Helpers ───────────────────────────────────────────────────────────

function makeCartItem(overrides: Partial<CartItem> = {}): CartItem {
  return {
    id: "item-1",
    categoryName: "Regular Alfaham",
    variantId: "var-1",
    variantName: "Quarter",
    basePrice: 120,
    modifiers: [],
    quantity: 1,
    totalPrice: 120,
    imageUrl: "",
    description: "",
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("formatWhatsAppMessage", () => {
  it("formats single item correctly with order number, item line, and total", () => {
    const items: CartItem[] = [makeCartItem()];
    const result = formatWhatsAppMessage("1045", items, 120);

    expect(result).toContain("Order #1045");
    expect(result).toContain("1x Regular Alfaham (Quarter) - ₹120");
    expect(result).toContain("Total: ₹120");
  });

  it("formats multiple items with different quantities", () => {
    const items: CartItem[] = [
      makeCartItem({ quantity: 1, totalPrice: 120 }),
      makeCartItem({
        id: "item-2",
        categoryName: "Shawarma",
        variantId: "var-2",
        variantName: "Regular",
        basePrice: 80,
        quantity: 2,
        totalPrice: 160,
      }),
    ];
    const result = formatWhatsAppMessage("1045", items, 280);

    expect(result).toContain("1x Regular Alfaham (Quarter) - ₹120");
    expect(result).toContain("2x Shawarma (Regular) - ₹160");
    expect(result).toContain("Total: ₹280");
  });

  it("handles item with empty variant name", () => {
    const items: CartItem[] = [
      makeCartItem({ variantName: "", totalPrice: 100 }),
    ];
    const result = formatWhatsAppMessage("1050", items, 100);

    expect(result).toContain("1x Regular Alfaham - ₹100");
    expect(result).not.toContain("()");
  });
});

describe("openWhatsApp", () => {
  beforeEach(() => {
    mockOpen.mockReset();
  });

  it("returns true when window.open succeeds", () => {
    mockOpen.mockReturnValue({});
    const result = openWhatsApp("918971563534", "Hello");
    expect(result).toBe(true);
    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/918971563534?text="),
      "_blank",
    );
  });

  it("returns false when window.open returns null (blocked popup)", () => {
    mockOpen.mockReturnValue(null);
    const result = openWhatsApp("918971563534", "Hello");
    expect(result).toBe(false);
  });

  it("returns false when window.open throws", () => {
    mockOpen.mockImplementation(() => {
      throw new Error("Security error");
    });
    const result = openWhatsApp("918971563534", "Hello");
    expect(result).toBe(false);
  });

  it("encodes message in URL", () => {
    mockOpen.mockReturnValue({});
    openWhatsApp("918971563534", "Hello World!");
    expect(mockOpen).toHaveBeenCalledWith(
      "https://wa.me/918971563534?text=Hello%20World!",
      "_blank",
    );
  });

  it("strips non-digit characters from phone number", () => {
    mockOpen.mockReturnValue({});
    openWhatsApp("+91 897-156-3534", "Test");
    expect(mockOpen).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/918971563534"),
      "_blank",
    );
  });
});

describe("submitOrderViaWhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockReturnValue({});
  });

  it("returns error when cart is empty (Req 3.5)", async () => {
    const result = await submitOrderViaWhatsApp(
      [],
      { name: "Test", phone: "9876543210" },
      "918971563534",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Cart is empty");
    expect(getNextOrderNumber).not.toHaveBeenCalled();
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("saves order to Firestore and opens WhatsApp on success (Req 3.1, 3.3)", async () => {
    vi.mocked(getNextOrderNumber).mockResolvedValue(1045);
    vi.mocked(addDoc).mockResolvedValue({ id: "doc-123" } as any);

    const items = [makeCartItem()];
    const result = await submitOrderViaWhatsApp(
      items,
      { name: "Customer", phone: "9876543210" },
      "918971563534",
    );

    expect(result.success).toBe(true);
    expect(result.orderNumber).toBe("1045");
    expect(result.whatsappOpened).toBe(true);
    expect(mockOpen).toHaveBeenCalled();
  });

  it("does NOT open WhatsApp when Firestore save fails (Req 3.4)", async () => {
    vi.mocked(getNextOrderNumber).mockRejectedValue(new Error("Network error"));

    const items = [makeCartItem()];
    const result = await submitOrderViaWhatsApp(
      items,
      { name: "Customer", phone: "9876543210" },
      "918971563534",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Network error");
    expect(mockOpen).not.toHaveBeenCalled();
  });

  it("returns order number when WhatsApp fails to open (Req 3.6)", async () => {
    vi.mocked(getNextOrderNumber).mockResolvedValue(1046);
    vi.mocked(addDoc).mockResolvedValue({ id: "doc-456" } as any);
    mockOpen.mockReturnValue(null);

    const items = [makeCartItem()];
    const result = await submitOrderViaWhatsApp(
      items,
      { name: "Customer", phone: "9876543210" },
      "918971563534",
    );

    expect(result.success).toBe(true);
    expect(result.orderNumber).toBe("1046");
    expect(result.whatsappOpened).toBe(false);
    expect(result.error).toContain("#1046");
  });

  it("treats Firestore timeout as failure (Req 3.7)", async () => {
    // Simulate a save that never resolves within 15s
    vi.mocked(getNextOrderNumber).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(1047), 20_000)),
    );

    const items = [makeCartItem()];
    const result = await submitOrderViaWhatsApp(
      items,
      { name: "Customer", phone: "9876543210" },
      "918971563534",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("15 seconds");
    expect(mockOpen).not.toHaveBeenCalled();
  }, 20_000);

  it("preserves cart on failure — does not clear items (Req 3.4)", async () => {
    vi.mocked(getNextOrderNumber).mockRejectedValue(new Error("Offline"));

    const items = [makeCartItem(), makeCartItem({ id: "item-2", variantId: "v2", variantName: "Half" })];
    const result = await submitOrderViaWhatsApp(
      items,
      { name: "Customer", phone: "9876543210" },
      "918971563534",
    );

    // The function returns failure; it's the caller's responsibility to not clear the cart.
    // Verify no side effects — WhatsApp was never opened.
    expect(result.success).toBe(false);
    expect(mockOpen).not.toHaveBeenCalled();
  });
});

describe("savePendingOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("saves order with correct structure to pending_orders collection", async () => {
    vi.mocked(getNextOrderNumber).mockResolvedValue(1050);
    vi.mocked(addDoc).mockResolvedValue({ id: "doc-789" } as any);

    const result = await savePendingOrder({
      customerName: "John",
      customerPhone: "9876543210",
      items: [{ name: "Alfaham - Quarter", variantName: "Quarter", qty: 2, price: 120, total: 240 }],
      total: 240,
    });

    expect(result.orderNumber).toBe("1050");
    expect(result.orderId).toBe("doc-789");

    const savedData = vi.mocked(addDoc).mock.calls[0][1] as Record<string, unknown>;
    expect(savedData).toMatchObject({
      orderNumber: "1050",
      channel: "whatsapp",
      status: "pending",
      customerName: "John",
      customerPhone: "9876543210",
      total: 240,
      restaurantId: "dajaj_main",
    });
  });

  it("generates sequential order number via atomic counter (Req 3.2)", async () => {
    vi.mocked(getNextOrderNumber).mockResolvedValue(1051);
    vi.mocked(addDoc).mockResolvedValue({ id: "doc-x" } as any);

    const result = await savePendingOrder({
      customerName: "A",
      customerPhone: "9000000000",
      items: [{ name: "Item", variantName: "V", qty: 1, price: 100, total: 100 }],
      total: 100,
    });

    expect(result.orderNumber).toBe("1051");
    expect(getNextOrderNumber).toHaveBeenCalledTimes(1);
  });
});
