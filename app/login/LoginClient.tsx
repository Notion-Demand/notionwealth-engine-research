"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginClient() {
  const searchParams = useSearchParams();

  const urlError = searchParams.get("error");
  const initialError =
    urlError === "AccessDenied"
      ? "Access is by invitation only. Contact us to request access."
      : urlError
      ? "Authentication failed. Please try again."
      : null;

  const [error, setError] = useState<string | null>(initialError);
  const [loading, setLoading] = useState(false);

  async function handleSignIn() {
    setError(null);
    setLoading(true);
    try {
      await signIn("microsoft-entra-id", { callbackUrl: "/dashboard" });
    } catch {
      setError("Authentication failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-bold tracking-tight">
          Quantalyze
        </h1>
        <p className="mb-8 text-center text-sm text-gray-500">
          Earnings Concall Analysis
        </p>

        {error && <p className="mb-4 text-center text-sm text-red-600">{error}</p>}

        <button
          onClick={handleSignIn}
          disabled={loading}
          className="w-full rounded-md bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? "Please wait…" : "Sign in"}
        </button>

        <p className="mt-6 text-center text-sm text-gray-400">
          Access is by invitation only.
        </p>
      </div>
    </div>
  );
}
