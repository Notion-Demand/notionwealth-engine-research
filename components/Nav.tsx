"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { LogOut, BarChart2, BarChart3, TrendingUp, Settings, Inbox } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import clsx from "clsx";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: BarChart2 },
  { href: "/screener", label: "Screener", icon: TrendingUp },
  { href: "/kpis", label: "KPIs", icon: BarChart3 },
  { href: "/request", label: "Request", icon: Inbox },
  { href: "/settings/connections", label: "Connections", icon: Settings },
];

export default function Nav() {
  const router = useRouter();
  const pathname = usePathname();
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
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-1.5 text-sm transition-colors",
                active
                  ? "text-gray-900 font-medium border-b-2 border-gray-900 pb-[1px]"
                  : "text-gray-500 hover:text-gray-900"
              )}
            >
              <Icon size={15} />
              {label}
            </Link>
          );
        })}
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
