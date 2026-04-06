import { doc, getDoc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import type { User } from "firebase/auth";
import { firestore } from "@/lib/firebase";

export interface AdminProfile {
  id: string;
  name: string;
  email: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function adminDoc(userId: string) {
  return doc(firestore, "admins", userId);
}

export async function getAdminProfile(userId: string) {
  const snapshot = await getDoc(adminDoc(userId));
  if (!snapshot.exists()) {
    return null;
  }

  return {
    id: snapshot.id,
    ...(snapshot.data() as Omit<AdminProfile, "id">),
  } satisfies AdminProfile;
}

export function subscribeToAdminProfile(userId: string, callback: (profile: AdminProfile | null) => void) {
  return onSnapshot(adminDoc(userId), (snapshot) => {
    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    callback({
      id: snapshot.id,
      ...(snapshot.data() as Omit<AdminProfile, "id">),
    });
  });
}

export async function syncAdminProfile(user: User) {
  const existing = await getAdminProfile(user.uid);
  if (!existing) {
    return null;
  }

  await setDoc(
    adminDoc(user.uid),
    {
      name: existing.name || user.displayName || user.email?.split("@")[0] || "Admin",
      email: existing.email || user.email || "",
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  return existing;
}
