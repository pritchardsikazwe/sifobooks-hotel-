import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CalendarDays, Download, Plus, RefreshCw, Search, Users, X } from "lucide-react";
import { requireSupabase } from "./lib/supabase";

type Row = Record<string, any>;
type Props = { hotel: Row; role: string; session: any; money: (value: unknown) => string };
const kinds = ["conference","meeting","wedding","banquet","workshop","training","private_event","other"];
const statuses = ["enquiry","tentative","confirmed","in_progress","completed","cancelled"];
const empty = () => {
 const start = new Date(); start.setDate(start.getDate()+1); start.setHours(9,0,0,0);
 const end = new Date(start); end.setHours(17,0,0,0);
 const local = (d:Date) => new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
 return {client_name:"",client_company:"",client_email:"",client_phone:"",event_name:"",event_type:"conference",venue_name:"",event_start:local(start),event_end:local(end),attendee_count:"20",setup_style:"theatre",catering_required:false,equipment_notes:"",package_name:"",quoted_amount:"0",deposit_required:"0",deposit_paid:"0",status:"enquiry",notes:""};
};
const fmtDate = (v:unknown) => v ? new Date(String(v)).toLocaleString() : "—";
export function EventsConferencePanel({hotel,role,session,money}:Props) {
 const [rows,setRows]=useState<Row[]>([]);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [showForm,setShowForm]=useState(false);
 const [form,setForm]=useState<any>(empty());
 const [editing,setEditing]=useState<string|null>(null);
 const [search,setSearch]=useState("");
 const [statusFilter,setStatusFilter]=useState("all");
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const canEdit=["owner","manager","receptionist","accountant"].includes(role);
 const load=useCallback(async()=>{
  if(!hotel?.id)return;
  setLoading(true);setError("");
  const {data,error}=await requireSupabase().from("hotel_event_bookings").select("*").eq("hotel_id",hotel.id).order("event_start",{ascending:true}).limit(1000);
  if(error)setError(error.message);else setRows(data||[]);
  setLoading(false);
 },[hotel?.id]);
 useEffect(()=>{void load()},[load]);
 const visible=useMemo(()=>rows.filter(r=>{
  const q=search.toLowerCase().trim();
  const matches=!q||[r.booking_reference,r.client_name,r.client_company,r.event_name,r.venue_name,r.client_phone].some(v=>String(v||"").toLowerCase().includes(q));
  return matches&&(statusFilter==="all"||r.status===statusFilter);
 }),[rows,search,statusFilter]);
 const stats=useMemo(()=>({
  upcoming:rows.filter(r=>!["cancelled","completed"].includes(r.status)&&new Date(r.event_start)>=new Date(new Date().toDateString())).length,
  confirmed:rows.filter(r=>r.status==="confirmed"||r.status==="in_progress").length,
  attendees:rows.filter(r=>!["cancelled","completed"].includes(r.status)&&new Date(r.event_start)>=new Date(new Date().toDateString())).reduce((n,r)=>n+Number(r.attendee_count||0),0),
  outstanding:rows.filter(r=>!["cancelled"].includes(r.status)).reduce((n,r)=>n+Math.max(0,Number(r.quoted_amount||0)-Number(r.deposit_paid||0)),0)
 }),[rows]);
 const startEdit=(r:Row)=>{
  setEditing(r.id);setForm({...r,event_start:new Date(new Date(r.event_start).getTime()-new Date(r.event_start).getTimezoneOffset()*60000).toISOString().slice(0,16),event_end:new Date(new Date(r.event_end).getTime()-new Date(r.event_end).getTimezoneOffset()*60000).toISOString().slice(0,16),attendee_count:String(r.attendee_count),quoted_amount:String(r.quoted_amount),deposit_required:String(r.deposit_required),deposit_paid:String(r.deposit_paid)});setShowForm(true);setError("");setNotice("");
 };
 const submit=async(e:FormEvent)=>{
  e.preventDefault();setSaving(true);setError("");setNotice("");
  try{
   const start=new Date(form.event_start),end=new Date(form.event_end);
   if(!(end>start))throw new Error("Event end must be after its start.");
   if(!form.client_name.trim()||!form.event_name.trim()||!form.venue_name.trim())throw new Error("Enter the client, event name and venue.");
   if(Number(form.attendee_count)<1||Number(form.quoted_amount)<0||Number(form.deposit_required)<0||Number(form.deposit_paid)<0)throw new Error("Attendees must be at least 1 and amounts cannot be negative.");
   if(Number(form.deposit_paid)>Number(form.quoted_amount))throw new Error("Deposit paid cannot exceed the quoted event amount.");
   const conflict=rows.find(r=>r.id!==editing&&r.venue_name.toLowerCase()===form.venue_name.trim().toLowerCase()&&!["cancelled","completed"].includes(r.status)&&new Date(form.event_start)<new Date(r.event_end)&&new Date(form.event_end)>new Date(r.event_start));
   if(conflict&&!window.confirm("Scheduling warning: this venue overlaps with "+conflict.event_name+" ("+conflict.booking_reference+"). Save anyway?")){setSaving(false);return;}
   const payload={hotel_id:hotel.id,client_name:form.client_name.trim(),client_company:form.client_company||null,client_email:form.client_email||null,client_phone:form.client_phone||null,event_name:form.event_name.trim(),event_type:form.event_type,venue_name:form.venue_name.trim(),event_start:start.toISOString(),event_end:end.toISOString(),attendee_count:Number(form.attendee_count),setup_style:form.setup_style,catering_required:!!form.catering_required,equipment_notes:form.equipment_notes||null,package_name:form.package_name||null,quoted_amount:Number(form.quoted_amount),deposit_required:Number(form.deposit_required),deposit_paid:Number(form.deposit_paid),status:form.status,notes:form.notes||null};
   const client=requireSupabase();
   if(editing){
    const {error}=await client.from("hotel_event_bookings").update(payload).eq("id",editing).eq("hotel_id",hotel.id);if(error)throw error;
    setNotice("Event booking updated.");
   }else{
    const ref="EVT-"+new Date().toISOString().slice(2,10).replaceAll("-","")+"-"+Math.random().toString(36).slice(2,6).toUpperCase();
    const {error}=await client.from("hotel_event_bookings").insert({...payload,booking_reference:ref,created_by:session?.user?.id});if(error)throw error;
    setNotice("Event enquiry/booking saved.");
   }
   setShowForm(false);setEditing(null);setForm(empty());await load();
  }catch(err){setError(err instanceof Error?err.message:String(err))}
  finally{setSaving(false)}
 };
 const changeStatus=async(r:Row,status:string)=>{
  setError("");setNotice("");
  const {error}=await requireSupabase().from("hotel_event_bookings").update({status}).eq("id",r.id).eq("hotel_id",hotel.id);
  if(error)setError(error.message);else{setNotice("Booking status updated.");await load()}
 };
 const exportCsv=()=>{
  const q=(v:unknown)=>'"'+String(v??"").replaceAll('"','""')+'"';
  const heads=["Reference","Event","Type","Client","Company","Venue","Start","End","Attendees","Quoted","Deposit paid","Balance","Status"];
  const csv=[heads,...visible.map(r=>[r.booking_reference,r.event_name,r.event_type,r.client_name,r.client_company,r.venue_name,r.event_start,r.event_end,r.attendee_count,r.quoted_amount,r.deposit_paid,Number(r.quoted_amount||0)-Number(r.deposit_paid||0),r.status])].map(a=>a.map(q).join(",")).join("\r\n");
  const url=URL.createObjectURL(new Blob(["\ufeff",csv],{type:"text/csv;charset=utf-8"}));const a=document.createElement("a");a.href=url;a.download="sifobooks-events-conferences.csv";a.click();URL.revokeObjectURL(url);
 };
 const field=(key:string,label:string,type="text",required=false)=><label className="event-field">{label}<input type={type} required={required} value={form[key]??""} onChange={e=>setForm((f:any)=>({...f,[key]:e.target.value}))}/></label>;
 return <div className="events-workspace">
  <section className="page-intro"><div className="page-intro-mark"><CalendarDays size={25}/></div><div className="page-intro-copy"><div className="hero-kicker">HOSPITALITY · EVENTS</div><h2>Events & Conferences</h2><p>Manage conference rooms, meetings, weddings, training sessions, banquets and private functions from enquiry to completion.</p></div><span className="intro-status"><span/> EVENT DESK</span></section>
  {error&&<div className="alert error">{error}</div>}{notice&&<div className="alert success">{notice}</div>}
  <div className="events-metrics"><article className="metric"><small>Upcoming events</small><strong>{stats.upcoming}</strong><span>Not cancelled or completed</span></article><article className="metric"><small>Confirmed / in progress</small><strong>{stats.confirmed}</strong><span>Scheduled bookings</span></article><article className="metric"><small>Expected attendees</small><strong>{stats.attendees.toLocaleString()}</strong><span>Upcoming events</span></article><article className="metric"><small>Unpaid balance</small><strong>{money(stats.outstanding)}</strong><span>Quoted amount less deposits paid</span></article></div>
  <section className="panel"><div className="panel-head"><div><h2>Event booking register</h2><p>Track client enquiries, venue schedules, event packages, deposits and booking status.</p></div><div className="events-actions"><button className="secondary" onClick={()=>void load()}><RefreshCw size={15}/> Refresh</button><button className="secondary" onClick={exportCsv}><Download size={15}/> Export CSV</button>{canEdit&&<button className="primary" onClick={()=>{setEditing(null);setForm(empty());setShowForm(true);setError("");setNotice("")}}><Plus size={16}/> New event</button>}</div></div>
   <div className="events-filters"><label><Search size={15}/><input placeholder="Search event, client, venue or reference" value={search} onChange={e=>setSearch(e.target.value)}/></label><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="all">All statuses</option>{statuses.map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></div>
   {loading?<p>Loading event bookings…</p>:visible.length===0?<div className="events-empty"><CalendarDays size={30}/><h3>No event bookings yet</h3><p>Add your first conference or event enquiry to start managing venue dates, client requirements and deposits.</p></div>:<div className="table-scroll"><table><thead><tr><th>Event / reference</th><th>Client</th><th>Venue & date</th><th>Attendees</th><th>Quoted / deposit</th><th>Status</th><th>Actions</th></tr></thead><tbody>{visible.map(r=><tr key={r.id}><td><strong>{r.event_name}</strong><small className="event-ref">{r.booking_reference} · {r.event_type.replaceAll("_"," ")}</small></td><td>{r.client_name}<small className="event-ref">{r.client_company||r.client_phone||r.client_email||"—"}</small></td><td>{r.venue_name}<small className="event-ref">{fmtDate(r.event_start)} – {new Date(r.event_end).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</small></td><td><Users size={14}/> {r.attendee_count}</td><td><strong>{money(r.quoted_amount)}</strong><small className="event-ref">Deposit {money(r.deposit_paid)} · Balance {money(Math.max(0,Number(r.quoted_amount||0)-Number(r.deposit_paid||0)))}</small></td><td><span className={"event-status status-"+r.status}>{r.status.replaceAll("_"," ")}</span></td><td><div className="events-row-actions">{canEdit&&<button className="small" onClick={()=>startEdit(r)}>Edit</button>}<select aria-label="Change event status" className="inline-select" value={r.status} onChange={e=>void changeStatus(r,e.target.value)} disabled={!canEdit}>{statuses.map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></div></td></tr>)}</tbody></table></div>}
  </section>
  {showForm&&<div className="events-modal-backdrop" role="presentation"><section className="events-modal" role="dialog" aria-modal="true" aria-labelledby="event-form-title"><div className="panel-head"><div><h2 id="event-form-title">{editing?"Edit event booking":"Create event booking"}</h2><p>Capture client requirements and confirm venue availability before committing.</p></div><button className="small" type="button" onClick={()=>setShowForm(false)} aria-label="Close"><X size={16}/></button></div>
   <form onSubmit={submit}><div className="events-form-grid">{field("client_name","Client / organisation contact","text",true)}{field("client_company","Company / organisation")}{field("client_email","Email","email")}{field("client_phone","Phone / WhatsApp","tel")}{field("event_name","Event name","text",true)}<label className="event-field">Event type<select value={form.event_type} onChange={e=>setForm((f:any)=>({...f,event_type:e.target.value}))}>{kinds.map(k=><option key={k} value={k}>{k.replaceAll("_"," ")}</option>)}</select></label>{field("venue_name","Conference room / venue","text",true)}{field("event_start","Start date & time","datetime-local",true)}{field("event_end","End date & time","datetime-local",true)}{field("attendee_count","Expected attendees","number",true)}<label className="event-field">Room setup<select value={form.setup_style} onChange={e=>setForm((f:any)=>({...f,setup_style:e.target.value}))}>{["theatre","classroom","boardroom","u_shape","banquet","cocktail","custom"].map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label>{field("package_name","Package / rate plan")}{field("quoted_amount","Quoted total","number")}{field("deposit_required","Deposit required","number")}{field("deposit_paid","Deposit received","number")}<label className="event-field">Booking status<select value={form.status} onChange={e=>setForm((f:any)=>({...f,status:e.target.value}))}>{statuses.map(s=><option key={s} value={s}>{s.replaceAll("_"," ")}</option>)}</select></label><label className="event-field event-checkbox"><input type="checkbox" checked={!!form.catering_required} onChange={e=>setForm((f:any)=>({...f,catering_required:e.target.checked}))}/> Catering / refreshments required</label><label className="event-field event-wide">Equipment & AV requirements<textarea rows={2} value={form.equipment_notes} onChange={e=>setForm((f:any)=>({...f,equipment_notes:e.target.value}))} placeholder="Projector, microphones, screen, Wi-Fi, hybrid meeting…"/></label><label className="event-field event-wide">Additional notes<textarea rows={2} value={form.notes} onChange={e=>setForm((f:any)=>({...f,notes:e.target.value}))}/></label></div><div className="events-form-footer"><button type="button" className="secondary" onClick={()=>setShowForm(false)}>Cancel</button><button type="submit" className="primary" disabled={saving}>{saving?"Saving…":editing?"Save changes":"Save event booking"}</button></div></form>
  </section></div>}
 </div>;
}
