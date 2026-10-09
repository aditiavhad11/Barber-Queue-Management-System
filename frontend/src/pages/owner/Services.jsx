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
export default function Services() {
  const { services, queues, barbers, up, addServiceToShop, currentShopId } =
    useOwner();
  const [edit, setEdit] = useState(null);
  const [warn, setWarn] = useState(null);
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
