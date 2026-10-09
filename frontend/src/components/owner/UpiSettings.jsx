import { useEffect, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { api } from "../../services/api";
import { uploadImage, ACCEPTED, MAX_MB } from "../../services/upload";

export default function UpiSettings({ shopId }) {
  const [qrUrl, setQrUrl] = useState("");
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState("");
  const [note, setNote] = useState({ tone: "", text: "" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    api
      .get("/bookings/upi-settings", { params: { shopId } })
      .then(({ data }) => {
        setQrUrl(data.qrUrl || "");
        setPreview(data.qrUrl || "");
      })
      .catch(() => {});
  }, [shopId]);

  const choose = (file) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      setNote({
        tone: "err",
        text: "Only JPG, PNG and WEBP images are allowed.",
      });
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setNote({
        tone: "err",
        text: `QR image must be smaller than ${MAX_MB}MB.`,
      });
      return;
    }
    setSelected(file);
    setPreview(URL.createObjectURL(file));
    setNote({ tone: "", text: "" });
  };

  const save = async () => {
    setBusy(true);
    setNote({ tone: "", text: "" });
    try {
      let nextUrl = qrUrl;
      if (selected) {
        const uploaded = await uploadImage(
          selected,
          `barber-queue/shops/${shopId}/payment`,
        );
        nextUrl = uploaded.url;
      }
      await api.put("/bookings/upi-settings", { shopId, qrUrl: nextUrl });
      setQrUrl(nextUrl);
      setSelected(null);
      setPreview(nextUrl);
      setNote({
        tone: "ok",
        text: nextUrl ? "Your original UPI QR is saved." : "UPI QR removed.",
      });
    } catch (e) {
      setNote({
        tone: "err",
        text:
          e.response?.data?.message ||
          e.message ||
          "Could not save the QR image.",
      });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setNote({ tone: "", text: "" });
    try {
      await api.put("/bookings/upi-settings", { shopId, qrUrl: "" });
      setQrUrl("");
      setSelected(null);
      setPreview("");
      setNote({
        tone: "ok",
        text: "UPI QR removed. Customers cannot book until you add one.",
      });
    } catch (e) {
      setNote({
        tone: "err",
        text: e.response?.data?.message || "Could not remove the QR image.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="border border-khaki bg-card p-5 mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-2xl">UPI payment QR</h2>
          <p className="text-sm text-soft mt-1">
            Upload the original QR image from your own UPI app. Customers see
            this exact image.
          </p>
        </div>
        <span className="text-xs text-hint">
          No generated QR or payment gateway
        </span>
      </div>

      <div className="grid md:grid-cols-[220px_1fr] gap-6 mt-5 items-start">
        <div className="border border-khaki bg-white p-3 aspect-square grid place-items-center">
          {preview ? (
            <img
              src={preview}
              alt="Your UPI QR"
              className="w-full h-full object-contain"
            />
          ) : (
            <p className="text-sm text-soft text-center">No QR uploaded</p>
          )}
        </div>

        <div className="space-y-4">
          <label className="btn-ghost inline-flex cursor-pointer">
            <Upload size={16} />
            Choose QR image
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => choose(e.target.files?.[0])}
            />
          </label>

          <p className="text-xs text-soft">
            JPG, PNG or WEBP, up to {MAX_MB}MB.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              className="btn"
              disabled={busy || (!selected && !qrUrl)}
              onClick={save}
            >
              {busy ? "Saving..." : "Save QR"}
            </button>
            {qrUrl && (
              <button
                className="btn-ghost text-rose"
                disabled={busy}
                onClick={remove}
              >
                <Trash2 size={15} /> Remove QR
              </button>
            )}
          </div>

          {note.text && (
            <p
              className={`text-sm ${note.tone === "err" ? "text-rose" : "text-gold-light"}`}
            >
              {note.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
