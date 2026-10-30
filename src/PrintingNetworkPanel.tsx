import { useCallback, useEffect, useState } from "react";
import { Printer, Wifi, RefreshCw, Send, Monitor, CheckCircle2, AlertTriangle } from "lucide-react";

type PrinterInfo={name:string;driver?:string;port?:string;status?:number;shared?:boolean;isDefault?:boolean};
type NetworkInfo={hostname?:string;addresses?:Array<{interface:string;address:string;netmask:string}>;platform?:string;checkedAt?:string};
const AGENT="http://127.0.0.1:17890";
export function PrintingNetworkPanel(){
 const [online,setOnline]=useState(false);
 const [printers,setPrinters]=useState<PrinterInfo[]>([]);
 const [network,setNetwork]=useState<NetworkInfo|null>(null);
 const [selected,setSelected]=useState("");
 const [text,setText]=useState("SifoBooks Hotel\nPRINT TEST\nPlease confirm that the text is clear.\n");
 const [loading,setLoading]=useState(false);
 const [sending,setSending]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [jobs,setJobs]=useState<any[]>([]);
 const refresh=useCallback(async()=>{
  setLoading(true);setError("");setNotice("");
  try{
   const h=await fetch(AGENT+"/health",{signal:AbortSignal.timeout(2500)});
   if(!h.ok)throw new Error("The local agent did not respond successfully.");
   setOnline(true);
   const [p,n,j]=await Promise.all([fetch(AGENT+"/printers"),fetch(AGENT+"/network/info"),fetch(AGENT+"/jobs")]);
   if(!p.ok||!n.ok)throw new Error("The agent is online but could not read printer or network information.");
   const pd=await p.json(),nd=await n.json(),jd=j.ok?await j.json():{jobs:[]};
   setPrinters(pd.printers||[]);setNetwork(nd);setJobs(jd.jobs||[]);
   setSelected(current=>current&&pd.printers?.some((x:PrinterInfo)=>x.name===current)?current:(pd.printers||[]).find((x:PrinterInfo)=>x.isDefault)?.name||(pd.printers||[])[0]?.name||"");
  }catch(e){setOnline(false);setPrinters([]);setNetwork(null);setError(e instanceof Error?e.message:"Cannot connect to the Windows print agent. Install and start SifoBooksHotelPrintNetwork.exe on this Windows computer.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void refresh()},[refresh]);
 const sendTest=async()=>{setSending(true);setError("");setNotice("");try{const r=await fetch(AGENT+"/print/text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text,printer:selected||undefined}),signal:AbortSignal.timeout(20000)});const d=await r.json();if(!r.ok)throw new Error(d.error||"Print job failed");setNotice("Windows spooler accepted the test text job. Please check the printer output.");await refresh()}catch(e){setError(e instanceof Error?e.message:String(e))}finally{setSending(false)}};
 return <div className="workspace-stack">
  <section className="panel"><div className="panel-heading"><div><h2><Printer size={20}/> Windows printing agent</h2><p className="muted">Connect this screen to the local Windows computer's print spooler.</p></div><button className="secondary" onClick={()=>void refresh()} disabled={loading}><RefreshCw size={16}/> Refresh</button></div>
   <div className={online?"alert success":"alert error"}>{online?<><CheckCircle2 size={17}/> Local agent online at {AGENT}</>:<><AlertTriangle size={17}/> Local agent not detected. This page cannot access a printer until the agent is installed and running on this same Windows computer.</>}</div>
   {error&&<p className="form-error">{error}</p>}{notice&&<p className="form-success">{notice}</p>}
   <div className="form-grid"><label>Windows printer<select value={selected} onChange={e=>setSelected(e.target.value)} disabled={!online||!printers.length}><option value="">Default printer</option>{printers.map(p=><option key={p.name} value={p.name}>{p.name}{p.isDefault?" (Default)":""}</option>)}</select></label><div><span className="field-label">Installed printers</span><strong className="large-value">{online?printers.length:"—"}</strong></div></div>
   {online&&printers.length===0&&<p className="muted">No Windows printers were found. Install a printer driver or connect the printer, then refresh.</p>}
  </section>
  <section className="panel"><h2><Send size={20}/> Send a test text print</h2><p className="muted">This submits plain text to the Windows spooler. It is not yet a PDF, invoice, or thermal receipt test.</p><label>Test content<textarea rows={5} value={text} onChange={e=>setText(e.target.value)} maxLength={50000}/></label><button onClick={()=>void sendTest()} disabled={!online||sending||!text.trim()}><Printer size={16}/>{sending?"Sending…":"Print test"}</button></section>
  <section className="panel"><h2><Wifi size={20}/> Windows network details</h2>{network?<><div className="form-grid"><div><span className="field-label">Computer name</span><strong>{network.hostname||"—"}</strong></div><div><span className="field-label">Platform</span><strong>{network.platform||"—"}</strong></div></div>{(network.addresses||[]).length?<div className="table-wrap"><table><thead><tr><th>Network adapter</th><th>Local IPv4</th><th>Subnet mask</th></tr></thead><tbody>{network.addresses?.map((a,i)=><tr key={a.interface+"-"+i}><td>{a.interface}</td><td>{a.address}</td><td>{a.netmask}</td></tr>)}</tbody></table></div>:<p className="muted">No active non-loopback IPv4 interface found.</p>}</>:<p className="muted">Network details appear when the local agent is running on Windows.</p>}<p className="muted"><Monitor size={15}/> The agent binds to localhost only. These details are diagnostic and do not mean other computers can print through this agent.</p></section>
  <section className="panel"><h2>Recent local print jobs</h2>{jobs.length?<div className="table-wrap"><table><thead><tr><th>Time</th><th>Printer</th><th>Status</th></tr></thead><tbody>{jobs.map(j=><tr key={j.id}><td>{j.createdAt?new Date(j.createdAt).toLocaleString():"—"}</td><td>{j.printer||"Windows default"}</td><td>{j.status}</td></tr>)}</tbody></table></div>:<p className="muted">No local print jobs recorded in this agent session.</p>}</section>
 </div>;
}
