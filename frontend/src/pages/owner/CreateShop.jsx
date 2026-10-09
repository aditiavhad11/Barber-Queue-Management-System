import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Upload } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { PageHead } from "../../components/common/ui";
import PhotoUploader from "../../components/owner/PhotoUploader";
import LocationPicker from "../../components/owner/LocationPicker";
import WeeklyHours from "../../components/owner/WeeklyHours";
import {
  defaultSchedule,
  withSchedule,
  hoursFromSchedule,
  scheduleError,
} from "../../utils/closedDays";
import { uploadImage, ACCEPTED, MAX_MB } from "../../services/upload";

const POLICIES = [
  "Cancellation",
  "No-show",
  "Grace period",
  "Late arrival",
  "Refund",
  "Queue",
];
const newBarber = () => ({
  id: crypto.randomUUID(),
  name: "",
  gender: "Prefer not to say",
  experience: 0,
  specialization: "",
  services: [],
  status: "Available",
  photo: "",
});

export default function CreateShop() {
  const nav = useNavigate();
  const { submitShop, shops } = useOwner();
  const [errs, setErrs] = useState({});
  const [saving, setSaving] = useState(false);
  const [uploadingBarber, setUploadingBarber] = useState(null);
  const [f, setF] = useState({
    name: "",
    contact: "",
    address: "",
    open: "09:00",
    openPeriod: "AM",
    close: "09:00",
    closePeriod: "PM",
    description: "",
  });
  const [loc, setLoc] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [svc, setSvc] = useState([
    { id: crypto.randomUUID(), name: "Haircut", price: 150, duration: 20 },
  ]);
  const [barbers, setBarbers] = useState([newBarber()]);
  const [schedule, setSchedule] = useState(defaultSchedule("09:00", "21:00"));
  const [pol, setPol] = useState(
    Object.fromEntries(POLICIES.map((p) => [p, ""])),
  );
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const updateBarber = (id, patch) =>
    setBarbers((list) =>
      list.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    );
  const addBarberPhoto = async (id, file) => {
    if (!file) return;
    if (!ACCEPTED.includes(file.type))
      return setErrs((p) => ({
        ...p,
        [`barber-${id}`]: "Only JPG, PNG and WEBP images are allowed.",
      }));
    if (file.size > MAX_MB * 1048576)
      return setErrs((p) => ({
        ...p,
        [`barber-${id}`]: `Image must be smaller than ${MAX_MB} MB.`,
      }));
    setUploadingBarber(id);
    try {
      const upImg = await uploadImage(file, "barber-queue/barbers");
      updateBarber(id, { photo: upImg.url });
      setErrs((p) => ({ ...p, [`barber-${id}`]: "" }));
    } catch (e) {
      setErrs((p) => ({ ...p, [`barber-${id}`]: e.message }));
    } finally {
      setUploadingBarber(null);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    const x = {};
    if (!f.name.trim()) x.name = "Shop name is required.";
    if (!f.address.trim()) x.address = "Address is required.";
    if (!/^[+\d][\d\s-]{7,}$/.test(f.contact))
      x.contact = "Enter a valid contact number.";
    if (!loc?.confirmed) x.loc = "Find and confirm the exact shop location.";
    if (!photos.length) x.photos = "At least one shop photo is required.";
    {
      const he = scheduleError(schedule);
      if (he) x.hours = he;
    }
    if (!barbers.length || barbers.some((b) => !b.name.trim()))
      x.barbers = "Add a name for every barber.";
    if (barbers.some((b) => !b.services.length))
      x.barberServices = "Assign at least one service to every barber.";
    if (
      !svc.length ||
      svc.some((s) => !s.name.trim() || !(+s.price > 0) || !(+s.duration > 0))
    )
      x.svc = "Add at least one service with a name, price and duration.";
    if (POLICIES.some((p) => !pol[p].trim()))
      x.pol = "Fill in all six shop policies.";
    setErrs(x);
    if (Object.keys(x).length) return;
    setSaving(true);
    const services = svc.map((s) => ({
      id: s.id,
      name: s.name,
      price: +s.price,
      duration: +s.duration,
      enabled: true,
    }));
    try {
      await submitShop({
        name: f.name,
        description: f.description,
        contact: f.contact,
        address: f.address,
        location: loc,
        hours: hoursFromSchedule(schedule),
        photos,
        policy: pol,
        barberCount: barbers.length,
        barbers: barbers.map(({ id, ...b }) => b),
        services,
        availability: {
          ...withSchedule(
            { mode: "queue", note: "Walk-in queue during opening hours." },
            schedule,
          ),
          payment: { upi: true, cash: true },
        },
      });
      nav("/owner/shops");
    } catch (error) {
      setErrs((p) => ({
        ...p,
        submit: error.message || "Could not create the shop.",
      }));
    } finally {
      setSaving(false);
    }
  };
  const Err = ({ k }) =>
    errs[k] ? <p className="text-sm text-rose mt-1">{errs[k]}</p> : null;
  const H = ({ n, t }) => (
    <h2 className="text-3xl mt-10 mb-3 pt-6 border-t border-khaki">
      <span className="text-gold">{n}</span> {t}
    </h2>
  );
  return (
    <form onSubmit={submit} noValidate className="create-shop-form max-w-3xl">
      <PageHead
        title="Create your shop"
        sub="Everything marked required must be filled before you can submit."
      />
      <div className="create-intro">
        <p className="label">OWNER WORKSPACE</p>
        <p className="text-sm text-coffee/70 mt-2">
          Build your shop profile once. Admin will review the complete
          submission before it becomes visible to customers.
        </p>
      </div>
      <H n="01" t="Basics" />
      <div className="create-card space-y-3">
        <div>
          <input
            className="input"
            placeholder="Shop name"
            value={f.name}
            onChange={(e) => set("name", e.target.value)}
          />
          <Err k="name" />
        </div>
        <div>
          <input
            className="input"
            placeholder="Shop contact number"
            value={f.contact}
            onChange={(e) => set("contact", e.target.value)}
          />
          <Err k="contact" />
        </div>
        <textarea
          className="input"
          rows={2}
          placeholder="Short description (optional)"
          value={f.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <H n="03" t="Address and location" />
      <div className="create-card">
        <LocationPicker
          address={f.address}
          onAddress={(v) => set("address", v)}
          location={loc}
          onLocation={setLoc}
          error={errs.address || errs.loc}
        />
      </div>
      <H n="04" t="Photos" />
      <div className="create-card">
        <PhotoUploader
          photos={photos}
          onChange={setPhotos}
          error={errs.photos}
        />
      </div>
      <H n="05" t="Hours and team" />
      <div className="create-card">
        <WeeklyHours
          schedule={schedule}
          onChange={setSchedule}
          error={errs.hours}
        />
        <div className="mt-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="label">Barber profiles</p>
              <p className="text-sm text-coffee/70">
                Add the real barber details that will be submitted to Admin for
                approval.
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost"
              onClick={() => setBarbers([...barbers, newBarber()])}
            >
              <Plus size={16} />
              Add barber
            </button>
          </div>
          {barbers.map((b, i) => (
            <div
              key={b.id}
              className="create-card border border-khaki p-5 space-y-3"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xl">Barber {i + 1}</h3>
                {barbers.length > 1 && (
                  <button
                    type="button"
                    className="text-rose"
                    aria-label="Remove barber"
                    onClick={() =>
                      setBarbers(barbers.filter((x) => x.id !== b.id))
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-olive text-cream grid place-items-center font-serif text-2xl overflow-hidden">
                  {b.photo ? (
                    <img
                      src={b.photo}
                      alt="Barber"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    b.name?.[0] || "B"
                  )}
                </div>
                <label className="btn-ghost cursor-pointer">
                  <Upload size={16} />
                  {uploadingBarber === b.id
                    ? "Uploading..."
                    : b.photo
                      ? "Replace photo"
                      : "Upload photo"}
                  <input
                    type="file"
                    hidden
                    accept={ACCEPTED.join(",")}
                    disabled={uploadingBarber === b.id}
                    onChange={(e) => {
                      addBarberPhoto(b.id, e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  className="input"
                  placeholder="Barber name"
                  value={b.name}
                  onChange={(e) => updateBarber(b.id, { name: e.target.value })}
                />
                <select
                  className="input"
                  value={b.gender}
                  onChange={(e) =>
                    updateBarber(b.id, { gender: e.target.value })
                  }
                >
                  {["Male", "Female", "Prefer not to say"].map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
                <input
                  className="input"
                  type="number"
                  min={0}
                  placeholder="Years of experience"
                  value={b.experience}
                  onChange={(e) =>
                    updateBarber(b.id, { experience: +e.target.value })
                  }
                />
                <input
                  className="input"
                  placeholder="Specialization"
                  value={b.specialization}
                  onChange={(e) =>
                    updateBarber(b.id, { specialization: e.target.value })
                  }
                />
              </div>
              <div>
                <div className="label mb-1">Services this barber provides</div>
                <div className="flex flex-wrap gap-3">
                  {svc.map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        className="accent-[#B39A6A]"
                        checked={b.services.includes(s.id)}
                        onChange={(e) =>
                          updateBarber(b.id, {
                            services: e.target.checked
                              ? [...b.services, s.id]
                              : b.services.filter((x) => x !== s.id),
                          })
                        }
                      />
                      {s.name || "Unnamed service"}
                    </label>
                  ))}
                </div>
              </div>
              {errs[`barber-${b.id}`] && (
                <p className="text-sm text-rose">{errs[`barber-${b.id}`]}</p>
              )}
            </div>
          ))}
          <Err k="barbers" />
          <Err k="barberServices" />
        </div>
      </div>
      <H n="06" t="Services" />
      <div className="create-card space-y-3">
        <div className="space-y-2">
          {svc.map((s, i) => (
            <div key={s.id} className="service-row">
              <input
                className="input"
                placeholder="Service"
                value={s.name}
                onChange={(e) => {
                  const next = svc.map((x, j) =>
                    j === i ? { ...x, name: e.target.value } : x,
                  );
                  setSvc(next);
                }}
              />
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                placeholder="₹"
                value={s.price}
                onChange={(e) =>
                  setSvc(
                    svc.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            price:
                              e.target.value === ""
                                ? ""
                                : Math.max(0, Number(e.target.value)),
                          }
                        : x,
                    ),
                  )
                }
              />
              <input
                className="input"
                type="number"
                min="1"
                step="1"
                placeholder="min"
                value={s.duration}
                onChange={(e) =>
                  setSvc(
                    svc.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            duration:
                              e.target.value === ""
                                ? ""
                                : Math.max(1, Number(e.target.value)),
                          }
                        : x,
                    ),
                  )
                }
              />
              <button
                type="button"
                aria-label="Remove service"
                onClick={() => {
                  const next = svc.filter((_, j) => j !== i);
                  setSvc(next);
                  setBarbers(
                    barbers.map((b) => ({
                      ...b,
                      services: b.services.filter((id) => id !== s.id),
                    })),
                  );
                }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost"
            onClick={() =>
              setSvc([
                ...svc,
                { id: crypto.randomUUID(), name: "", price: "", duration: "" },
              ])
            }
          >
            <Plus size={16} />
            Add service
          </button>
          <Err k="svc" />
        </div>
      </div>
      <H n="07" t="Payment setup" />
      <div className="create-card space-y-3">
        <p className="text-sm text-coffee/70">
          After your shop is approved, upload your original UPI QR image from
          the Payments section. Customers will see that exact QR image before
          submitting a payment.
        </p>
      </div>
      <H n="08" t="Shop policies" />
      <div className="create-card space-y-3">
        {POLICIES.map((p) => (
          <label key={p} className="block text-sm">
            {p} policy
            <textarea
              rows={2}
              className="input"
              value={pol[p]}
              onChange={(e) => setPol({ ...pol, [p]: e.target.value })}
            />
          </label>
        ))}
        <Err k="pol" />
      </div>
      <button type="submit" className="btn mt-10" disabled={saving}>
        {saving ? "Submitting..." : "Submit for approval"}
      </button>
    </form>
  );
}
