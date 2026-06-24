"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

type FeedbackAuthContextValue = {
  user: User | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
};

const FeedbackAuthContext = createContext<FeedbackAuthContextValue | null>(null);

export function FeedbackAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const value = useMemo<FeedbackAuthContextValue>(
    () => ({
      user,
      loading,
      signInWithGoogle: async () => {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
      },
      signOutUser: async () => {
        await signOut(auth);
        setUser(null);
      },
    }),
    [user, loading],
  );

  return (
    <FeedbackAuthContext.Provider value={value}>
      {children}
    </FeedbackAuthContext.Provider>
  );
}

export function useFeedbackAuth() {
  const context = useContext(FeedbackAuthContext);
  if (!context) {
    throw new Error("useFeedbackAuth must be used within FeedbackAuthProvider");
  }
  return context;
}
