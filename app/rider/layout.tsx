import type { ReactNode } from "react";
import { RiderOrdersProvider } from "@/components/rider/RiderOrdersProvider";

export default function RiderLayout({ children }: { children: ReactNode }) {
  return <RiderOrdersProvider>{children}</RiderOrdersProvider>;
}
