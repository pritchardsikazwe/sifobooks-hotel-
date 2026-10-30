import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, RefreshCw, ShieldCheck } from "lucide-react";
import { requireSupabase } from "./lib/supabase";

type Props = { hotelId: string; role: string };
type Setting = { enabled: boolean; environment: "test" | "production"; tpin: string | null; branch_id: string | null; device_serial: string | null; connector_id: string | null; connector_status: string; last_heartbeat_at: string | null; last_error_message: string | null };
type Submission = { id: string; source_type: string; source_id: string; status: string; response_code: string | null; response_message: string | null; zra_reference: string | null; created_at: string; environment: string };

export function ZraPanel({ hotelId, role }: Props) {
  const [settings, setSettings] = useState<Setting>({ enabled:false, environment:"test", tpin:"", branch_id:"", device_serial:"", connector_id:null, connector_status:"not_configured", last_heartbeat_at:null, last_error_message:null });
  const [history, setHistory] = useState<Submission[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const canConfigure = ["owner","manager","accountant"].includes(role);
  const load = useCallback(async () => {
    setError("");
    const client = requireSupabase();
    const [s, h] = await Promise.all([
      client.from("hotel_zra_settings").select("enabled,environment,tpin,branch_id,device_serial,connector_id,connector_status,last_heartbeat_at,last_error_message").eq("hotel_id",hotelId).maybeSingle(),
      client.from("hotel_zra_submissions").select("id,source_type,source_id,status,response_code,response_message,zra_reference,created_at,environment").eq("hotel_id",hotelId).order("created_at",{ascending:false}).limit(50)
    ]);
    if (s.error) throw s.error;
    if (h.error) throw h.error;
    if (s.data) setSettings(s.data as Setting);
    setHistory((h.data ?? []) as Submission[]);
  },[hotelId]);
  useEffect(()=>{ load().catch(e=>setError(e instanceof Error?e.message:String(e))); },[load]);
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError(""); setMessage("");
    try {
      if (!canConfigure) throw new Error("Only an owner, manager or accountant can change Smart Invoice settings.");
      if (settings.environment === "production" && !settings.enabled) throw new Error("Enable the integration explicitly before selecting production.");
      const client = requireSupabase();
      const { error } = await client.functions.invoke("hotel-zra-control", { body: { action:"save_settings", hotel_id:hotelId, enabled:settings.enabled, environment:settings.environment, tpin:(settings.tpin ?? "").trim(), branch_id:(settings.branch_id ?? "").trim(), device_serial:(settings.device_serial ?? "").trim() } });
      if (error) throw error;
      setMessage("Smart Invoice settings saved. Production fiscalisation remains blocked until the connector and ZRA UAT are verified.");
      await load();
    } catch(e) { setError(e instanceof Error?e.message:String(e)); }
    finally { setBusy(false); }
  };
  const pair = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const { data, error } = await requireSupabase().functions.invoke("hotel-zra-control", { body:{ action:"pair_connector", hotel_id:hotelId } });
      if (error) throw error;
      if (data?.connector_token) {
        window.prompt("Copy this connector token now. It is shown once; store it securely on the hotel's Windows connector.", data.connector_token);
        setMessage("Connector pairing token created. Configure the Windows connector with this token; never paste it into public support messages.");
      } else setMessage(data?.message ?? "Pairing request completed.");
      await load();
    } catch(e) { setError(e instanceof Error?e.message:String(e)); }
    finally { setBusy(false); }
  };
  const retry = async (item: Submission) => {
    setBusy(true); setError(""); setMessage("");
    try {
      const { error } = await requireSupabase().functions.invoke("hotel-zra-control", { body:{ action:"retry_submission", hotel_id:hotelId, submission_id:item.id } });
      if (error) throw error;
      setMessage("Safe retry queued using the original idempotency key.");
      await load();
    } catch(e) { setError(e instanceof Error?e.message:String(e)); }
    finally { setBusy(false); }
  };
  return <div className="zra-workspace">
    <div className="panel">
      <div className="panel-head"><div><h2>ZRA Smart Invoice</h2><p>Hotel-specific taxpayer settings and fiscal submission status.</p></div><span className="status-pill"><span className={settings.connector_status==="online"?"status-dot online":"status-dot"}></span>{settings.connector_status.replaceAll("_"," ")}</span></div>
      <div className="alert"><ShieldCheck size={18}/> Fiscal traffic must pass through this hotel's authenticated Windows connector to its local ZRA VSDC. This page never calls a local VSDC port from the public website.</div>
      <form onSubmit={save} className="form-grid">
        <label className="field"><span>Environment</span><select value={settings.environment} disabled={!canConfigure} onChange={e=>setSettings(s=>({...s,environment:e.target.value as Setting["environment"]}))}><option value="test">Test / sandbox</option><option value="production">Production (UAT required)</option></select></label>
        <label className="field"><span>TPIN</span><input value={settings.tpin??""} disabled={!canConfigure} onChange={e=>setSettings(s=>({...s,tpin:e.target.value}))} autoComplete="off" placeholder="Hotel taxpayer TPIN"/></label>
        <label className="field"><span>Branch ID</span><input value={settings.branch_id??""} disabled={!canConfigure} onChange={e=>setSettings(s=>({...s,branch_id:e.target.value}))} placeholder="ZRA branch identifier"/></label>
        <label className="field"><span>VSDC device serial</span><input value={settings.device_serial??""} disabled={!canConfigure} onChange={e=>setSettings(s=>({...s,device_serial:e.target.value}))} placeholder="Registered device serial"/></label>
        <label className="checkbox-field"><input type="checkbox" checked={settings.enabled} disabled={!canConfigure} onChange={e=>setSettings(s=>({...s,enabled:e.target.checked}))}/> Enable Smart Invoice integration</label>
        <div className="form-actions"><button className="primary" disabled={busy||!canConfigure}>{busy?"Saving…":"Save settings"}</button><button type="button" className="secondary" disabled={busy||!canConfigure} onClick={pair}><Link2 size={16}/> Pair Windows connector</button><button type="button" className="secondary" disabled={busy} onClick={()=>load()}><RefreshCw size={16}/> Refresh</button></div>
      </form>
      {settings.last_heartbeat_at && <p className="muted">Last connector heartbeat: {new Date(settings.last_heartbeat_at).toLocaleString()}</p>}
      {settings.last_error_message && <div className="alert error"><AlertTriangle size={17}/>{settings.last_error_message}</div>}
      <p className="muted">Production is not a certification switch. Confirm current ZRA classification, unit and tax codes, device registration, and complete ZRA UAT before fiscal use.</p>
    </div>
    <div className="panel"><div className="panel-head"><div><h2>Submission history</h2><p>Recent queue items and ZRA responses.</p></div><span>{history.length} records</span></div>
      {history.length===0?<p className="muted">No fiscal submissions yet. Invoice enqueueing is enabled only after the source transaction mapping and connector test are configured.</p>:<div className="table-wrap"><table><thead><tr>{["Created","Source","Environment","Status","ZRA reference","Response","Action"].map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{history.map(item=><tr key={item.id}><td>{new Date(item.created_at).toLocaleString()}</td><td>{item.source_type}</td><td>{item.environment}</td><td><span className="status-pill">{item.status}</span></td><td>{item.zra_reference??"—"}</td><td>{[item.response_code,item.response_message].filter(Boolean).join(" · ")||"—"}</td><td>{["rejected","retry_wait"].includes(item.status)&&<button className="small" disabled={busy} onClick={()=>retry(item)}>Retry safely</button>}</td></tr>)}</tbody></table></div>}
    </div>
  </div>;
}
