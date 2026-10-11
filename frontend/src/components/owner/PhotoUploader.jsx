import { useRef, useState } from "react";
import { Upload, X, Star } from "lucide-react";
import { ACCEPTED, MAX_MB } from "../../services/upload";
import { notifyError } from "../../utils/toast";
export default function PhotoUploader({ photos, onChange, error }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);

  const add = (files) => {
    const e = [],
      ok = [];
    [...files].forEach((f) => {
      if (!ACCEPTED.includes(f.type))
        e.push(`${f.name}: unsupported file type (use JPG, PNG or WebP).`);
      else if (f.size > MAX_MB * 1048576)
        e.push(`${f.name}: larger than ${MAX_MB} MB.`);
      else ok.push(f);
    });
    e.forEach((m) => notifyError(m));
    if (!ok.length) return;
    setBusy(true);
    const up = ok.map((file) => ({
      id: crypto.randomUUID(),
      url: URL.createObjectURL(file),
      file,
      primary: false,
      name: file.name,
      type: file.type,
    }));
    const all = [...photos, ...up];
    if (!all.some((p) => p.primary)) all[0].primary = true;
    onChange(all);
    setBusy(false);
  };
  const remove = (id) => {
    const removed = photos.find((p) => p.id === id);
    if (removed?.file) URL.revokeObjectURL(removed.url);
    let n = photos.filter((p) => p.id !== id);
    if (n.length && !n.some((p) => p.primary))
      n[0] = { ...n[0], primary: true };
    onChange(n);
  };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {photos.map((p) => (
          <div
            key={p.id}
            className={`relative aspect-[4/3] border ${p.primary ? "border-brass" : "border-khaki"}`}
          >
            <img src={p.url} alt="" className="w-full h-full object-cover" />
            <button
              onClick={() => remove(p.id)}
              aria-label="Remove photo"
              className="absolute top-1 right-1 bg-olive text-cream p-1"
            >
              <X size={14} />
            </button>
            <button
              onClick={() =>
                onChange(photos.map((x) => ({ ...x, primary: x.id === p.id })))
              }
              className={`absolute bottom-0 inset-x-0 text-xs py-1 flex items-center justify-center gap-1 ${p.primary ? "bg-brass text-[#1C1713]" : "bg-black/80 text-cream"}`}
            >
              <Star size={12} />
              {p.primary ? "Primary photo" : "Set as primary"}
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => ref.current.click()}
          disabled={busy}
          className="aspect-[4/3] border border-dashed border-khaki grid place-items-center text-sm hover:border-coffee"
        >
          <span className="text-center">
            <Upload className="mx-auto mb-1" size={20} />
            {busy ? "Uploading..." : "Add photos"}
          </span>
        </button>
      </div>
      <input
        ref={ref}
        type="file"
        multiple
        accept={ACCEPTED.join(",")}
        hidden
        onChange={(e) => {
          add(e.target.files);
          e.target.value = "";
        }}
      />
      <p className="text-xs text-coffee/60 mt-2">
        JPG, PNG or WebP, up to {MAX_MB} MB each.
      </p>
      {error && <p className="text-sm text-rose mt-1">{error}</p>}
    </div>
  );
}
