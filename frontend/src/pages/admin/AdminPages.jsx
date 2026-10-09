import { relativeTime } from "../../utils/relativeTime";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, Check, X, Ban, RotateCcw, Search, Bell, ShieldCheck, Save, Trash2, ExternalLink } from "lucide-react";
import { useOwner } from "../../hooks/useOwnerStore";
import { PageHead, StatusBadge, Badge, Modal, Empty } from "../../components/common/ui";

const fmtStatus = (s) => ({ pending:"Pending", approved:"Approved", rejected:"Rejected", suspended:"Suspended" }[s] || s);

function Table({ children }) { return <div className="overflow-x-auto border-y border-khaki"><table className="w-full text-sm">{children}</table></div>; }
function Th({children}) { return <th className="text-left label py-3 px-3 whitespace-nowrap">{children}</th>; }
function Td({children}) { return <td className="py-3 px-3 border-t border-khaki align-top">{children}</td>; }

export function AdminDashboard() {
  const { shops, adminData, removeNotification } = useOwner();
  const payments = shops.flatMap(s => s.payments || []);
  const pending = shops.filter(s => s.status === "pending").length;
  const active = shops.filter(s => s.status === "approved" && s.active).length;
  const successful = payments.filter(p => p.status === "Successful").reduce((n,p)=>n+p.amount,0);
  const stats = [["Total shops", shops.length],["Pending approvals",pending],["Active shops",active],["Successful payments","₹"+successful]];
  return <><PageHead title="Dashboard" sub="Platform health, approvals and recent activity." />
    <dl className="grid grid-cols-2 md:grid-cols-4 border-y border-khaki divide-x divide-khaki">{stats.map(([k,v])=><div className="p-5" key={k}><dt className="label">{k}</dt><dd className="font-serif text-4xl mt-1">{v}</dd></div>)}</dl>
    <div className="grid md:grid-cols-3 gap-8 mt-10">
      <section className="border border-khaki p-5"><h2 className="text-2xl mb-3">Approval queue</h2>{shops.filter(s=>s.status==="pending").slice(0,4).map(s=><div key={s.id} className="py-3 border-b border-khaki flex justify-between"><span>{s.name}<br/><small>{s.address}</small></span><StatusBadge s="Pending"/></div>)}{!pending&&<p className="text-sm text-coffee/60">No shops awaiting review.</p>}<Link to="/admin/approvals" className="underline text-sm mt-4 inline-block">Review submissions</Link></section>
      <section className="border border-khaki p-5"><h2 className="text-2xl mb-3">Recent payments</h2>{payments.slice(0,5).map(p=><div key={p.id} className="py-2 border-b border-khaki flex justify-between text-sm"><span>{p.customer}<br/><small>{p.id}</small></span><span>₹{p.amount}<br/><StatusBadge s={p.status}/></span></div>)}</section>
      <section className="border border-khaki p-5"><h2 className="text-2xl mb-3">Platform alerts</h2>{!adminData.notifications.length?<p className="text-sm text-coffee/60">No platform alerts.</p>:adminData.notifications.map(n=><div key={n.id} className="py-2 border-b border-khaki text-sm flex items-start justify-between gap-3"><p>{n.text}<br/><small>{relativeTime(n.createdAt || n.time)}</small></p><button type="button" className="text-coffee/50 hover:text-rose" title="Delete notification" onClick={()=>removeNotification(n.id)}><Trash2 size={15}/></button></div>)}</section>
    </div>
  </>;
}

