import type { DeliveryStatus, OrderStatus } from "@/services/orderService";

export function formatOrderStatusLabel(status: OrderStatus | DeliveryStatus | string) {
  return status.replaceAll("_", " ");
}

export function getDeliveryStatusCopy({
  orderStatus,
  deliveryStatus,
  riderName,
}: {
  orderStatus: OrderStatus;
  deliveryStatus: DeliveryStatus;
  riderName?: string;
}) {
  if (orderStatus === "cancelled") {
    return "This order was cancelled.";
  }

  if (orderStatus === "delivered" || deliveryStatus === "delivered") {
    return "Delivered successfully.";
  }

  if (deliveryStatus === "on_the_way" || orderStatus === "out_for_delivery") {
    return riderName ? `${riderName} is on the way with your order.` : "Your rider is on the way.";
  }

  if (deliveryStatus === "assigned") {
    return riderName ? `${riderName} is assigned to your order.` : "A rider has been assigned to your order.";
  }

  if (orderStatus === "ready") {
    return "Your order is ready for rider pickup.";
  }

  if (orderStatus === "preparing") {
    return "Your order is being prepared.";
  }

  if (orderStatus === "accepted") {
    return "Your order has been accepted.";
  }

  return "Your order is waiting for confirmation.";
}

