import { FeedbackAuthProvider } from "@/components/auth/FeedbackAuthProvider";
import type { ReactNode } from "react";

export const metadata = {
  title: "Help Us Improve – Dajaj",
  description: "Share your feedback with the Dajaj team.",
};

export default function FeedbackLayout({ children }: { children: ReactNode }) {
  return <FeedbackAuthProvider>{children}</FeedbackAuthProvider>;
}
