import { useEffect, useState } from "react";
import { Upload, Trash2 } from "lucide-react";
import { api } from "../../services/api";
import { uploadImage, ACCEPTED, MAX_MB } from "../../services/upload";
import { notifyError, notifySuccess } from "../../utils/toast";

export default function UpiSettings({ shopId }) {
  const [qrUrl, setQrUrl] = useState("");
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    api
      .get("/bookings/upi-settings", { params: { shopId }, toastOnError: false })
      .then(({ data }) => {
        setQrUrl(data.qrUrl || "");
        setPreview(data.qrUrl || "");
      })
      .catch(() => {});
  }, [shopId]);

  const choose = (file) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) {
      notifyError("Only JPG, PNG and WEBP images are allowed.");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      notifyError(`QR image must be smaller than ${MAX_MB}MB.`);
      return;
    }
    setSelected(file);
    setPreview(URL.createObjectURL(file));
  };

  const save = async () => {
    setBusy(true);
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
      notifySuccess(
        nextUrl ? "Your original UPI QR is saved." : "UPI QR removed.",
      );
    } catch {
      // Failures surface through the global API error toast.
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.put("/bookings/upi-settings", { shopId, qrUrl: "" });
      setQrUrl("");
      setSelected(null);
      setPreview("");
      notifySuccess("UPI QR removed. Customers cannot book until you add one.");
    } catch {
      // Failures surface through the global API error toast.
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
        </div>
      </div>
    </section>
  );
}
