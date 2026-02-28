"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut, BarChart2, Settings } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function Nav() {
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
  }

  return (
    <nav className="border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/dashboard" className="font-semibold text-gray-900 text-sm">
          Quantalyze
        </Link>
        <Link
          href="/dashboard"
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <BarChart2 size={15} />
          Dashboard
        </Link>
        <Link
          href="/settings/connections"
          className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <Settings size={15} />
          Connections
        </Link>
      </div>
      <button
        onClick={signOut}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
      >
        <LogOut size={15} />
        Sign out
      </button>
    </nav>
  );
}
