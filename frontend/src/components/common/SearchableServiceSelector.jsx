import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";

export default function SearchableServiceSelector({
  services = [], selectedIds = [], onSelect, onRemove, disabled = () => false,
  selectedContent, suggestionContent, label, id, placeholder = "Search services...",
  noMatchesText = "No matching services found.", showSelected = true,
}) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const listId = `${inputId}-suggestions`;
  const containerRef = useRef(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const closeOnOutsidePointer = (event) => {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, []);
  const selected = new Set(selectedIds.map(String));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matches = services.filter((service) => service.enabled !== false && !selected.has(String(service.id))
    && (!normalizedQuery || String(service.name || "").toLocaleLowerCase().includes(normalizedQuery)));
  const choose = (service) => {
    if (disabled(service)) return;
    onSelect?.(service);
    setQuery("");
    setActiveIndex(0);
    setIsOpen(false);
  };

  return <div ref={containerRef} className="space-y-2">
    <label htmlFor={inputId} className="label">{label || "Search services"}</label>
    <input id={inputId} className="input" type="search" autoComplete="off" placeholder={placeholder} value={query}
      role="combobox" aria-autocomplete="list" aria-expanded={isOpen} aria-controls={listId}
      aria-activedescendant={isOpen && matches[activeIndex] ? `${listId}-${matches[activeIndex].id}` : undefined}
      onFocus={() => setIsOpen(true)} onClick={() => setIsOpen(true)}
      onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); setIsOpen(true); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" && matches.length) { event.preventDefault(); setIsOpen(true); setActiveIndex((i) => isOpen ? (i + 1) % matches.length : 0); }
        else if (event.key === "ArrowUp" && matches.length) { event.preventDefault(); setIsOpen(true); setActiveIndex((i) => isOpen ? (i - 1 + matches.length) % matches.length : matches.length - 1); }
        else if (event.key === "Enter" && isOpen && matches[activeIndex]) { event.preventDefault(); choose(matches[activeIndex]); }
        else if (event.key === "Escape") { setQuery(""); setIsOpen(false); }
      }} />
    {isOpen && <div className="border border-khaki max-h-56 overflow-auto bg-card" id={listId} role="listbox" aria-label="Matching services">
      {matches.length ? matches.map((service, index) => <button id={`${listId}-${service.id}`} key={service.id} type="button" role="option" aria-selected={index === activeIndex}
        disabled={disabled(service)} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(service)}
        className={`w-full px-3 py-2 flex justify-between text-left text-sm border-b last:border-0 border-khaki disabled:opacity-50 ${index === activeIndex ? "bg-olive/15" : "hover:bg-olive/10"}`}>
        <span>{suggestionContent ? suggestionContent(service) : service.name}</span><span>₹{Number(service.price).toFixed(2)}</span>
      </button>) : normalizedQuery ? <p className="p-3 text-sm text-soft" role="status">{noMatchesText}</p> : <p className="p-3 text-sm text-soft">All available services are selected.</p>}
    </div>}
    {showSelected && !!selectedIds.length && <div className="flex flex-wrap gap-2" aria-label="Selected services">
      {selectedIds.map((sid) => {
        const service = services.find((item) => String(item.id) === String(sid));
        if (!service) return null;
        return <div key={sid} className="border border-khaki px-3 py-2 flex items-center gap-3 text-sm">
          <span>{selectedContent ? selectedContent(service) : <>{service.name} · ₹{Number(service.price).toFixed(2)}</>}</span>
          <button type="button" className="text-soft hover:text-rose" aria-label={`Remove ${service.name}`} onClick={() => onRemove?.(service)}><X size={15} /></button>
        </div>;
      })}
    </div>}
  </div>;
}
