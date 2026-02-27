import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ConnectionsClient from "./ConnectionsClient";

export default async function ConnectionsPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) redirect("/login");

  return <ConnectionsClient userId={session.user.id} />;
}
