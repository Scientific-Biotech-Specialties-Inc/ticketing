import * as React from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Searchable combobox: a text input with a listbox of options.
 *
 * The caller owns searching (and its debounce): `onSearch(text)` runs on every keystroke and the
 * caller passes back `options` and `loading`. An optional `createLabel(text)` adds a last row
 * that lets the user pick the typed text as a new value; it is hidden when an option matches
 * the text exactly (compare with `isExactMatch`).
 *
 * Keyboard: ArrowDown and ArrowUp move, Enter picks, Escape closes.
 */
export function Combobox({
  id,
  value,
  onInputChange,
  onSearch,
  options = [],
  loading = false,
  onSelect,
  getOptionLabel = (o) => o?.name ?? "",
  renderOption,
  createLabel,
  isExactMatch,
  placeholder,
  loadingLabel = "Searching…",
  emptyLabel = "No matches",
  error,
  disabled,
  className,
  ...inputProps
}) {
  const listId = `${id}-listbox`;
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const containerRef = React.useRef(null);

  const text = value ?? "";
  const trimmed = text.trim();
  const exact = trimmed !== "" && options.some((o) => (isExactMatch ? isExactMatch(o, trimmed) : getOptionLabel(o).toLowerCase() === trimmed.toLowerCase()));
  const showCreate = Boolean(createLabel) && trimmed !== "" && !loading && !exact;

  const items = React.useMemo(() => {
    const list = options.map((option) => ({ kind: "option", option }));
    if (showCreate) list.push({ kind: "create", text: trimmed });
    return list;
  }, [options, showCreate, trimmed]);

  React.useEffect(() => {
    setActive(items.length ? 0 : -1);
  }, [items.length]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDocDown = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const pick = (item) => {
    if (!item) return;
    onSelect?.(item.kind === "create" ? { isNew: true, name: item.text } : { isNew: false, option: item.option });
    setOpen(false);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    onInputChange?.(next);
    onSearch?.(next);
    setOpen(next.trim() !== "");
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(trimmed !== "");
      setActive((i) => (items.length ? (i + 1) % items.length : -1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (items.length ? (i - 1 + items.length) % items.length : -1));
    } else if (e.key === "Enter") {
      if (open && active >= 0 && items[active]) {
        e.preventDefault();
        pick(items[active]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    }
  };

  const optionId = (i) => `${id}-option-${i}`;
  const expanded = open && trimmed !== "";

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <Input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded && active >= 0 ? optionId(active) : undefined}
        autoComplete="off"
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(trimmed !== "")}
        placeholder={placeholder}
        error={error}
        disabled={disabled}
        {...inputProps}
      />
      {expanded && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-surface py-1 shadow-lg"
        >
          {loading && (
            <li role="presentation" className="flex items-center gap-2 px-3 py-2 text-xs text-muted-slate">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              {loadingLabel}
            </li>
          )}
          {!loading && items.length === 0 && (
            <li role="presentation" className="px-3 py-2 text-xs text-muted-slate">{emptyLabel}</li>
          )}
          {!loading && items.map((item, i) => (
            <li
              key={item.kind === "create" ? "__create__" : item.option.id ?? i}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(item)}
              onMouseEnter={() => setActive(i)}
              className={cn(
                "cursor-pointer px-3 py-2 text-xs text-dark-slate",
                i === active && "bg-blue-50",
                item.kind === "create" && "border-t border-slate-100 font-semibold text-accent"
              )}
            >
              {item.kind === "create"
                ? createLabel(item.text)
                : renderOption
                ? renderOption(item.option)
                : getOptionLabel(item.option)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
