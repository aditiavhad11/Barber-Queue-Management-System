import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useOwner } from "../../hooks/useOwnerStore";
import { useAuth } from "../../hooks/useAuth";
import { PageHead, Empty, StatusBadge } from "../../components/common/ui";
import { relativeTime } from "../../utils/relativeTime";
import { Trash2 } from "lucide-react";
export function Notifications() {
  const { notifications, removeNotification } = useOwner();
  const bar = {
    ok: "border-l-olive",
    info: "border-l-brass",
    warn: "border-l-brass",
    alert: "border-l-rose",
  };
  return (
    <>
      <PageHead title="Notifications" />
      {!notifications.length ? (
        <Empty title="All caught up" text="No notifications." />
      ) : (
        notifications.map((n) => (
          <div
            key={n.id}
            className={`py-4 pl-3 border-b border-khaki border-l-2 flex justify-between gap-3 ${bar[n.tone]}`}
          >
            <div>
              <p>{n.text}</p>
              <p className="text-xs text-coffee/60">
                {relativeTime(n.createdAt || n.time)}
              </p>
            </div>
            <button
              type="button"
              className="text-coffee/50 hover:text-rose"
              title="Delete notification"
              onClick={() => removeNotification(n.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))
      )}
    </>
  );
}
export function Profile() {
  const { owner, shop, up } = useOwner();
  const [d, setD] = useState(owner);
  const [ok, setOk] = useState(false);
  return (
    <>
      <PageHead title="Owner profile" />
      <div className="max-w-lg space-y-3">
        <input
          className="input"
          value={d.name}
          onChange={(e) => {
            setD({ ...d, name: e.target.value });
            setOk(false);
          }}
        />
        <input className="input" value={d.email} disabled />
        <input
          className="input"
          placeholder="Mobile number"
          value={d.mobile}
          onChange={(e) => {
            setD({ ...d, mobile: e.target.value });
            setOk(false);
          }}
        />
        <div className="flex justify-between text-sm py-2 border-y border-khaki">
          <span>Account status</span>
          <StatusBadge s="Approved" />
        </div>
        <div className="text-sm">
          Associated shop:{" "}
          <b>{shop.status === "none" ? "None yet" : shop.name}</b>
        </div>
        <button
          className="btn"
          onClick={() => {
            up("owner", d);
            setOk(true);
          }}
        >
          Save
        </button>
        {ok && <span className="text-sm text-olive ml-3">Saved</span>}
      </div>
    </>
  );
}
export function Settings() {
  const { prefs, up } = useOwner();
  const { logout } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState(false);
  const labels = {
    newQueue: "New queue entries",
    payments: "Payments received",
    noShow: "No-shows and cancellations",
    announcements: "Platform announcements",
  };
  return (
    <>
      <PageHead title="Settings" />
      <div className="max-w-lg space-y-10">
        <section>
          <h2 className="text-2xl mb-2">Notification preferences</h2>
          {Object.entries(labels).map(([k, l]) => (
            <label
              key={k}
              className="flex justify-between py-3 border-b border-khaki text-sm"
            >
              {l}
              <input
                type="checkbox"
                className="accent-[#B39A6A]"
                checked={prefs[k]}
                onChange={(e) =>
                  up("prefs", (p) => ({ ...p, [k]: e.target.checked }))
                }
              />
            </label>
          ))}
        </section>
        <section>
          <h2 className="text-2xl mb-2">Security</h2>
          <p className="text-sm text-coffee/70 mb-3">
            You sign in with an emailed one-time code. Passwords and codes are
            never shown.
          </p>
          <button className="btn-ghost" onClick={() => setPw(true)}>
            Reset password
          </button>
          {pw && (
            <p className="text-sm text-olive mt-2">
              A reset link would be emailed to you (mock).
            </p>
          )}
        </section>
        <section>
          <h2 className="text-2xl mb-2">Account</h2>
          <button
            className="btn-ghost"
            onClick={() => {
              logout();
              nav("/");
            }}
          >
            Logout
          </button>
        </section>
      </div>
    </>
  );
}