export function ShopApprovals() {
  const { shops, adminUpdateShop, serverUsers } = useOwner();
  const [selected,setSelected]=useState(null); const [reason,setReason]=useState(""); const [busy,setBusy]=useState(false);
  const [searchParams] = useSearchParams(); const navigate = useNavigate();
  const pending=shops.filter(s=>s.status==="pending");
  const reviewId=searchParams.get("shopId");
  const reviewShop=reviewId ? shops.find(s=>s.id===reviewId) : null;
  useEffect(() => { if (reviewShop) setSelected(reviewShop); }, [reviewShop]);
  const closeModal=(force=false)=>{ if(busy && !force) return; setSelected(null); setReason(""); if(reviewId) navigate("/admin/approvals",{replace:true}); };
  const decide=async(status)=>{ if(status==="rejected"&&!reason.trim()) return; setBusy(true); try { await adminUpdateShop(selected.id,{status,rejection:status==="rejected"?reason.trim():"",approved:status==="approved",active:status==="approved"}); closeModal(true); } catch(e) { window.alert(e.message); } finally { setBusy(false); } };
  return <><PageHead title="Shop Approvals" sub="Review the complete Owner submission before changing its platform status." />
    {!pending.length?<Empty title="Approval queue is clear" text="New Owner submissions will appear here."/>:
    <div className="space-y-3">{pending.map(s=><div key={s.id} className="border border-khaki p-5 flex flex-wrap justify-between gap-4">
      <div><div className="flex gap-2 items-center"><h2 className="text-2xl">{s.name}</h2><StatusBadge s="Pending"/></div><p className="text-sm text-coffee/60 mt-1">{s.address} · {s.contact}</p><p className="text-sm mt-2">{s.description}</p></div>
      <button className="btn" onClick={()=>setSelected(s)}><Eye size={16}/>View complete submission</button>
    </div>)}</div>}
    {selected&&<Modal title={selected.name} onClose={closeModal} actions={<>{selected.status === "pending" && <button className="btn-ghost" disabled={busy} onClick={()=>decide("rejected")}><X size={15}/>Reject</button>}{selected.status !== "approved" && <button className="btn" disabled={busy} onClick={()=>decide("approved")}><Check size={15}/>{busy?"Saving...":selected.status === "suspended" ? "Reactivate" : "Approve"}</button>}</>}>
      <div className="space-y-5 text-sm">
        <div className="grid md:grid-cols-2 gap-3"><div><span className="label">Owner</span><p>{serverUsers.find(u=>u.id===selected.ownerId)?.name || selected.ownerId || "-"}</p></div><div><span className="label">Owner email</span><p>{serverUsers.find(u=>u.id===selected.ownerId)?.email || "-"}</p></div><div><span className="label">Contact</span><p>{selected.contact}</p></div><div><span className="label">Shop login email</span><p>{selected.loginEmail || "Not configured"}</p></div><div><span className="label">Address</span><p>{selected.address}</p></div><div><span className="label">Hours</span><p>{selected.hours?.open} – {selected.hours?.close}</p></div></div>
        <div><span className="label">Exact location</span>{selected.location?.lat != null && selected.location?.lng != null ? <a className="btn-ghost mt-1" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.location.lat},${selected.location.lng}`)}`} target="_blank" rel="noreferrer"><ExternalLink size={15}/>Open exact location in Google Maps</a> : <p>Not configured</p>}</div>
        {selected.photos?.length>0&&<div><span className="label">Shop photos</span><div className="grid grid-cols-2 gap-2 mt-2">{selected.photos.map(p=><img key={p.id} src={p.url} className="w-full aspect-[4/3] object-cover border border-khaki" alt="Shop"/>)}</div></div>}
        <div><span className="label">Services, pricing & duration</span>{(selected.services||[]).map((x,i)=><p key={i} className="flex justify-between border-b border-khaki py-2"><span>{x.name} {x.enabled===false?"(Disabled)":""}</span><span>₹{x.price} · {x.duration} min</span></p>)}</div>
        <div><span className="label">Barbers</span>{(selected.barbers||selected.barbersList||[]).map((b,i)=><div key={b.id||i} className="border border-khaki p-3 mt-2 flex items-center gap-3"><img src={b.photo||""} alt="" className="w-12 h-12 rounded-full object-cover bg-khaki"/><div><b>{b.name}</b><p className="text-xs text-coffee/60">{b.gender||""} · {b.experience||0} yrs · {b.specialization||""}</p><p className="text-xs mt-1">Services: {(b.services||[]).map(id => (selected.services||[]).find(s=>s.id===id)?.name).filter(Boolean).join(", ") || "-"}</p></div></div>)}</div>
        <div><span className="label">Availability</span><p>{selected.availability?.mode || "Queue"} · {(selected.availability?.days||[]).join(", ")}</p><p>{selected.availability?.note || ""}</p></div>
        <div><span className="label">Policies</span>{Object.entries(selected.policy||{}).map(([k,v])=><p key={k} className="mt-1"><b>{k}:</b> {v}</p>)}</div>
        {selected.status === "rejected" && selected.rejection && <div className="border border-rose/30 bg-rose/10 p-4 text-rose"><span className="label !text-rose">Current rejection reason</span><p className="mt-1 whitespace-pre-wrap">{selected.rejection}</p></div>}
        {selected.status === "pending" && <div className="pt-3 border-t border-khaki"><label className="label">Rejection reason (required to reject)</label><textarea className="input mt-1" rows={2} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Explain what the Owner must fix before resubmitting."/></div>}
      </div>
    </Modal>}
  </>;
}

