"use client";

import { useCallback, useRef, useState } from "react";

/** Shared toast-queue hook — every dashboard shell renders <Toast/> reading from this. */
export function useToast() {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const flash = useCallback((msg: string) => {
    setMessage(msg);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(""), 2600);
  }, []);

  return { message, flash };
}
