"use client";

import dynamic from "next/dynamic";

// Leaflet은 브라우저에서만 동작한다.
const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

export default function Home() {
  return <MapView />;
}
