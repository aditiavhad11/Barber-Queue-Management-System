import { useState } from "react";
import { Plus, Pencil, Trash2, Layers3 } from "lucide-react";
import { Link } from "react-router-dom";
import { useOwner } from "../../hooks/useOwnerStore";
import {
  PageHead,
  StatusBadge,
  Modal,
  Empty,
} from "../../components/common/ui";
import { activeOf } from "../../utils/ownerEta";
import { api } from "../../services/api";
import { notifySuccess } from "../../utils/toast";
export default function Services() {
  const { services, queues, barbers, up, addServiceToShop, currentShopId } =
    useOwner();
  const [edit, setEdit] = useState(null);
  const [warn, setWarn] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [availabilityDate, setAvailabilityDate] = useState("");
  const [availabilityReason, setAvailabilityReason] = useState("");
  const [availabilityRows, setAvailabilityRows] = useState([]);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState("");
  const [availabilityError, setAvailabilityError] = useState("");
  const openAvailability = async (service) => {
    setAvailability(service);
    setAvailabilityDate("");
    setAvailabilityReason("");
    setAvailabilityMessage("");
    setAvailabilityError("");
    setAvailabilityRows([]);
    setAvailabilityBusy(true);
    try {
      const { data } = await api.get(`/shops/${currentShopId}/services/${service.id}/unavailability`);
      setAvailabilityRows(data);
    } catch (error) {
      setAvailabilityError(error.response?.data?.message || "Could not load unavailable dates.");
      setAvailabilityRows([]);
    } finally {
      setAvailabilityBusy(false);
    }
  };
  const saveAvailability = async () => {
    if (!availabilityDate) return setAvailabilityError("Select a date.");
    setAvailabilityBusy(true);
    setAvailabilityError("");
    setAvailabilityMessage("");
    try {
      const { data } = await api.post(`/shops/${currentShopId}/services/${availability.id}/unavailability`, {
        date: availabilityDate,
        reason: availabilityReason,
      });
      setAvailabilityRows((rows) => [...rows.filter((row) => row.date !== data.restriction.date), data.restriction].sort((a, b) => a.date.localeCompare(b.date)));
      setAvailabilityMessage(data.message || "Availability restriction saved.");
      setAvailabilityDate("");
      setAvailabilityReason("");
    } catch (error) {
      setAvailabilityError(error.response?.data?.message || "Could not save this restriction.");
    } finally {
      setAvailabilityBusy(false);
    }
  };
  const removeAvailability = async (row) => {
    setAvailabilityBusy(true);
    setAvailabilityError("");
    setAvailabilityMessage("");
    try {
      const { data } = await api.delete(`/shops/${currentShopId}/services/${availability.id}/unavailability/${row.id}`);
      setAvailabilityRows((rows) => rows.filter((item) => item.id !== row.id));
      setAvailabilityMessage(data.message || "Availability restriction removed.");
    } catch (error) {
      setAvailabilityError(error.response?.data?.message || "Could not remove this restriction.");
    } finally {
      setAvailabilityBusy(false);
    }
  };
  const queued = (id) =>
    Object.values(queues)
      .flatMap(activeOf)
      .filter((e) => e.service === id).length;
  const toggle = (s) => {
    if (s.enabled && queued(s.id)) return setWarn({ s, kind: "disable" });
    up("services", (l) =>
      l.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)),
    );
  };
  const save = async () => {
    const s = edit;
    if (!s.name.trim() || !(+s.price > 0) || !(+s.duration > 0))
      return setEdit({
        ...s,
        err: "Enter a name, positive price and positive duration.",
      });
    try {
      if (s.id)
        up("services", (l) =>
          l.map((x) =>
            x.id === s.id
              ? { ...x, name: s.name, price: +s.price, duration: +s.duration }
              : x,
          ),
        );
      else
        await addServiceToShop(currentShopId, {
          name: s.name,
          price: +s.price,
          duration: +s.duration,
        });
      notifySuccess(s.id ? "Service updated." : "Service added.");
      setEdit(null);
    } catch (e) {
      setEdit({ ...s, err: e.message });
    }
  };
  return (
    <>
      <PageHead
        title="Services"
        sub="Disabling a service blocks new bookings only. Customers already in a queue stay."
        action={
          <div className="flex flex-wrap gap-2">
            <Link className="btn-ghost" to="/owner/all-services">
              <Layers3 size={16} />
              All shop services
            </Link>
            <button
              className="btn"
              onClick={() => setEdit({ name: "", price: "", duration: "" })}
            >
              <Plus size={16} />
              Add service
            </button>
          </div>
        }
      />
      {!services.length ? (
        <Empty title="No services" text="Add services customers can book." />
      ) : (
        <div className="border-t border-khaki">
          {services.map((s) => (
            <div
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 py-4 border-b border-khaki"
            >
              <div>
                <b className="text-lg">{s.name}</b>
                <p className="text-sm text-coffee/70">
                  ₹{s.price} · {s.duration} min ·{" "}
                  {barbers.filter((b) => b.services.includes(s.id)).length}{" "}
                  barber(s) · {queued(s.id)} in queue
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge s={s.enabled ? "Enabled" : "Disabled"} />
                <button className="text-sm underline" onClick={() => toggle(s)}>
                  {s.enabled ? "Disable" : "Enable"}
                </button>
                <button className="text-sm underline" onClick={() => openAvailability(s)}>
                  Manage Availability
                </button>
                <button aria-label="Edit" onClick={() => setEdit({ ...s })}>
                  <Pencil size={16} />
                </button>
                <button
                  aria-label="Delete"
                  onClick={() => setWarn({ s, kind: "delete" })}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          title={edit.id ? "Edit service" : "Add service"}
          onClose={() => setEdit(null)}
          actions={
            <button className="btn" onClick={save}>
              Save
            </button>
          }
        >
          <input
            className="input"
            placeholder="Name"
            value={edit.name}
            onChange={(e) => setEdit({ ...edit, name: e.target.value })}
          />
          <input
            className="input"
            type="number"
            min="0"
            step="1"
            placeholder="Price (₹)"
            value={edit.price}
            onChange={(e) =>
              setEdit({
                ...edit,
                price:
                  e.target.value === ""
                    ? ""
                    : Math.max(0, Number(e.target.value)),
              })
            }
          />
          <input
            className="input"
            type="number"
            min="1"
            step="1"
            placeholder="Duration (min)"
            value={edit.duration}
            onChange={(e) =>
              setEdit({
                ...edit,
                duration:
                  e.target.value === ""
                    ? ""
                    : Math.max(1, Number(e.target.value)),
              })
            }
          />
          {edit.err && <p className="text-rose">{edit.err}</p>}
        </Modal>
      )}
      {availability && (
        <Modal
          title={`Manage availability: ${availability.name}`}
          onClose={() => setAvailability(null)}
          actions={<button className="btn" disabled={availabilityBusy} onClick={saveAvailability}>{availabilityBusy ? "Saving..." : "Save date"}</button>}
        >
          <div className="space-y-3">
            <input className="input" type="date" value={availabilityDate} onChange={(e) => setAvailabilityDate(e.target.value)} />
            <input className="input" placeholder="Optional reason" maxLength={255} value={availabilityReason} onChange={(e) => setAvailabilityReason(e.target.value)} />
            {availabilityMessage && <p className="text-sm text-olive" role="status">{availabilityMessage}</p>}
            {availabilityError && <p className="text-sm text-rose" role="alert">{availabilityError}</p>}
            <div className="border-t border-khaki pt-3">
              <b>Unavailable dates</b>
              {availabilityBusy && !availabilityRows.length ? <p className="text-sm mt-2">Loading dates...</p> : availabilityRows.length ? (
                <ul className="mt-2 space-y-2">
                  {availabilityRows.map((row) => <li key={row.id} className="flex justify-between gap-3 text-sm">
                    <span>{row.date}{row.reason ? ` · ${row.reason}` : ""}</span>
                    <button className="underline" disabled={availabilityBusy} onClick={() => removeAvailability(row)}>Remove</button>
                  </li>)}
                </ul>
              ) : <p className="text-sm mt-2 text-coffee/70">No unavailable dates.</p>}
            </div>
          </div>
        </Modal>
      )}
      {warn && (
        <Modal
          title={
            warn.kind === "disable"
              ? `Disable ${warn.s.name}?`
              : `Delete ${warn.s.name}?`
          }
          onClose={() => setWarn(null)}
          actions={
            <button
              className="btn !bg-rose"
              onClick={() => {
                up("services", (l) =>
                  warn.kind === "delete"
                    ? l.filter((x) => x.id !== warn.s.id)
                    : l.map((x) =>
                        x.id === warn.s.id ? { ...x, enabled: false } : x,
                      ),
                );
                setWarn(null);
              }}
            >
              {warn.kind === "disable" ? "Disable for new bookings" : "Delete"}
            </button>
          }
        >
          {queued(warn.s.id) > 0 ? (
            <p>
              {queued(warn.s.id)} customer(s) are already queued for this
              service. They will stay in their queues and still be served. Only
              new bookings are blocked.
            </p>
          ) : (
            <p>No customers are queued for this service.</p>
          )}
          {warn.kind === "delete" && (
            <p>Deleting also removes it from barbers who provide it.</p>
          )}
        </Modal>
      )}
    </>
  );
}
