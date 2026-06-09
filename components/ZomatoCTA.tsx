"use client";

import { trackEvent } from "@/lib/analytics";

interface ZomatoCTAProps {
  label?: string;
  className?: string;
  variant?: "primary" | "compact";
}

const ZOMATO_URL = "https://zomato.onelink.me/xqzv/9rjiq535";
const ZOMATO_RED = "#E23744";

export default function ZomatoCTA({
  label = "Order on Zomato",
  className = "",
  variant = "primary",
}: ZomatoCTAProps) {
  const baseStyles =
    variant === "primary"
      ? "rounded-2xl px-6 py-4 text-base font-bold"
      : "rounded-full px-5 py-2.5 text-sm font-semibold";

  return (
    <a
      href={ZOMATO_URL}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => void trackEvent("zomato_cta_click", { variant, label })}
      className={`inline-flex items-center justify-center whitespace-nowrap text-white shadow-sm transition hover:opacity-90 hover:shadow-md active:scale-[0.97] ${baseStyles} ${className}`}
      style={{ backgroundColor: ZOMATO_RED }}
    >
      {label}
    </a>
  );
}
