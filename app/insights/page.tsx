import { Suspense } from "react";
import InsightsClient from "./InsightsClient";

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsClient />
    </Suspense>
  );
}
