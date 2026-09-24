"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BriefcaseBusiness, Command, LayoutGrid, Search, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "@/components/locale-provider";
import { useSessionContext } from "@/components/session-provider";

type SearchItem = {
  type: "module" | "person" | "position";
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

type SearchResponse = { data?: SearchItem[]; degraded?: boolean };

function ResultIcon({ type }: { type: SearchItem["type"] }) {
  if (type === "person") return <UserRound size={16}/>;
  if (type === "position") return <BriefcaseBusiness size={16}/>;
  return <LayoutGrid size={16}/>;
}

export function GlobalSearch() {
  const router = useRouter();
  const { locale, t } = useLocale();
  const { session, loading: sessionLoading } = useSessionContext();
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const publicStaging = !sessionLoading && !session?.authenticated;
  const searchLabel = publicStaging ? (locale === "tr" ? "Modüllerde ara…" : "Search modules…") : t("shell.search");

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onShortcut);
    return () => window.removeEventListener("keydown", onShortcut);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setItems([]);
      setLoading(false);
      setDegraded(false);
      setActiveIndex(0);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(normalized)}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as SearchResponse;
        setItems(body.data ?? []);
        setDegraded(Boolean(body.degraded));
        setActiveIndex(0);
        setOpen(true);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setItems([]);
          setDegraded(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const statusText = useMemo(() => {
    if (query.trim().length < 2) return publicStaging
      ? (locale === "tr" ? "Staging modüllerini aramak için en az 2 karakter yaz." : "Type at least 2 characters to search staging modules.")
      : (locale === "tr" ? "Aramak için en az 2 karakter yaz." : "Type at least 2 characters to search.");
    if (loading) return locale === "tr" ? "Aranıyor…" : "Searching…";
    if (!items.length) return locale === "tr" ? "Eşleşme bulunamadı." : "No matches found.";
    return degraded ? (locale === "tr" ? "Canlı veri sınırlı; modül sonuçları gösteriliyor." : "Live data is limited; module results are shown.") : null;
  }, [degraded, items.length, loading, locale, publicStaging, query]);

  function choose(item: SearchItem) {
    setOpen(false);
    setQuery("");
    router.push(item.href);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) setOpen(true);
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((value) => (value + 1) % items.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((value) => (value - 1 + items.length) % items.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(items[Math.min(activeIndex, items.length - 1)]);
    }
  }

  const activeDescendant = open && items.length ? `global-search-option-${activeIndex}` : undefined;

  return (
    <div className="global-search-root" ref={rootRef}>
      <div className={`global-search ${open ? "is-open" : ""}`}>
        <Search size={17}/>
        <input
          ref={inputRef}
          role="combobox"
          aria-autocomplete="list"
          value={query}
          placeholder={searchLabel}
          aria-label={searchLabel}
          aria-expanded={open}
          aria-controls="global-search-results"
          aria-activedescendant={activeDescendant}
          onFocus={() => setOpen(true)}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {query ? <button className="global-search-clear" type="button" aria-label={locale === "tr" ? "Aramayı temizle" : "Clear search"} onClick={() => { setQuery(""); inputRef.current?.focus(); }}><X size={14}/></button> : <kbd><Command size={12}/> K</kbd>}
      </div>

      {open ? (
        <div className="global-search-menu" id="global-search-results" role="listbox">
          {statusText ? <div className={`global-search-state ${degraded ? "degraded" : ""}`} aria-live="polite">{statusText}</div> : null}
          {items.map((item, index) => (
            <Link
              key={`${item.type}:${item.id}`}
              id={`global-search-option-${index}`}
              href={item.href}
              role="option"
              aria-selected={index === activeIndex}
              className={`global-search-result ${index === activeIndex ? "active" : ""}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => { setOpen(false); setQuery(""); }}
            >
              <span className="global-search-result-icon"><ResultIcon type={item.type}/></span>
              <span className="global-search-result-copy"><strong>{item.title}</strong><small>{item.subtitle}</small></span>
              <em>{item.type === "module" ? (locale === "tr" ? "Modül" : "Module") : item.type === "person" ? (locale === "tr" ? "Çalışan" : "Person") : (locale === "tr" ? "Pozisyon" : "Position")}</em>
            </Link>
          ))}
          {items.length ? <div className="global-search-hints"><span>↑↓ {locale === "tr" ? "Gezin" : "Navigate"}</span><span>↵ {locale === "tr" ? "Aç" : "Open"}</span><span>Esc {locale === "tr" ? "Kapat" : "Close"}</span></div> : null}
        </div>
      ) : null}
    </div>
  );
}
