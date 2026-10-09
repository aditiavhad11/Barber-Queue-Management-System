import { useLiveWait } from "../../hooks/useLiveWait";
export default function LiveWait({ id, minutes }) {
  const m = useLiveWait(id, minutes);
  return <>{m > 0 ? `${m} min` : "Almost your turn"}</>;
}
