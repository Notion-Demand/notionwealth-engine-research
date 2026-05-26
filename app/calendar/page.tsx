import { Suspense } from "react";
import CalendarClient from "./CalendarClient";

export const metadata = {
    title: "Earnings Calendar — Quantalyze",
};

export default function CalendarPage() {
    return (
        <Suspense>
            <CalendarClient />
        </Suspense>
    );
}
