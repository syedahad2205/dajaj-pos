"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createReprintJob,
  createKotPrintJob,
  observePrintJobStatus,
  type PrintJobStatus,
  type PrintJobType,
} from "@/lib/remote-print";

interface RemotePrintButtonProps {
  orderId: string;
  orderNumber: string;
  restaurantId: string;
  jobType: PrintJobType;
}

const STATUS_LABELS: Record<PrintJobStatus, string> = {
  pending: "Pending…",
  processing: "Printing…",
  completed: "Printed",
  failed: "Failed",
};

export function RemotePrintButton({
  orderId,
  orderNumber,
  restaurantId,
  jobType,
}: RemotePrintButtonProps) {
  const [status, setStatus] = useState<PrintJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  // Clean up Firestore listener on unmount
  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, []);

  const handleClick = useCallback(async () => {
    // Don't trigger if already in progress
    if (loading || (status && status !== "completed" && status !== "failed")) {
      return;
    }

    // Reset state for a new job
    setError(null);
    setStatus(null);
    setLoading(true);

    // Clean up any previous listener
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    try {
      const createFn = jobType === "reprint" ? createReprintJob : createKotPrintJob;
      const jobId = await createFn(orderId, orderNumber, restaurantId);

      // Set initial status and subscribe to real-time updates
      setStatus("pending");
      setLoading(false);

      unsubscribeRef.current = observePrintJobStatus(jobId, (newStatus) => {
        setStatus(newStatus);
        // Auto-unsubscribe after terminal states
        if (newStatus === "completed" || newStatus === "failed") {
          setTimeout(() => {
            if (unsubscribeRef.current) {
              unsubscribeRef.current();
              unsubscribeRef.current = null;
            }
          }, 5000);
        }
      });
    } catch (err) {
      setLoading(false);
      setError(err instanceof Error ? err.message : "Failed to create print job");
    }
  }, [orderId, orderNumber, restaurantId, jobType, loading, status]);

  const isInProgress = status === "pending" || status === "processing";
  const isCompleted = status === "completed";
  const isFailed = status === "failed";

  const buttonLabel = jobType === "reprint" ? "Reprint Bill" : "Print KOT";

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading || isInProgress}
        className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
          isFailed
            ? "border border-rose-300 text-rose-700 hover:bg-rose-50"
            : "border border-indigo-300 text-indigo-700 hover:bg-indigo-50"
        }`}
        aria-label={`${buttonLabel} for order ${orderNumber}`}
      >
        {loading ? (
          <span className="inline-flex items-center gap-1.5">
            <Spinner />
            Creating…
          </span>
        ) : (
          buttonLabel
        )}
      </button>

      {status && (
        <span
          className={`inline-flex items-center gap-1 text-xs font-medium ${
            isCompleted
              ? "text-emerald-600"
              : isFailed
                ? "text-rose-600"
                : "text-amber-600"
          }`}
          aria-live="polite"
        >
          {isInProgress && <Spinner />}
          {isCompleted && <CheckIcon />}
          {isFailed && <XIcon />}
          {STATUS_LABELS[status]}
        </span>
      )}

      {error && (
        <span className="text-xs font-medium text-rose-600" role="alert">
          {error}
        </span>
      )}
    </span>
  );
}

function Spinner() {
  return (
    <svg
      className="h-3.5 w-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-3.5 w-3.5"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  );
}
