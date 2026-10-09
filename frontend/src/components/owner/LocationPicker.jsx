import { useState } from "react";
import { MapPin, Check, LocateFixed, ExternalLink } from "lucide-react";
export default function LocationPicker({
  address,
  onAddress,
  location,
  onLocation,
  error,
}) {
  const [busy, setBusy] = useState(false);
  const [locErr, setLocErr] = useState("");
  const find = async () => {
    if (!address.trim()) return;
    setBusy(true);
    setLocErr("");
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address.trim())}`,
      );
      const rows = await res.json();
      if (!rows?.length)
        throw new Error(
          "No location was found for this address. Enter a more complete address or set the coordinates manually.",
        );
      onLocation({
        lat: +Number(rows[0].lat).toFixed(7),
        lng: +Number(rows[0].lon).toFixed(7),
        confirmed: false,
      });
    } catch (e) {
      setLocErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const current = () => {
    setLocErr("");
    if (!navigator.geolocation)
      return setLocErr("Your browser does not support location access.");
    navigator.geolocation.getCurrentPosition(
      (p) =>
        onLocation({
          lat: +p.coords.latitude.toFixed(7),
          lng: +p.coords.longitude.toFixed(7),
          confirmed: false,
        }),
      () =>
        setLocErr(
          "Could not read the current location. You can enter latitude and longitude manually.",
        ),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  };
  const setCoord = (key, value) =>
    onLocation({
      ...(location || { confirmed: false }),
      [key]: value === "" ? "" : Number(value),
    });
  const mapsUrl =
    location?.lat != null && location?.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${location.lat},${location.lng}`)}`
      : "";
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="Shop address"
          value={address}
          onChange={(e) => {
            onAddress(e.target.value);
          }}
        />
        <button
          type="button"
          className="btn-ghost shrink-0"
          onClick={find}
          disabled={busy || !address.trim()}
        >
          <MapPin size={16} />
          {busy ? "Finding" : "Find on map"}
        </button>
      </div>
      <button type="button" className="btn-ghost" onClick={current}>
        <LocateFixed size={16} />
        Use my current location
      </button>
      {location && (
        <>
          <iframe
            title="shop map"
            className="w-full h-52 border border-khaki grayscale"
            src={`https://www.openstreetmap.org/export/embed.html?bbox=${Number(location.lng) - 0.008}%2C${Number(location.lat) - 0.006}%2C${Number(location.lng) + 0.008}%2C${Number(location.lat) + 0.006}&layer=mapnik&marker=${location.lat}%2C${location.lng}`}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {mapsUrl && (
              <a
                className="btn-ghost"
                href={mapsUrl}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} />
                Open exact location in Google Maps
              </a>
            )}
            {location.confirmed ? (
              <span className="text-olive flex items-center gap-1 text-sm">
                <Check size={16} />
                Location confirmed
              </span>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => onLocation({ ...location, confirmed: true })}
              >
                Confirm shop location
              </button>
            )}
          </div>
          <details className="text-xs text-coffee/60">
            <summary className="cursor-pointer select-none">
              Advanced coordinates
            </summary>
            <div className="grid md:grid-cols-2 gap-3 mt-2">
              <label className="text-sm">
                Latitude
                <input
                  type="number"
                  step="0.0000001"
                  className="input"
                  value={location.lat ?? ""}
                  onChange={(e) => setCoord("lat", e.target.value)}
                />
              </label>
              <label className="text-sm">
                Longitude
                <input
                  type="number"
                  step="0.0000001"
                  className="input"
                  value={location.lng ?? ""}
                  onChange={(e) => setCoord("lng", e.target.value)}
                />
              </label>
            </div>
          </details>
        </>
      )}
      <p className="text-xs text-coffee/60">
        The map pin is used as the exact public shop location. Use the map
        button instead of relying on latitude/longitude numbers.
      </p>
      {(error || locErr) && (
        <p className="text-sm text-rose">{error || locErr}</p>
      )}
    </div>
  );
}
