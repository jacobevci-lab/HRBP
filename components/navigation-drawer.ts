"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Follow the existing CSS breakpoint through the visible trigger rather than
 * maintaining a second, potentially different numeric breakpoint in JS. */
export function useNavigationDrawer(pathname: string) {
  const sidebarRef = useRef<HTMLElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [mobile, setMobile] = useState(false);
  const [requestedOpen, setRequestedOpen] = useState(false);
  const restoreFocus = useRef(false);
  const open = mobile && requestedOpen;

  const close = useCallback((restore = true) => {
    restoreFocus.current = restore;
    setRequestedOpen(false);
  }, []);
  const show = useCallback(() => {
    if (toggleRef.current && getComputedStyle(toggleRef.current).display !== "none") {
      setMobile(true);
      setRequestedOpen(true);
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const visible = !!toggleRef.current && getComputedStyle(toggleRef.current).display !== "none";
      setMobile(visible);
      if (!visible) { restoreFocus.current = false; setRequestedOpen(false); }
    };
    sync();
    window.addEventListener("resize", sync);
    // CSS can change after hydration without a window resize.
    const observer = new ResizeObserver(sync);
    if (toggleRef.current) observer.observe(toggleRef.current);
    return () => { window.removeEventListener("resize", sync); observer.disconnect(); };
  }, []);

  useEffect(() => { close(false); }, [pathname, close]);

  useEffect(() => {
    const sidebar = sidebarRef.current, main = mainRef.current, toggle = toggleRef.current;
    if (!sidebar || !main) return;
    const oldSidebarInert = sidebar.inert, oldMainInert = main.inert;
    sidebar.inert = mobile && !open;
    main.inert = open || oldMainInert;
    const resetInert = () => { sidebar.inert = oldSidebarInert; main.inert = oldMainInert; };
    if (!open) {
      if (restoreFocus.current && mobile) toggle?.focus({ preventScroll: true });
      restoreFocus.current = false;
      return resetInert;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const candidates = () => [...sidebar.querySelectorAll<HTMLElement>(
      'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]'
    )].filter(element => element.tabIndex >= 0 && !element.closest('[inert]') &&
      element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden");
    const focusFirst = () => (sidebar.querySelector<HTMLButtonElement>(".mobile-close") ?? candidates()[0])?.focus({ preventScroll: true });
    focusFirst();
    // An opening render can precede style/visibility settlement. Retry on the
    // next frame only if focus has not entered the drawer; cancel on close.
    const focusFrame = requestAnimationFrame(() => {
      if (!sidebar.contains(document.activeElement)) focusFirst();
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation(); close(); return;
      }
      if (event.key !== "Tab") return;
      const items = candidates(), first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      const focused = document.activeElement;
      if (!sidebar.contains(focused) || (event.shiftKey && focused === first) || (!event.shiftKey && focused === last)) {
        event.preventDefault(); (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    };
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !sidebar.contains(event.target)) focusFirst();
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocus);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("focusin", onFocus);
      document.body.style.overflow = previousOverflow;
      resetInert();
    };
  }, [mobile, open, close]);

  return { open, show, close, sidebarRef, mainRef, toggleRef };
}
