export const paymentMethods = [
  {
    id: "cod",
    name: "Pay on Delivery",
    enabled: true,
  },
  {
    id: "razorpay",
    name: "Online Payment",
    enabled: false,
  },
] as const;

export type PaymentMethodId = (typeof paymentMethods)[number]["id"];