export function AllShops() {
  const { shops, adminUpdateShop, serverUsers }=useOwner(); const [q,setQ]=useState(""); const [busy,setBusy]=useState("");
  const rows=shops.filter(s=>`${s.name} ${s.address}`.toLowerCase().includes(q.toLowerCase()));
  const change=async(s,status)=>{setBusy(s.id);try{await adminUpdateShop(s.id,{status,active:status==="approved",approved:status==="approved"});}catch(e){window.alert(e.message);}finally{setBusy("")}};
  return <><PageHead title="All Shops" sub="The same shared shop registry used by Owner submissions."/>
    <div className="relative mb-5"><Search size={17} className="absolute left-4 top-3.5 text-coffee/50"/><input className="input pl-11" placeholder="Search shops" value={q} onChange={e=>setQ(e.target.value)}/></div>
    <Table><thead><tr><Th>Shop</Th><Th>Owner</Th><Th>Status</Th><Th>Address</Th><Th>Action</Th></tr></thead><tbody>{rows.map(s=>{const owner=serverUsers.find(u=>u.id===s.ownerId);return <tr key={s.id}><Td><b>{s.name}</b><br/><small>{s.id}</small></Td><Td>{owner?.email || owner?.name || "-"}</Td><Td><StatusBadge s={fmtStatus(s.status)}/></Td><Td>{s.address||"-"}</Td><Td>{s.status==="suspended"?<button className="underline" disabled={busy===s.id} onClick={()=>change(s,"approved")}>{busy===s.id?"Updating...":"Reactivate"}</button>:s.status==="approved"?<button className="underline text-rose" disabled={busy===s.id} onClick={()=>change(s,"suspended")}>{busy===s.id?"Suspending...":"Suspend"}</button>:<Link className="underline" to={`/admin/approvals?shopId=${s.id}`}>Review</Link>}</Td></tr>})}</tbody></Table>
  </>;
}

export function Owners(){const {shops,serverUsers}=useOwner(); const accounts=serverUsers.filter(a=>a.role==="owner"); const rows=accounts.map(a=>[a.id,a.name,a.email,shops.filter(s=>s.ownerId===a.id).map(s=>s.name).join(", ") || "No shop","Active"]); return <SimplePeople title="Owners" sub="Owner accounts and their current shop association." rows={rows} headers={["ID","Owner","Email","Shop","Status"]}/>;}
export function Customers(){
  const {shops,serverUsers}=useOwner();
  const [selected,setSelected]=useState(null);
  const accounts=serverUsers.filter(a=>a.role==="customer");
  const bookings=shops.flatMap(shop=>(shop.payments||[]).map(p=>({ ...p, shopName: shop.name })));
  return <><PageHead title="Customers" sub="Customer accounts, booking count, shops and services."/>
    {!accounts.length ? <Empty title="No customers" text="Customer accounts will appear here after registration."/> : <Table><thead><tr><Th>ID</Th><Th>Customer</Th><Th>Email</Th><Th>Bookings</Th><Th>Booking details</Th><Th>Status</Th></tr></thead><tbody>{accounts.map(a=>{const mine=bookings.filter(p=>p.customerId===a.id);return <tr key={a.id}><Td>{a.id}</Td><Td>{a.name}</Td><Td>{a.email}</Td><Td>{mine.length}</Td><Td>{mine.length ? <button className="underline" onClick={()=>setSelected({customer:a,bookings:mine})}>View shops & services</button> : "No bookings"}</Td><Td><StatusBadge s="Active"/></Td></tr>})}</tbody></Table>}
    {selected&&<Modal title={`${selected.customer.name}'s bookings`} onClose={()=>setSelected(null)}><div className="space-y-3">{selected.bookings.map((p)=><div key={p.id} className="border border-khaki p-3"><div className="flex justify-between gap-3"><b>{p.shopName}</b><span>₹{p.amount}</span></div><p className="text-sm mt-1">{p.service}</p><p className="text-xs text-coffee/60 mt-1">{p.barber} · {p.date} {p.time} · {p.status}</p></div>)}</div></Modal>}
  </>;
}
export function Barbers(){const {shops}=useOwner(); const rows=shops.flatMap(s=>(s.barbersList||[]).map(b=>[b.id,b.name,s.name,b.status||"Available"])); return <SimplePeople title="Barbers" sub="Barbers associated with platform shops." rows={rows} headers={["ID","Barber","Shop","Status"]}/>}

function SimplePeople({title,sub,rows,headers}){return <><PageHead title={title} sub={sub}/><Table><thead><tr>{headers.map(h=><Th key={h}>{h}</Th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((x,j)=><Td key={j}>{j===r.length-1?<StatusBadge s={x}/>:x}</Td>)}</tr>)}</tbody></Table></>}

