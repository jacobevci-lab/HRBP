"use client";

import { Columns3, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";

export type EnterpriseColumnOption = { value: string; label: string };

function selectionFromProps(options: EnterpriseColumnOption[], columns: string[], customized: boolean) {
  if (!customized) return options.map((option) => option.value);
  const requested = new Set(columns);
  return options.map((option) => option.value).filter((value) => requested.has(value));
}

export function EnterpriseColumnPicker({
  locale,
  options,
  columns,
  columnsCustomized
}: {
  locale: Locale;
  options: EnterpriseColumnOption[];
  columns: string[];
  columnsCustomized: boolean;
}) {
  const tr = locale === "tr";
  const [selected, setSelected] = useState(() => selectionFromProps(options, columns, columnsCustomized));

  useEffect(() => {
    setSelected(selectionFromProps(options, columns, columnsCustomized));
  }, [columns, columnsCustomized, options]);

  const selectedSet = new Set(selected);
  const customized = selected.length !== options.length;

  return <details className="enterprise-column-picker">
    <input type="hidden" name="columnsMode" value={customized ? "custom" : "default"}/>
    <summary><Columns3 size={14}/><span>{tr ? "Sütunlar" : "Columns"}</span><small aria-live="polite">{selected.length}/{options.length}</small></summary>
    <div className="enterprise-column-options">
      <strong>{tr ? "Görünür sütunlar" : "Visible columns"}</strong>
      <button
        className="enterprise-column-reset"
        type="button"
        disabled={!customized}
        onClick={() => setSelected(options.map((option) => option.value))}
      ><RotateCcw size={12}/>{tr ? "Varsayılan sütunlar" : "Default columns"}</button>
      {options.map((option) => <label key={option.value}>
        <input
          type="checkbox"
          name="columns"
          value={option.value}
          checked={selectedSet.has(option.value)}
          onChange={(event) => {
            setSelected((current) => {
              const next = new Set(current);
              if (event.target.checked) next.add(option.value);
              else next.delete(option.value);
              return options.map((item) => item.value).filter((value) => next.has(value));
            });
          }}
        />
        <span>{option.label}</span>
      </label>)}
      <small>{tr ? "Ana kayıt sütunu her zaman görünür." : "The primary record column is always visible."}</small>
    </div>
  </details>;
}
