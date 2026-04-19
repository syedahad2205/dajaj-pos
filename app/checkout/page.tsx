"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requireCustomer } from "@/lib/roleGuard";
import { useCart } from "@/components/cart/CartProvider";
import { useAddresses } from "@/components/address/AddressProvider";
import AddressSelector from "@/components/address/AddressSelector";
import { calculateDeliveryFee } from "@/lib/delivery";
import { paymentMethods } from "@/lib/paymentMethods";
import { createOrder } from "@/services/orderService";
import { getDefaultDeliverySettings, getDeliverySettings, type DeliverySettings } from "@/services/deliveryService";

export default function CheckoutPage() {
  const router = useRouter();
  const { authenticated, loading, role, customerPhone, customer } = requireCustomer();
  const { items, subtotal, clearCart, incrementItem, decrementItem, removeItem, itemCount } = useCart();
  const { selectedAddress } = useAddresses();
  const [settings, setSettings] = useState<DeliverySettings>(getDefaultDeliverySettings());
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState("cod");
  const [addressSelectorOpen, setAddressSelectorOpen] = useState(false);
  const [placingOrder, setPlacingOrder] = useState(false);
  const [error, setError] = useState("");
  const placingOrderRef = useRef(false);

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    let cancelled = false;
    void getDeliverySettings()
      .then((nextSettings) => {
        if (cancelled) {
          return;
        }

        setSettings(nextSettings);
      })
      .catch((deliveryError) => {
        if (cancelled) {
          return;
        }

        console.error("Failed to load delivery settings:", deliveryError);
      });

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  const deliveryResult = useMemo(() => {
    if (!selectedAddress) {
      return null;
    }

    return calculateDeliveryFee(
      selectedAddress.latitude,
      selectedAddress.longitude,
      settings.restaurantLocation.lat,
      settings.restaurantLocation.lng,
      settings.deliveryZones,
    );
  }, [selectedAddress, settings]);

  const deliveryFee = deliveryResult?.fee ?? 0;
  const total = subtotal + deliveryFee;
  const remainingToMinimum = Math.max(0, settings.minimumOrder - subtotal);

  const checkoutState = useMemo(() => {
    if (items.length === 0) {
      return {
        canPlaceOrder: false,
        message: "Add items to your order to continue.",
      };
    }

    if (!selectedAddress) {
      return {
        canPlaceOrder: false,
        message: "Choose a delivery address to continue.",
      };
    }

    if (!selectedAddress.latitude || !selectedAddress.longitude) {
      return {
        canPlaceOrder: false,
        message: "Please select location on the map.",
      };
    }

    if (!deliveryResult) {
      return {
        canPlaceOrder: false,
        message: "Sorry, this address is outside our delivery range.",
      };
    }

    if (remainingToMinimum > 0) {
      return {
        canPlaceOrder: false,
        message: `Minimum order for delivery is ₹${settings.minimumOrder}. Add ₹${remainingToMinimum} more to continue.`,
      };
    }

    return {
      canPlaceOrder: true,
      message: "",
    };
  }, [deliveryResult, items.length, remainingToMinimum, selectedAddress, settings.minimumOrder]);

  useEffect(() => {
    if (!error) {
      return;
    }

    setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps -- omit `error`; only re-run when cart / address / payment context changes
  }, [itemCount, selectedAddress, selectedPaymentMethod, subtotal]);

  if (loading) {
    return <main className="min-h-screen bg-[#fff8ed] px-4 py-10">Checking your session...</main>;
  }

  if (!authenticated || role !== "customer") {
    return null;
  }

  return (
    <main className="min-h-screen bg-[#fff8ed] px-4 py-8 text-slate-900">
      <div className="mx-auto max-w-3xl space-y-4">
        <header className="rounded-[28px] border border-orange-200 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={() => {
              if (window.history.length > 1) {
                router.back();
                return;
              }

              router.push("/menu");
            }}
            className="mb-4 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700"
          >
            Back to Menu
          </button>
          <h1 className="text-3xl font-black">Checkout</h1>
          <p className="mt-2 text-sm text-slate-600">Review your order, choose your delivery address, and place it when you are ready.</p>
        </header>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-black">Delivery Address</h2>
              {selectedAddress ? (
                <div className="mt-3 space-y-1 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">{selectedAddress.label}</p>
                  <p>{selectedAddress.addressLine1}</p>
                  <p>{selectedAddress.addressLine2}</p>
                  {selectedAddress.landmark ? <p>Near {selectedAddress.landmark}</p> : null}
                </div>
              ) : (
                <p className="mt-3 text-sm text-rose-600">Choose a delivery address to continue.</p>
              )}
            </div>
            <button type="button" onClick={() => setAddressSelectorOpen(true)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700">
              {selectedAddress ? "Change" : "Choose Address"}
            </button>
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black">Order Summary</h2>
          <div className="mt-4 space-y-3">
            {items.length === 0 ? (
              <p className="text-sm text-slate-500">Your cart is empty.</p>
            ) : (
              items.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-bold text-slate-900">{item.categoryName}</p>
                      <p className="text-sm text-slate-500">{item.variantName}</p>
                      {item.modifiers.length > 0 ? <p className="mt-2 text-xs text-slate-400">{item.modifiers.map((modifier) => modifier.name).join(" • ")}</p> : null}
                    </div>
                    <span className="font-black text-slate-900">₹{item.totalPrice}</span>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => decrementItem(item.id)}
                        className="h-10 w-10 rounded-full border border-slate-300 text-lg font-bold text-slate-700"
                      >
                        −
                      </button>
                      <span className="w-8 text-center text-base font-bold text-slate-900">{item.quantity}</span>
                      <button
                        type="button"
                        onClick={() => incrementItem(item.id)}
                        className="h-10 w-10 rounded-full border border-slate-300 text-lg font-bold text-slate-700"
                      >
                        +
                      </button>
                    </div>

                    <button type="button" onClick={() => removeItem(item.id)} className="text-sm font-semibold text-rose-600">
                      Remove
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black">Delivery Fee</h2>
          {!selectedAddress ? (
            <p className="mt-3 text-sm text-slate-500">Choose an address to calculate delivery.</p>
          ) : deliveryResult ? (
            <div className="mt-3 space-y-1 text-sm text-slate-600">
              <p>Distance: {deliveryResult.distanceKm.toFixed(2)} km</p>
              <p>Delivery fee: ₹{deliveryFee}</p>
              <p>Minimum order: ₹{settings.minimumOrder}</p>
              {remainingToMinimum > 0 ? <p className="font-medium text-amber-700">Add ₹{remainingToMinimum} more to reach the minimum order.</p> : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-rose-600">Sorry, this address is outside our delivery range.</p>
          )}
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-black">Payment Method</h2>
          <div className="mt-4 space-y-3">
            {paymentMethods.filter((method) => method.enabled).map((method) => (
              <label key={method.id} className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                <span className="font-semibold text-slate-800">{method.name}</span>
                <input
                  type="radio"
                  name="paymentMethod"
                  checked={selectedPaymentMethod === method.id}
                  onChange={() => setSelectedPaymentMethod(method.id)}
                />
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="space-y-2 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>Items total</span>
              <span>₹{subtotal}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Delivery fee</span>
              <span>₹{deliveryFee}</span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-lg font-black text-slate-900">
              <span>Total</span>
              <span>₹{total}</span>
            </div>
          </div>

          {!checkoutState.canPlaceOrder && checkoutState.message ? <p className="mt-4 text-sm font-medium text-amber-700">{checkoutState.message}</p> : null}
          {error ? <p className="mt-4 text-sm font-medium text-rose-600">{error}</p> : null}

          <button
            type="button"
            disabled={placingOrder || !checkoutState.canPlaceOrder}
            onClick={async () => {
              if (placingOrderRef.current) {
                return;
              }

              if (!checkoutState.canPlaceOrder) {
                setError(checkoutState.message);
                return;
              }

              if (!selectedAddress) {
                setError("Please choose a delivery address.");
                return;
              }

              if (!customerPhone) {
                setError("Please log in again.");
                return;
              }

              placingOrderRef.current = true;
              setPlacingOrder(true);
              setError("");
              try {
                const orderId = await createOrder({
                  userId: customerPhone,
                  customerName: customer?.name || selectedAddress.name,
                  customerPhone: customerPhone,
                  items,
                  subtotal,
                  deliveryFee,
                  total,
                  address: selectedAddress,
                  location: {
                    lat: selectedAddress.latitude,
                    lng: selectedAddress.longitude,
                  },
                  paymentMethod: selectedPaymentMethod as "cod",
                });
                clearCart();
                router.push(`/order-success?orderId=${orderId}`);
              } catch (checkoutError) {
                setError(checkoutError instanceof Error ? checkoutError.message : "Failed to place your order.");
              } finally {
                placingOrderRef.current = false;
                setPlacingOrder(false);
              }
            }}
            className="mt-6 w-full rounded-2xl bg-orange-600 px-5 py-4 text-lg font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {placingOrder ? "Placing Order..." : "Place Order"}
          </button>
        </section>
      </div>

      <AddressSelector open={addressSelectorOpen} onClose={() => setAddressSelectorOpen(false)} />
    </main>
  );
}
