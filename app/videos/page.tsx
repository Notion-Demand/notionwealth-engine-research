import { Suspense } from "react";
import VideosClient from "./VideosClient";

export default function VideosPage() {
    return (
        <Suspense>
            <VideosClient />
        </Suspense>
    );
}
