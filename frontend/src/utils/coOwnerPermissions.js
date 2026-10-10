export const CO_OWNER_PERMISSIONS = [
  {
    key: "manage_queue",
    label: "Live Queue & Walk-ins",
    category: "Operations",
    description: "Accept or decline bookings, call customers, update queue statuses, and complete cuts.",
  },
  {
    key: "manage_barbers",
    label: "Barbers & Staff",
    category: "Operations",
    description: "Add new barbers, update barber profiles, set availability (Available / Break), and link services.",
  },
  {
    key: "manage_services",
    label: "Services & Pricing",
    category: "Operations",
    description: "Add or edit services, update pricing and expected durations, or toggle service availability.",
  },
  {
    key: "manage_hours",
    label: "Opening Hours & Closure",
    category: "Shop Settings",
    description: "Adjust daily opening and closing hours, weekly shift schedule, and trigger emergency closures.",
  },
  {
    key: "manage_profile",
    label: "Shop Profile & Photos",
    category: "Shop Settings",
    description: "Update shop description, phone contact, location coordinates, showcase photos, and policies.",
  },
  {
    key: "manage_upi",
    label: "Payment QR & UPI Settings",
    category: "Finance",
    description: "Upload shop UPI QR image, verify payment reference rules, and change payout details.",
  },
  {
    key: "view_analytics",
    label: "Business Analytics & Reports",
    category: "Finance",
    description: "View customer logs, payments received, daily earnings breakdown, and customer review cards.",
  },
];

export const PERMISSION_PRESETS = [
  {
    id: "full_manager",
    name: "Full Shop Manager",
    badge: "Recommended",
    description: "Complete operational autonomy to handle queue, barbers, services, hours, profile, and reports.",
    permissions: {
      manage_queue: true,
      manage_barbers: true,
      manage_services: true,
      manage_hours: true,
      manage_profile: true,
      manage_upi: true,
      view_analytics: true,
    },
  },
  {
    id: "queue_reception",
    name: "Queue & Receptionist",
    badge: "Front Desk",
    description: "Focused strictly on queue attendance, booking acceptances, calling customers, and customer flow.",
    permissions: {
      manage_queue: true,
      manage_barbers: false,
      manage_services: false,
      manage_hours: false,
      manage_profile: false,
      manage_upi: false,
      view_analytics: false,
    },
  },
  {
    id: "floor_lead",
    name: "Floor Supervisor",
    badge: "Operations",
    description: "Manages live chair assignments, barber breaks, queue pacing, hours, and daily revenue reports.",
    permissions: {
      manage_queue: true,
      manage_barbers: true,
      manage_services: false,
      manage_hours: true,
      manage_profile: false,
      manage_upi: false,
      view_analytics: true,
    },
  },
  {
    id: "custom",
    name: "Custom Access",
    badge: "Flexible",
    description: "Manually toggle specific permissions according to your shop agreement.",
    permissions: {},
  },
];

export const DEFAULT_PERMISSIONS = {
  manage_queue: true,
  manage_barbers: true,
  manage_services: true,
  manage_hours: true,
  manage_profile: false,
  manage_upi: false,
  view_analytics: true,
};

export function hasPermission(user, permKey) {
  if (!user) return false;
  // Main owner and direct shop credentials have full unrestricted access
  if (user.role === "owner" || user.role === "shop") return true;
  if (user.role === "co_owner") {
    const perms = user.permissions;
    if (!perms) return false;
    if (perms.all === true) return true;
    if (Array.isArray(perms)) return perms.includes(permKey) || perms.includes("*");
    return Boolean(perms[permKey]);
  }
  return false;
}

export function summarizePermissions(permissions = {}) {
  const activeKeys = Object.entries(permissions)
    .filter(([_, val]) => Boolean(val))
    .map(([k]) => k);
  if (!activeKeys.length) return "No permissions granted";
  if (activeKeys.length === CO_OWNER_PERMISSIONS.length) return "Full Manager Access";
  return `${activeKeys.length} of ${CO_OWNER_PERMISSIONS.length} permissions`;
}
