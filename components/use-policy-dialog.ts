"use client";

import { useEffect, type RefObject } from "react";

type SavedStyle = { style: CSSStyleDeclaration; property: string; value: string; priority: string };
type ScrollLock = { owners: number; saved: SavedStyle[] };
const pageLocks = new WeakMap<Document, ScrollLock>();

/** Coordinate only these dialogs. Never restore an entire style attribute or
 * erase a later, independently changed overflow declaration. No record writes.
 */
export function acquirePolicyPageScroll(doc: Document): () => void {
  let lock = pageLocks.get(doc);
  if (!lock) {
    const saved: SavedStyle[] = [];
    for (const element of [doc.documentElement, doc.body]) {
      if (!element) continue;
      for (const property of ["overflow-x", "overflow-y"]) {
        saved.push({ style: element.style, property, value: element.style.getPropertyValue(property), priority: element.style.getPropertyPriority(property) });
        element.style.setProperty(property, "hidden", "important");
      }
    }
    lock = { owners: 0, saved };
    pageLocks.set(doc, lock);
  }
  lock.owners += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--lock.owners !== 0) return;
    for (const { style, property, value, priority } of lock.saved) {
      if (style.getPropertyValue(property) !== "hidden" || style.getPropertyPriority(property) !== "important") continue;
      if (value) style.setProperty(property, value, priority);
      else style.removeProperty(property);
    }
    pageLocks.delete(doc);
  };
}

/** Complements native showModal/cancel/close. Those remain owned by the form.
 * Native modality alone does not guarantee page-scroll or Tab-edge containment.
 */
export function usePolicyDialog(dialog: RefObject<HTMLDialogElement | null>, active: boolean) {
  useEffect(() => {
    const element = dialog.current;
    if (!active || !element) return;
    const doc = element.ownerDocument;
    const release = acquirePolicyPageScroll(doc);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented || !element.open) return;
      const targets = Array.from(element.querySelectorAll<HTMLElement>("a[href],button,input,select,textarea,[tabindex]"))
        .filter(target => target.tabIndex >= 0 && !target.matches(":disabled") && !target.closest("[hidden],[inert]") &&
          target.getClientRects().length > 0 && doc.defaultView?.getComputedStyle(target).visibility !== "hidden");
      const first = targets[0], last = targets.at(-1);
      if (!first || !last) {
        event.preventDefault();
        element.focus();
      } else if (event.shiftKey && (doc.activeElement === first || !element.contains(doc.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (doc.activeElement === last || !element.contains(doc.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    element.addEventListener("keydown", onKeyDown, true);
    return () => {
      element.removeEventListener("keydown", onKeyDown, true);
      release();
    };
  }, [active, dialog]);
}
