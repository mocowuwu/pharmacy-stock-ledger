"use client";

import { useActionState } from "react";
import { useState, useEffect, useRef, useCallback } from "react";
import { createPanelEntryAction, type PanelFormState } from "./actions";
import { useTranslations } from "next-intl";
import { format } from "date-fns";

interface SearchItem {
  id: string;
  code: string;
  genericName: string;
  brandName: string | null;
  form: string;
  strength: string | null;
  unit: string;
  packSize: number | null;
  drugClass: string;
  defaultPrice: number;
}

export function PanelForm({ defaultDate }: { defaultDate: string }) {
  const t = useTranslations("panel");
  const [state, formAction, isPending] = useActionState<PanelFormState, FormData>(
    createPanelEntryAction,
    { error: undefined, success: undefined }
  );

  const today = format(new Date(), "yyyy-MM-dd");
  const entryDate = defaultDate > today ? today : defaultDate;

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchItem[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SearchItem | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [unitValue, setUnitValue] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search
  const handleSearch = useCallback(async (query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      if (!query || query.trim().length < 2) {
        setSearchResults([]);
        setShowResults(false);
        return;
      }

      setIsSearching(true);
      try {
        const res = await fetch(`/api/panel/search-items?q=${encodeURIComponent(query)}&limit=10`);
        const data = await res.json();
        if (data.items) {
          setSearchResults(data.items);
          setShowResults(true);
        }
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);
  }, []);

  // Handle item selection
  const selectItem = (item: SearchItem) => {
    setSelectedItem(item);
    setSearchQuery(item.genericName + (item.brandName ? ` (${item.brandName})` : ""));
    setUnitValue(item.unit || "");
    setShowResults(false);
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedItem(null);
    setSearchQuery("");
    setUnitValue("");
  };

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchInputRef.current && !searchInputRef.current.contains(e.target as Node) &&
          resultsRef.current && !resultsRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Determine form values (from selected item or manual entry)
  const itemCode = selectedItem?.code || "";
  const itemName = selectedItem?.genericName + (selectedItem?.brandName ? ` ${selectedItem.brandName}` : "") || "";
  // Use controlled unitValue state, fallback to selected item's unit
  const effectiveUnit = unitValue || selectedItem?.unit || "";
  const itemForm = selectedItem?.form || "";
  const itemStrength = selectedItem?.strength || "";

  // Display value for search input - show readable name when item selected
  const displaySearchValue = selectedItem
    ? selectedItem.genericName + (selectedItem.brandName ? ` (${selectedItem.brandName})` : "")
    : searchQuery;

  return (
    <form action={formAction} className="space-y-4 p-4 bg-surface-2 rounded-xl border border-rule">
      <h2 className="text-sm font-semibold text-ink">{t("newEntry")}</h2>
      <p className="text-xs text-muted">{t("newEntryHint")}</p>

      {state.error && (
        <div className="rounded-lg bg-critical-soft p-3 text-sm text-critical-ink" role="alert">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="rounded-lg bg-positive-soft p-3 text-sm text-positive-ink" role="status">
          {t("saved")}
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label htmlFor="entryDate" className="block text-xs font-medium text-muted mb-1">
            {t("entryDate")}
          </label>
          <input
            type="date"
            id="entryDate"
            name="entryDate"
            value={entryDate}
            max={today}
            className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
            required
          />
        </div>

        {/* Searchable Item Field */}
        <div>
          <label className="block text-xs font-medium text-muted mb-1">
            {t("itemSearch")}
          </label>
          <div className="relative">
            <input
              ref={searchInputRef}
              type="text"
              id="itemSearch"
              value={displaySearchValue}
              onChange={(e) => {
                const value = e.target.value;
                setSearchQuery(value);
                handleSearch(value);
                // Clear selected item when user types something different
                if (selectedItem && value !== displaySearchValue) {
                  clearSelection();
                }
              }}
              onFocus={() => !selectedItem && searchQuery.trim().length >= 2 && setShowResults(true)}
              onBlur={() => setTimeout(() => setShowResults(false), 200)}
              placeholder={t("itemSearchPlaceholder")}
              className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent pr-10"
              autoComplete="off"
              required
            />
            {isSearching && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true">
                ⏳
              </span>
            )}
            {selectedItem && !isSearching && (
              <button
                type="button"
                onClick={clearSelection}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-ink"
                aria-label={t("clearSelection")}
              >
                ✕
              </button>
            )}
          </div>

          {/* Search Results Dropdown */}
          {showResults && searchResults.length > 0 && (
            <div
              ref={resultsRef}
              className="absolute z-10 mt-1 w-full max-h-60 overflow-y-auto rounded-lg border border-rule bg-surface shadow-lg"
              role="listbox"
            >
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => selectItem(item)}
                  className="w-full text-left px-3 py-2 hover:bg-accent-soft/20 focus:bg-accent-soft/20 focus:outline-none focus:ring-2 focus:ring-accent"
                  role="option"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-ink font-medium">{item.code}</span>
                    <span className="text-sm text-ink flex-1 truncate">
                      {item.genericName}
                      {item.brandName && <span className="text-muted"> ({item.brandName})</span>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-muted">
                    <span className="font-mono">{item.form}</span>
                    {item.strength && <span>• {item.strength}</span>}
                    <span>• {item.unit}</span>
                    <span className="px-1.5 py-0.5 rounded text-[0.6rem] font-medium uppercase bg-accent-soft/20 text-accent">
                      {item.drugClass}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {showResults && searchResults.length === 0 && searchQuery.trim().length >= 2 && !isSearching && (
            <div className="absolute z-10 mt-1 w-full rounded-lg border border-rule bg-surface p-3 text-center text-sm text-muted">
              {t("noResults")}
            </div>
          )}

          {/* Hidden inputs for form submission */}
          <input type="hidden" name="itemCode" value={itemCode} />
          <input type="hidden" name="itemName" value={itemName} />
          <input type="hidden" name="unit" value={effectiveUnit} />
        </div>

        {/* Unit - auto-filled from search, but editable */}
        <div>
          <label htmlFor="unit" className="block text-xs font-medium text-muted mb-1">
            {t("unit")}
          </label>
          <input
            type="text"
            id="unit"
            name="unit"
            value={effectiveUnit}
            onChange={(e) => setUnitValue(e.target.value)}
            placeholder={t("unitPlaceholder")}
            className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
            required
            maxLength={20}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="qty" className="block text-xs font-medium text-muted mb-1">
              {t("qty")}
            </label>
            <input
              type="number"
              id="qty"
              name="qty"
              min="1"
              step="1"
              value="1"
              className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
              required
            />
          </div>

          <div>
            <label htmlFor="unitCost" className="block text-xs font-medium text-muted mb-1">
              {t("unitCost")}
            </label>
            <input
              type="number"
              id="unitCost"
              name="unitCost"
              min="0"
              step="1"
              value="0"
              className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
            />
          </div>
        </div>

        <div>
          <label htmlFor="unitPrice" className="block text-xs font-medium text-muted mb-1">
            {t("unitPrice")}
          </label>
          <input
            type="number"
            id="unitPrice"
            name="unitPrice"
            min="0"
            step="1"
            value="0"
            className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
          />
        </div>

        <div>
          <label htmlFor="partnerName" className="block text-xs font-medium text-muted mb-1">
            {t("partnerName")}
          </label>
          <input
            type="text"
            id="partnerName"
            name="partnerName"
            placeholder={t("partnerNamePlaceholder")}
            className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
            maxLength={100}
          />
        </div>

        <div>
          <label htmlFor="destination" className="block text-xs font-medium text-muted mb-1">
            {t("destination")}
          </label>
          <input
            type="text"
            id="destination"
            name="destination"
            placeholder={t("destinationPlaceholder")}
            className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
            maxLength={100}
          />
        </div>

        <div>
          <label htmlFor="notes" className="block text-xs font-medium text-muted mb-1">
            {t("notes")}
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={2}
            placeholder={t("notesPlaceholder")}
            className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent resize-none"
            maxLength={500}
          />
        </div>

        <div>
          <label htmlFor="pharmacistId" className="block text-xs font-medium text-muted mb-1">
            {t("pharmacistId")}
          </label>
          <input
            type="text"
            id="pharmacistId"
            name="pharmacistId"
            placeholder={t("pharmacistIdPlaceholder")}
            className="w-full rounded-lg border border-rule bg-surface px-3 py-2 text-sm focus:ring-2 focus:ring-accent focus:border-transparent"
            maxLength={50}
          />
        </div>

        <button
          type="submit"
          disabled={isPending}
          className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-accent-contrast transition-colors hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}