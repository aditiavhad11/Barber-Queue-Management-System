import { useEffect, useState } from "react";
import { useOwner } from "../../hooks/useOwnerStore";
import { api } from "../../services/api";
import { Empty, PageHead } from "../../components/common/ui";
import { formatDateDisplay } from "../../utils/closedDays";
import { notifyError, notifySuccess } from "../../utils/toast";

const todayKey = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

export default function Prebookings() {
  const { shop, refreshBookings } = useOwner();
  const [date, setDate] = useState("");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    let active = true;
    if (!shop?.id) return undefined;
    setLoading(true);
    api
      .get("/bookings/prebookings", { params: { date, page, pageSize } })
      .then(({ data }) => {
        if (active) setResult(data || { items: [], total: 0 });
      })
      .catch((error) => {
        if (active)
          notifyError(
            error.response?.data?.message || "Could not load prebookings.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [shop?.id, date, page, pageSize]);

  const pages = Math.max(1, Math.ceil(result.total / pageSize));
  const takeInQueue = async (booking) => {
    setBusyId(booking.id);
    try {
      await api.patch(`/bookings/${booking.id}/take-into-queue`);
      notifySuccess("Customer added to today's queue.");
      setResult((current) => ({
        ...current,
        items: current.items.filter((item) => item.id !== booking.id),
        total: Math.max(0, current.total - 1),
      }));
      refreshBookings();
    } catch (error) {
      notifyError(
        error.response?.data?.message || "Could not add customer to the queue.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="fade">
      <PageHead
        title="Prebookings"
        sub="Accepted bookings for another date stay here until you take today's customers into the live queue."
      />
      <div className="flex flex-wrap items-end gap-4 mb-8">
        <label className="block">
          <span className="label">Filter by booking date</span>
          <input
            className="input mt-2"
            type="date"
            value={date}
            onChange={(event) => {
              setDate(event.target.value);
              setPage(1);
            }}
          />
          {date && (
            <button
              className="btn-ghost !py-2 mt-2"
              type="button"
              onClick={() => {
                setDate("");
                setPage(1);
              }}
            >
              Show all dates
            </button>
          )}
        </label>
        <label className="block">
          <span className="label">Customers per page</span>
          <select
            className="input mt-2"
            value={pageSize}
            onChange={(event) => {
              setPageSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 20, 30].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading ? (
        <p className="text-soft">Loading prebookings...</p>
      ) : !result.items.length ? (
        <Empty
          title="No prebookings"
          text={
            date
              ? `No accepted prebookings for ${formatDateDisplay(date, true)}.`
              : "There are no accepted prebookings."
          }
        />
      ) : (
        <div className="border-t border-khaki">
          {result.items.map((booking) => (
            <div
              key={booking.id}
              className="py-5 border-b border-khaki flex flex-wrap items-center justify-between gap-4"
            >
              <div>
                <p className="text-sm text-soft mb-1">
                  Booking date: {formatDateDisplay(booking.bookingDate, true)}
                </p>
                <b className="text-lg">
                  {booking.beneficiary?.isSelf === false
                    ? booking.beneficiary.name
                    : booking.customerName}
                </b>
                {booking.beneficiary?.isSelf === false && (
                  <span className="text-xs text-soft ml-2">
                    Booked by {booking.customerName}
                  </span>
                )}
                <p className="text-sm text-soft mt-1">
                  {booking.services.map((service) => service.name).join(" + ")}{" "}
                  with {booking.barberName} · ₹{booking.amount}
                </p>
              </div>
              <button
                className="btn !py-2"
                disabled={
                  booking.bookingDate !== todayKey() || busyId === booking.id
                }
                title={
                  booking.bookingDate !== todayKey()
                    ? "Only today's customers can join the queue."
                    : ""
                }
                onClick={() => takeInQueue(booking)}
              >
                {busyId === booking.id ? "Working" : "Take in the queue"}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between mt-6 text-sm">
        <span className="text-soft">
          {result.total} customer{result.total === 1 ? "" : "s"}
        </span>
        <div className="flex gap-2">
          <button
            className="btn-ghost !py-2"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </button>
          <span className="px-2 py-2 text-soft">
            {page} / {pages}
          </span>
          <button
            className="btn-ghost !py-2"
            disabled={page >= pages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
