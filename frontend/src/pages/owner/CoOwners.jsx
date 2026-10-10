import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Users,
  UserCheck,
  ShieldCheck,
  Key,
  Phone,
  Mail,
  Plus,
  Trash2,
  Edit3,
  Lock,
  CheckCircle2,
  AlertCircle,
  Eye,
  EyeOff,
  Sparkles,
  Shield,
  Layers,
} from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { PageHead, StatusBadge, Empty, Modal } from "../../components/common/ui";
import {
  CO_OWNER_PERMISSIONS,
  PERMISSION_PRESETS,
  DEFAULT_PERMISSIONS,
  summarizePermissions,
} from "../../utils/coOwnerPermissions";

export default function CoOwners() {
  const { shop, coOwners, addCoOwner, updateCoOwner, deleteCoOwner } =
    useOwner();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCoOwner, setEditingCoOwner] = useState(null);
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    title: "Co-Owner",
    password: "",
    status: "active",
    permissions: { ...DEFAULT_PERMISSIONS },
  });

  const openAddModal = () => {
    setEditingCoOwner(null);
    setForm({
      name: "",
      email: "",
      phone: "",
      title: "Co-Owner",
      password: "",
      status: "active",
      permissions: { ...DEFAULT_PERMISSIONS },
    });
    setShowPassword(false);
    setErrorMsg("");
    setModalOpen(true);
  };

  const openEditModal = (co) => {
    setEditingCoOwner(co);
    setForm({
      name: co.name || "",
      email: co.email || "",
      phone: co.phone || "",
      title: co.title || "Co-Owner",
      password: "",
      status: co.status || "active",
      permissions: {
        ...DEFAULT_PERMISSIONS,
        ...(co.permissions || {}),
      },
    });
    setShowPassword(false);
    setErrorMsg("");
    setModalOpen(true);
  };

  const handleApplyPreset = (preset) => {
    if (preset.id === "custom") return;
    setForm((prev) => ({
      ...prev,
      permissions: { ...preset.permissions },
    }));
  };

  const handleTogglePermission = (key) => {
    setForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        [key]: !prev.permissions[key],
      },
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!shop) return;
    setErrorMsg("");
    setSuccessMsg("");

    if (!form.name.trim()) {
      setErrorMsg("Please enter the co-owner's full name.");
      return;
    }
    if (!form.email.trim() || !form.email.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    if (!form.phone.trim()) {
      setErrorMsg("Please enter a contact phone number.");
      return;
    }
    if (!editingCoOwner && (!form.password || form.password.length < 6)) {
      setErrorMsg("Password must be at least 6 characters for login access.");
      return;
    }

    setSaving(true);
    try {
      if (editingCoOwner) {
        const payload = {
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim(),
          title: form.title.trim() || "Co-Owner",
          status: form.status,
          permissions: form.permissions,
        };
        if (form.password) {
          payload.password = form.password;
        }
        await updateCoOwner(shop.id, editingCoOwner.id, payload);
        setSuccessMsg(`Updated permissions for ${form.name}.`);
      } else {
        await addCoOwner(shop.id, {
          name: form.name.trim(),
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim(),
          title: form.title.trim() || "Co-Owner",
          password: form.password,
          status: "active",
          permissions: form.permissions,
        });
        setSuccessMsg(`Co-owner ${form.name} added successfully.`);
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err.message || "Could not save co-owner details.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (co) => {
    const nextStatus = co.status === "active" ? "inactive" : "active";
    try {
      await updateCoOwner(shop.id, co.id, { status: nextStatus });
    } catch (err) {
      alert(err.message || "Could not update status.");
    }
  };

  const handleDelete = async (co) => {
    const ok = window.confirm(
      `Remove ${co.name} (${co.title}) as co-owner for ${shop.name}? They will immediately lose access to this shop dashboard.`,
    );
    if (!ok) return;
    try {
      await deleteCoOwner(shop.id, co.id);
      setSuccessMsg(`Removed ${co.name} from ${shop.name}.`);
    } catch (err) {
      alert(err.message || "Could not remove co-owner.");
    }
  };

  if (!shop) {
    return (
      <Empty
        title="No shop selected"
        text="Please create or select a shop first to configure co-owners."
        action={
          <Link to="/owner/create-shop" className="btn mt-4">
            Create Shop
          </Link>
        }
      />
    );
  }

  const shopCoOwners = shop.coOwners || coOwners || [];
  const activeCount = shopCoOwners.filter((c) => c.status === "active").length;

  return (
    <>
      <PageHead
        title="Co-Owners & Staff Access"
        sub={`Manage co-owners and managers for "${shop.name}". Assign custom permissions to run queue, staff, or services smoothly.`}
        action={
          <button className="btn" onClick={openAddModal}>
            <Plus size={16} />
            Add Co-Owner
          </button>
        }
      />

      {successMsg && (
        <div className="mb-6 p-4 rounded-md border border-olive/30 bg-olive/10 text-olive flex items-center justify-between">
          <span className="flex items-center gap-2">
            <CheckCircle2 size={18} />
            {successMsg}
          </span>
          <button
            className="text-xs uppercase tracking-wider font-semibold hover:underline"
            onClick={() => setSuccessMsg("")}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="border border-khaki p-4 rounded-md bg-card/40">
          <p className="label !text-coffee/60">Assigned Co-Owners</p>
          <p className="font-serif text-3xl mt-1 text-gold">
            {shopCoOwners.length}
          </p>
          <p className="text-xs text-coffee/60 mt-1">Managers for this shop</p>
        </div>
        <div className="border border-khaki p-4 rounded-md bg-card/40">
          <p className="label !text-coffee/60">Active Access</p>
          <p className="font-serif text-3xl mt-1 text-olive">{activeCount}</p>
          <p className="text-xs text-coffee/60 mt-1">Currently allowed login</p>
        </div>
        <div className="border border-khaki p-4 rounded-md bg-card/40">
          <p className="label !text-coffee/60">Primary Owner</p>
          <p className="font-serif text-xl mt-2 font-medium truncate">
            Full Control
          </p>
          <p className="text-xs text-coffee/60 mt-1">Super administrator</p>
        </div>
        <div className="border border-khaki p-4 rounded-md bg-card/40">
          <p className="label !text-coffee/60">Current Shop</p>
          <p className="font-serif text-xl mt-2 font-medium truncate">
            {shop.name}
          </p>
          <p className="text-xs text-coffee/60 mt-1">Multi-shop delegated</p>
        </div>
      </div>

      {!shopCoOwners.length ? (
        <div className="border border-khaki rounded-md p-10 text-center bg-card/20">
          <div className="w-16 h-16 rounded-full bg-brass/20 text-brass grid place-items-center mx-auto mb-4">
            <Users size={28} />
          </div>
          <h2 className="text-2xl font-serif">No Co-Owners Assigned Yet</h2>
          <p className="text-sm text-coffee/70 max-w-md mx-auto mt-2">
            Managing multiple branches? Invite a co-owner or shop manager to
            oversee daily queue operations, staff shifts, or services for{" "}
            <span className="font-semibold text-coffee">{shop.name}</span> while
            you keep top-level control.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            <button className="btn" onClick={openAddModal}>
              <Plus size={16} />
              Add First Co-Owner
            </button>
            <Link to="/owner/shops" className="btn-ghost">
              Back to My Shops
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-5">
          {shopCoOwners.map((co) => {
            const perms = co.permissions || {};
            const activePermCount = Object.values(perms).filter(Boolean).length;
            const isFull = activePermCount === CO_OWNER_PERMISSIONS.length;

            return (
              <div
                key={co.id}
                className={`border rounded-md p-6 bg-card/30 flex flex-col justify-between transition-all ${
                  co.status === "active"
                    ? "border-khaki hover:border-gold/60"
                    : "border-rose/30 opacity-75"
                }`}
              >
                <div>
                  {/* Top Bar */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-side text-cream grid place-items-center font-serif text-lg font-semibold shrink-0">
                        {co.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-xl font-serif">{co.name}</h3>
                          <span className="text-[11px] font-medium uppercase tracking-wider px-2 py-0.5 rounded bg-brass/15 text-brass border border-brass/30">
                            {co.title || "Co-Owner"}
                          </span>
                        </div>
                        <p className="text-xs text-coffee/60 mt-0.5">
                          Assigned to: {shop.name}
                        </p>
                      </div>
                    </div>
                    <StatusBadge
                      s={co.status === "active" ? "Active" : "Inactive"}
                    />
                  </div>

                  {/* Contact Info */}
                  <div className="mt-4 pt-4 border-t border-khaki/50 space-y-1.5 text-sm text-coffee/80">
                    <div className="flex items-center gap-2">
                      <Mail size={15} className="text-coffee/50 shrink-0" />
                      <a
                        href={`mailto:${co.email}`}
                        className="hover:underline truncate"
                      >
                        {co.email}
                      </a>
                    </div>
                    <div className="flex items-center gap-2">
                      <Phone size={15} className="text-coffee/50 shrink-0" />
                      <a href={`tel:${co.phone}`} className="hover:underline">
                        {co.phone || "No phone provided"}
                      </a>
                    </div>
                  </div>

                  {/* Permissions Chips */}
                  <div className="mt-4 pt-4 border-t border-khaki/50">
                    <div className="flex items-center justify-between mb-2">
                      <span className="label !text-coffee/60">
                        Granted Permissions
                      </span>
                      <span className="text-xs text-brass font-medium">
                        {isFull
                          ? "Full Manager Access"
                          : `${activePermCount} of ${CO_OWNER_PERMISSIONS.length}`}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {CO_OWNER_PERMISSIONS.map((p) => {
                        const hasThis = Boolean(perms[p.key]);
                        return (
                          <span
                            key={p.key}
                            className={`text-[11px] px-2 py-1 rounded-md border transition-all ${
                              hasThis
                                ? "bg-olive/10 text-olive border-olive/30 font-medium"
                                : "bg-black/5 text-coffee/30 border-dashed border-khaki/40 line-through"
                            }`}
                            title={p.description}
                          >
                            {p.label}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Footer Controls */}
                <div className="mt-6 pt-4 border-t border-khaki/60 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <button
                      className="btn text-xs py-1.5 px-3"
                      onClick={() => openEditModal(co)}
                    >
                      <Edit3 size={13} />
                      Edit Permissions
                    </button>
                    <button
                      className={`btn-ghost text-xs py-1.5 px-3 ${
                        co.status === "active" ? "text-coffee" : "text-olive"
                      }`}
                      onClick={() => handleToggleActive(co)}
                    >
                      {co.status === "active" ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                  <button
                    className="btn-ghost text-xs py-1.5 px-2.5 text-rose hover:bg-rose/10"
                    onClick={() => handleDelete(co)}
                    title="Remove co-owner"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Co-Owner Modal */}
      {modalOpen && (
        <Modal
          title={
            editingCoOwner
              ? `Edit Co-Owner: ${editingCoOwner.name}`
              : `Add Co-Owner for ${shop.name}`
          }
          onClose={() => !saving && setModalOpen(false)}
        >
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="p-3 rounded bg-rose/10 border border-rose/30 text-rose text-sm flex items-center gap-2">
                <AlertCircle size={16} />
                {errorMsg}
              </div>
            )}

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="label mb-1">Full Name *</label>
                <input
                  className="input"
                  placeholder="e.g. Rahul Sharma"
                  value={form.name}
                  onChange={(e) =>
                    setForm({ ...form, name: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <label className="label mb-1">Role Title</label>
                <input
                  className="input"
                  placeholder="e.g. Co-Owner, Branch Manager"
                  value={form.title}
                  onChange={(e) =>
                    setForm({ ...form, title: e.target.value })
                  }
                />
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="label mb-1">Email Address *</label>
                <input
                  type="email"
                  className="input"
                  placeholder="manager@barbershop.com"
                  value={form.email}
                  onChange={(e) =>
                    setForm({ ...form, email: e.target.value })
                  }
                  required
                />
                <p className="text-[11px] text-coffee/60 mt-1">
                  Used for sign-in and shop notifications.
                </p>
              </div>
              <div>
                <label className="label mb-1">Contact Phone *</label>
                <input
                  type="tel"
                  className="input"
                  placeholder="+91 98765 43210"
                  value={form.phone}
                  onChange={(e) =>
                    setForm({ ...form, phone: e.target.value })
                  }
                  required
                />
              </div>
            </div>

            <div>
              <label className="label mb-1">
                {editingCoOwner ? "New Password (Leave blank to keep existing)" : "Sign In Password *"}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  className="input pr-10"
                  placeholder={
                    editingCoOwner ? "Enter new password" : "At least 6 characters"
                  }
                  value={form.password}
                  onChange={(e) =>
                    setForm({ ...form, password: e.target.value })
                  }
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-coffee/60 hover:text-coffee"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {editingCoOwner && (
              <div>
                <label className="label mb-1">Account Status</label>
                <select
                  className="input"
                  value={form.status}
                  onChange={(e) => setForm({ ...form, status: e.target.value })}
                >
                  <option value="active">Active (Can sign in & manage shop)</option>
                  <option value="inactive">Inactive (Temporarily suspended)</option>
                </select>
              </div>
            )}

            {/* Permission Presets */}
            <div className="pt-3 border-t border-khaki/60">
              <label className="label mb-2 flex items-center justify-between">
                <span>Access Presets</span>
                <span className="text-xs text-coffee/60 font-normal">
                  Click to quickly populate permissions
                </span>
              </label>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                {PERMISSION_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleApplyPreset(p)}
                    className="p-2.5 rounded border border-khaki text-left hover:border-gold hover:bg-gold/5 transition-all flex flex-col justify-between"
                  >
                    <div>
                      <p className="text-xs font-semibold">{p.name}</p>
                      <span className="text-[10px] text-coffee/60">
                        {p.badge}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Granular Permission Checklist */}
            <div>
              <label className="label mb-2">
                Granular Permissions ({Object.values(form.permissions).filter(Boolean).length} granted)
              </label>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {CO_OWNER_PERMISSIONS.map((perm) => {
                  const checked = Boolean(form.permissions[perm.key]);
                  return (
                    <label
                      key={perm.key}
                      className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-all ${
                        checked
                          ? "bg-brass/10 border-brass/40"
                          : "border-khaki/60 hover:bg-black/5"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleTogglePermission(perm.key)}
                        className="mt-0.5 rounded text-gold focus:ring-gold"
                      />
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {perm.label}
                          </span>
                          <span className="text-[10px] text-coffee/50 uppercase tracking-wider">
                            {perm.category}
                          </span>
                        </div>
                        <p className="text-xs text-coffee/70 mt-0.5">
                          {perm.description}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-khaki/60 flex items-center justify-end gap-3">
              <button
                type="button"
                className="btn-ghost"
                disabled={saving}
                onClick={() => setModalOpen(false)}
              >
                Cancel
              </button>
              <button type="submit" className="btn" disabled={saving}>
                {saving
                  ? "Saving..."
                  : editingCoOwner
                    ? "Update Permissions"
                    : "Add Co-Owner"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
