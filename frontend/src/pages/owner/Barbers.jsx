import { useState } from "react";
import { Plus, Pencil, Trash2, Upload } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import {
  PageHead,
  StatusBadge,
  Modal,
  Empty,
  Rating,
} from "../../components/common/ui";
import { activeOf } from "../../utils/ownerEta";
import { uploadImage, ACCEPTED, MAX_MB } from "../../services/upload";
import { notifySuccess } from "../../utils/toast";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const blank = {
  name: "",
  gender: "Prefer not to say",
  age: "",
  phone: "",
  email: "",
  experience: 0,
  specialization: "",
  services: [],
  workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  status: "Available",
  photo: "",
};

export default function Barbers() {
  const { barbers, services, queues, up, saveBarber } = useOwner();
  const [form, setForm] = useState(null);
  const [view, setView] = useState(null);
  const [rm, setRm] = useState(null);
  const [avail, setAvail] = useState(null);
  const [uploading, setUploading] = useState(false);
  const qlen = (id) => activeOf(queues[id] || []).length;

  const save = async () => {
    if (!form.name.trim())
      return setForm({ ...form, err: "Name is required." });
    if (!form.services.length)
      return setForm({ ...form, err: "Assign at least one service." });
    if (form.age !== "" && form.age !== undefined && (isNaN(+form.age) || +form.age < 18 || +form.age > 70))
      return setForm({ ...form, err: "Age must be between 18 and 70." });
    const phoneDigits = String(form.phone || "").replace(/\D/g, "");
    if (phoneDigits && phoneDigits.length !== 10)
      return setForm({ ...form, err: "Phone number must be exactly 10 digits." });
    try {
      await saveBarber(form);
      setForm(null);
      notifySuccess("Barber profile saved.");
    } catch (e) {
      setForm({ ...form, err: e.message });
    }
  };

  const addPhoto = async (file) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type))
      return setForm({ ...form, err: "Only JPG, PNG and WEBP images are allowed." });
    if (file.size > MAX_MB * 1048576)
      return setForm({ ...form, err: `Image must be smaller than ${MAX_MB} MB.` });
    setUploading(true);
    try {
      const upImg = await uploadImage(file, "barber-queue/barbers");
      setForm({ ...form, photo: upImg.url, err: "" });
    } catch (e) {
      setForm({ ...form, err: e.message });
    } finally {
      setUploading(false);
    }
  };

  const setStatus = (b, status, move) => {
    if (move)
      up("queues", (q) => {
        const mv = activeOf(q[b.id] || []).filter((e) => e.status === "Waiting");
        return {
          ...q,
          [b.id]: (q[b.id] || []).filter((e) => !mv.includes(e)),
          [move]: [...(q[move] || []), ...mv],
        };
      });
    up("barbers", (l) => l.map((x) => (x.id === b.id ? { ...x, status } : x)));
    setAvail(null);
  };

  const choose = (b, status) =>
    qlen(b.id) && status !== "Available"
      ? setAvail({ b, status, move: "" })
      : setStatus(b, status);

  const eligible = (b) =>
    barbers.filter(
      (x) =>
        x.id !== b.id &&
        x.status === "Available" &&
        activeOf(queues[b.id] || [])
          .filter((e) => e.status === "Waiting")
          .every((e) => x.services.includes(e.service)),
    );

  return (
    <>
      <PageHead
        title="Barbers"
        sub="Manage barber profiles, profile photos, services and availability."
        action={
          <button className="btn" onClick={() => setForm({ ...blank })}>
            <Plus size={16} />
            Add barber
          </button>
        }
      />
      {!barbers.length ? (
        <Empty title="No barbers" text="Add your first barber and assign their services." />
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {barbers.map((b) => (
            <div key={b.id} className="border border-khaki p-5">
              <div className="flex gap-4">
                <div className="w-14 h-14 rounded-full bg-olive text-cream grid place-items-center font-serif text-2xl overflow-hidden shrink-0">
                  {b.photo ? (
                    <img src={b.photo} alt="" className="w-full h-full object-cover" />
                  ) : (
                    b.name[0]
                  )}
                </div>
                <div className="flex-1 text-sm">
                  <div className="flex justify-between">
                    <b className="text-lg">{b.name}</b>
                    <StatusBadge s={b.status} />
                  </div>
                  <p>
                    {b.gender}{b.age ? ` · Age ${b.age}` : ""}{" · "}{b.experience} yrs{" "}
                    {b.rating > 0 && <Rating v={b.rating} />}
                  </p>
                  <p className="text-coffee/70">{b.specialization}</p>
                  {b.phone && <p className="text-coffee/70 text-xs">📞 {b.phone}</p>}
                  {b.email && <p className="text-coffee/70 text-xs truncate">✉ {b.email}</p>}
                </div>
              </div>
              <p className="text-sm mt-3">
                {b.services.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean).join(", ") || "No services"}
              </p>
              {(b.workingDays || []).length > 0 && (
                <p className="text-xs text-coffee/60 mt-1">Works: {(b.workingDays || []).join(", ")}</p>
              )}
              <p className="text-sm text-coffee/70">{qlen(b.id)} in queue</p>
              <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-khaki">
                <select
                  className="input !w-auto !py-1.5 text-sm"
                  value={b.status}
                  onChange={(e) => choose(b, e.target.value)}
                >
                  {["Available", "On Break", "Unavailable"].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                <button className="text-sm underline" onClick={() => setView(b)}>View</button>
                <button aria-label="Edit" onClick={() => setForm({ ...b })}><Pencil size={16} /></button>
                <button aria-label="Remove" onClick={() => setRm(b)}><Trash2 size={16} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {form && (
        <Modal
          title={form.id ? "Edit barber" : "Add barber"}
          onClose={() => setForm(null)}
          actions={<button className="btn" onClick={save}>Save</button>}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-card overflow-hidden grid place-items-center text-ivory font-serif text-3xl">
                {form.photo ? (
                  <img src={form.photo} alt="Barber profile" className="w-full h-full object-cover" />
                ) : (
                  form.name?.[0] || "B"
                )}
              </div>
              <label className="btn-ghost cursor-pointer">
                <Upload size={16} />
                {uploading ? "Uploading..." : form.photo ? "Replace profile photo" : "Upload profile photo (optional)"}
                <input
                  type="file"
                  hidden
                  accept={ACCEPTED.join(",")}
                  disabled={uploading}
                  onChange={(e) => { addPhoto(e.target.files?.[0]); e.target.value = ""; }}
                />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-coffee/70 mb-1 block">
                  Full Name *
                </label>
                <input
                  className="input"
                  placeholder="Full name *"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-coffee/70 mb-1 block">
                  Gender
                </label>
                <select
                  className="input"
                  value={form.gender}
                  onChange={(e) => setForm({ ...form, gender: e.target.value })}
                >
                  {["Male", "Female", "Prefer not to say"].map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-coffee/70 mb-1 block">
                  Age
                </label>
                <input
                  className="input"
                  type="number"
                  min={18}
                  max={70}
                  placeholder="Age (18-70)"
                  value={form.age ?? ""}
                  onChange={(e) => setForm({ ...form, age: e.target.value === "" ? "" : Math.max(0, +e.target.value) })}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-coffee/70 mb-1 block">
                  Phone Number
                </label>
                <input
                  className="input"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="Phone (10 digits)"
                  value={form.phone ?? ""}
                  onChange={(e) => setForm({ ...form, phone: e.target.value.replace(/\D/g, "") })}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-coffee/70 mb-1 block">
                  Experience (years)
                </label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={60}
                  placeholder="Experience in years"
                  value={form.experience}
                  onChange={(e) => setForm({ ...form, experience: Math.max(0, +e.target.value) })}
                />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-coffee/70 mb-1 block">
                  Email Address (optional)
                </label>
                <input
                  className="input"
                  type="email"
                  placeholder="barber@example.com"
                  value={form.email ?? ""}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] font-medium text-coffee/70 mb-1 block">
                  Specialization / Services Offered
                </label>
                <input
                  className="input"
                  placeholder="Specialization / services offered"
                  value={form.specialization}
                  onChange={(e) => setForm({ ...form, specialization: e.target.value })}
                />
              </div>
            </div>

            <div>
              <div className="label mb-1">Working days</div>
              <div className="flex flex-wrap gap-2">
                {ALL_DAYS.map((day) => (
                  <label key={day} className="flex items-center gap-1 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      className="accent-[#B39A6A]"
                      checked={(form.workingDays || []).includes(day)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          workingDays: e.target.checked
                            ? [...(form.workingDays || []), day]
                            : (form.workingDays || []).filter((d) => d !== day),
                        })
                      }
                    />
                    {day}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <div className="label mb-1">Services this barber provides *</div>
              {services.map((s) => (
                <label key={s.id} className="flex gap-2 py-0.5">
                  <input
                    type="checkbox"
                    className="accent-[#B39A6A]"
                    checked={form.services.includes(s.id)}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        services: e.target.checked
                          ? [...form.services, s.id]
                          : form.services.filter((x) => x !== s.id),
                      })
                    }
                  />
                  {s.name}
                </label>
              ))}
            </div>
            {form.err && <p className="text-rose text-sm">{form.err}</p>}
          </div>
        </Modal>
      )}

      {view && (
        <Modal title={view.name} onClose={() => setView(null)}>
          <div className="flex gap-4 items-center mb-4">
            {view.photo ? (
              <img src={view.photo} alt="" className="w-20 h-20 rounded-full object-cover" />
            ) : (
              <div className="w-20 h-20 rounded-full bg-olive text-cream grid place-items-center text-3xl">
                {view.name[0]}
              </div>
            )}
            <div className="text-sm space-y-0.5">
              <p>{view.gender}{view.age ? ` · Age ${view.age}` : ""}</p>
              <p>{view.experience} years experience</p>
              {view.specialization && <p>{view.specialization}</p>}
              {view.phone && <p>📞 {view.phone}</p>}
              {view.email && <p>✉ {view.email}</p>}
            </div>
          </div>
          {(view.workingDays || []).length > 0 && (
            <p className="text-sm mb-2">Working days: {view.workingDays.join(", ")}</p>
          )}
          <p className="text-sm">
            Services:{" "}
            {view.services.map((id) => services.find((s) => s.id === id)?.name).filter(Boolean).join(", ")}
          </p>
          <p className="text-sm text-coffee/70">Queue length: {qlen(view.id)}</p>
        </Modal>
      )}

      {rm && (
        <Modal
          title={`Remove ${rm.name}?`}
          onClose={() => setRm(null)}
          actions={
            qlen(rm.id) ? null : (
              <button
                className="btn !bg-rose"
                onClick={() => { up("barbers", (l) => l.filter((b) => b.id !== rm.id)); setRm(null); }}
              >
                Remove
              </button>
            )
          }
        >
          {qlen(rm.id) ? (
            <p>{rm.name} still has {qlen(rm.id)} customer(s) in the queue. Reassign or finish the queue first, then remove.</p>
          ) : (
            <p>This barber has no queue and will be removed.</p>
          )}
        </Modal>
      )}

      {avail && (
        <Modal
          title={`Set ${avail.b.name} to ${avail.status}?`}
          onClose={() => setAvail(null)}
          actions={
            <button className="btn" onClick={() => setStatus(avail.b, avail.status, avail.move || null)}>
              {avail.move ? "Reassign and apply" : "Continue existing queue"}
            </button>
          }
        >
          <p>
            {avail.b.name} has {qlen(avail.b.id)} customer(s) in the queue.
            Nobody is removed automatically. New bookings with {avail.b.name} will be blocked.
          </p>
          <label className="block">
            Handle affected waiting customers
            <select
              className="input mt-1"
              value={avail.move}
              onChange={(e) => setAvail({ ...avail, move: e.target.value })}
            >
              <option value="">Keep them in {avail.b.name}''s queue</option>
              {eligible(avail.b).map((x) => (
                <option key={x.id} value={x.id}>Reassign to {x.name}</option>
              ))}
            </select>
          </label>
        </Modal>
      )}
    </>
  );
}
