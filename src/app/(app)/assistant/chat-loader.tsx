"use client";

import dynamic from "next/dynamic";

/** The chat keeps its conversation in sessionStorage, so it renders in the browser only. */
export const ChatLoader = dynamic(() => import("./chat").then((m) => m.Chat), {
  ssr: false,
  loading: () => <div className="min-h-[calc(100vh-15rem)] animate-pulse rounded-[20px] bg-white" />,
});