export function Payments(){const {shops}=useOwner(); const payments=shops.flatMap(s=>s.payments||[]);return <><PageHead title="Payments" sub="Platform payment transactions."/>{!payments.length?<Empty title="No payments yet" text="Payments will appear after a customer joins a queue through mock payment."/>:<Table><thead><tr>{["ID","Customer","Service","Amount","Date","Status"].map(h=><Th key={h}>{h}</Th>)}</tr></thead><tbody>{payments.map(p=><tr key={p.id}><Td>{p.id}</Td><Td>{p.customer}</Td><Td>{p.service}</Td><Td>₹{p.amount}</Td><Td>{p.date}<br/>{p.time}</Td><Td><StatusBadge s={p.status}/></Td></tr>)}</tbody></Table>}</>;}
export function Refunds(){return <><PageHead title="Refunds" sub="Review and track refund requests."/><Empty title="No refunds yet" text="Refund records will appear after a real refund request is created."/></>;}
export function Complaints(){const {adminData}=useOwner(); const rows=adminData?.complaints||[]; return <><PageHead title="Complaints" sub="Customer complaints and resolution state."/>{!rows.length?<Empty title="No complaints yet" text="Customer complaints will appear here after submission."/>:<Table><thead><tr>{["ID","Customer","Shop","Issue","Subject","Status","Created"].map(h=><Th key={h}>{h}</Th>)}</tr></thead><tbody>{rows.map(c=><tr key={c.id}><Td>{c.id}</Td><Td>{c.customerId}</Td><Td>{c.shop}</Td><Td>{c.issueType}</Td><Td>{c.subject}</Td><Td><StatusBadge s={c.status}/></Td><Td>{relativeTime(c.createdAt)}</Td></tr>)}</tbody></Table>}</>}

export function Reviews(){const {shops}=useOwner(); const rows=shops.flatMap(s=>(s.reviewsList||[]).map(r=>[r.id,r.customer,s.name,r.rating,r.text])); return <><PageHead title="Reviews" sub="Reviews submitted by real customers after completed services."/>{!rows.length?<Empty title="No reviews yet" text="Reviews will appear after customers complete a service and submit one."/>:<Table><thead><tr>{["ID","Customer","Shop","Rating","Review"].map(h=><Th key={h}>{h}</Th>)}</tr></thead><tbody>{rows.map(r=><tr key={r[0]}><Td>{r[0]}</Td><Td>{r[1]}</Td><Td>{r[2]}</Td><Td>{r[3]}/5</Td><Td>{r[4]}</Td></tr>)}</tbody></Table>}</>;}
export function AdminNotifications(){
  const { adminData, sendAnnouncement, removeNotification } = useOwner();
  const [text, setText] = useState("");
  const send = () => { if (!text.trim()) return; sendAnnouncement(text); setText(""); };
  const list = adminData.notifications || [];
  return <><PageHead title="Notifications" sub="Platform-wide announcements and alerts."/>
    <div className="flex gap-2 mb-6"><input className="input" placeholder="Write an announcement" value={text} onChange={e=>setText(e.target.value)}/><button className="btn" onClick={send}><Bell size={16}/>Send</button></div>
    {!list.length ? <Empty title="No notifications" text="Platform notifications will appear here."/> : list.map(n=><div key={n.id} className="py-4 border-b border-khaki flex justify-between gap-3"><div><b>{n.text}</b><p className="text-xs text-coffee/60 mt-1">{relativeTime(n.createdAt || n.time)}</p></div><button type="button" className="text-coffee/50 hover:text-rose" title="Delete notification" onClick={()=>removeNotification(n.id)}><Trash2 size={16}/></button></div>)}
  </>;
}
export function Security(){return <><PageHead title="Security" sub="Administrative access controls and security events."/><div className="grid md:grid-cols-2 gap-5">{[["Admin 2FA","Enabled"],["Session timeout","30 minutes"],["Failed login alerts","Enabled"],["Audit logging","Enabled"]].map(([k,v])=><div className="border border-khaki p-5 flex justify-between" key={k}><span>{k}</span><Badge tone="ok">{v}</Badge></div>)}</div><h2 className="text-2xl mt-10 mb-3">Recent security events</h2><Empty title="No security events yet" text="Live audit events will appear after backend audit logging is connected."/></>;}
export function AdminSettings(){const [saved,setSaved]=useState(false); const [s,setS]=useState({approval:true,autoSuspend:false,maintenance:false});return <><PageHead title="Settings" sub="Platform configuration for administrators."/><div className="max-w-xl space-y-4">{Object.entries({approval:"Require approval for new shops",autoSuspend:"Auto-suspend shops after repeated complaints",maintenance:"Maintenance mode"}).map(([k,l])=><label className="border border-khaki p-4 flex justify-between gap-4" key={k}><span>{l}</span><input type="checkbox" checked={s[k]} onChange={e=>setS({...s,[k]:e.target.checked})}/></label>)}<button className="btn" onClick={()=>{setSaved(true);setTimeout(()=>setSaved(false),1800)}}><Save size={16}/>Save settings</button>{saved&&<span className="text-sm text-olive ml-3">Saved</span>}</div></>;}
