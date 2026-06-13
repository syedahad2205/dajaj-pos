'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Redirect page shown when users navigate to removed POS routes.
 * Displays a message that POS functionality has moved to the Android app,
 * then auto-redirects to /admin after 3 seconds.
 */
export default function PosMovedRedirect() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          router.replace('/admin');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [router]);

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-lg w-full max-w-md p-8 text-center">
        {/* Icon */}
        <div className="mx-auto w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mb-6">
          <svg
            className="w-8 h-8 text-orange-600"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M10.5 1.5H8.25A2.25 2.25 0 0 0 6 3.75v16.5a2.25 2.25 0 0 0 2.25 2.25h7.5A2.25 2.25 0 0 0 18 20.25V3.75a2.25 2.25 0 0 0-2.25-2.25H13.5m-3 0V3h3V1.5m-3 0h3m-3 18.75h3"
            />
          </svg>
        </div>

        {/* Message */}
        <h1 className="text-xl font-bold text-neutral-900 mb-2">POS Has Moved</h1>
        <p className="text-neutral-600 text-sm leading-relaxed mb-6">
          POS functionality has moved to the <strong>Android application</strong>.
          Please use the Dajaj POS Android app for all cashier and billing operations.
        </p>

        {/* Countdown */}
        <p className="text-xs text-neutral-400 mb-4">
          Redirecting to Admin in {countdown} second{countdown !== 1 ? 's' : ''}…
        </p>

        {/* Immediate redirect button */}
        <button
          onClick={() => router.replace('/admin')}
          className="w-full py-3 bg-orange-600 hover:bg-orange-700 text-white font-semibold rounded-xl text-sm transition-colors"
        >
          Go to Admin
        </button>
      </div>
    </div>
  );
}
