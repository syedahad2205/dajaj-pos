import { redirect } from "next/navigation";

export default function InstaPage() {
  redirect("/?utm_source=instagram&utm_medium=social");
}
