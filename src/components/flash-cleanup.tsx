"use client";

import { useEffect } from "react";

/** Drops ?flash= from the address bar once shown, so the banner doesn't reappear after later actions or reloads. */
export function FlashCleanup() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("flash")) {
      url.searchParams.delete("flash");
      window.history.replaceState(window.history.state, "", url.pathname + (url.search || "") + url.hash);
    }
  }, []);
  return null;
}
