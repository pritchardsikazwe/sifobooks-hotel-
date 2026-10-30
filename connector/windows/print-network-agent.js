import http from "node:http";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync=promisify(execFile);
const HOST="127.0.0.1";
const PORT=17890;
const allowedOrigins=new Set(["https://hotel.sifobooks.com","http://localhost:5173","http://127.0.0.1:5173","http://localhost:4173","http://127.0.0.1:4173","capacitor://localhost","http://localhost"]);
const jobs=new Map();
const json=(res,status,body)=>{res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});res.end(JSON.stringify(body));};
async function printers(){
 const {stdout}=await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-Command","Get-Printer | Select-Object Name,DriverName,PortName,PrinterStatus,Shared | ConvertTo-Json -Compress"],{timeout:8000,maxBuffer:1024*1024});
 let p=[];try{const v=JSON.parse(stdout.trim()||"[]");p=Array.isArray(v)?v:(v?[v]:[])}catch{}
 let def="";try{const d=await execFileAsync("powershell.exe",["-NoProfile","-NonInteractive","-Command","(Get-CimInstance Win32_Printer -Filter 'Default=True' | Select-Object -First 1 -ExpandProperty Name)"],{timeout:5000});def=d.stdout.trim()}catch{}
 return p.map(x=>({name:x.Name,driver:x.DriverName,port:x.PortName,status:x.PrinterStatus,shared:!!x.Shared,isDefault:x.Name===def}));
}
function networkInfo(){
 const interfaces=os.networkInterfaces(),addresses=[];
 for(const [name,items] of Object.entries(interfaces))for(const i of items||[])if(i.family==="IPv4"&&!i.internal)addresses.push({interface:name,address:i.address,netmask:i.netmask,mac:i.mac});
 return {hostname:os.hostname(),addresses,platform:os.platform(),checkedAt:new Date().toISOString()};
}
async function body(req){let raw="";for await(const chunk of req){raw+=chunk;if(raw.length>2_000_000)throw Error("Request too large");}return raw?JSON.parse(raw):{};}
const server=http.createServer(async(req,res)=>{
 const origin=req.headers.origin;
 if(origin&&!allowedOrigins.has(origin)){json(res,403,{error:"Origin not allowed"});return;}
 if(origin)res.setHeader("Access-Control-Allow-Origin",origin);
 res.setHeader("Vary","Origin");res.setHeader("Access-Control-Allow-Methods","GET,POST,OPTIONS");res.setHeader("Access-Control-Allow-Headers","Content-Type");
 if(req.method==="OPTIONS"){res.writeHead(204);res.end();return;}
 try{
  const url=new URL(req.url||"/","http://127.0.0.1");
  if(req.method==="GET"&&url.pathname==="/health"){json(res,200,{ok:true,service:"SifoBooks Hotel Print & Network Agent",version:1,port:PORT});return;}
  if(req.method==="GET"&&url.pathname==="/network/info"){json(res,200,networkInfo());return;}
  if(req.method==="GET"&&url.pathname==="/printers"){json(res,200,{printers:await printers()});return;}
  if(req.method==="GET"&&url.pathname==="/jobs"){json(res,200,{jobs:[...jobs.values()].slice(-100).reverse()});return;}
  if(req.method==="POST"&&url.pathname==="/print/text"){
   const b=await body(req);
   if(typeof b.text!=="string"||!b.text.trim()||b.text.length>50000){json(res,400,{error:"Provide printable text (maximum 50,000 characters)."});return;}
   const list=await printers();const target=String(b.printer||"");
   if(target&&!list.some(p=>p.name===target)){json(res,400,{error:"Selected printer is not installed on this Windows computer."});return;}
   const id=crypto.randomUUID();const job={id,type:"text",printer:target||list.find(p=>p.isDefault)?.name||null,status:"queued",createdAt:new Date().toISOString()};
   jobs.set(id,job);
   // Send plain text to the Windows spooler using Out-Printer; never interpolate user text into PowerShell code.
   try{
    const ps="$input | Out-Printer"+(target?" -Name "+("'"+target.replace(/'/g,"''")+"'"):"");
    await new Promise((resolve,reject)=>{const child=spawn("powershell.exe",["-NoProfile","-NonInteractive","-Command",ps],{windowsHide:true,stdio:["pipe","ignore","pipe"]});let err="";const timer=setTimeout(()=>{child.kill();reject(new Error("Printer submission timed out"));},15000);child.stderr.on("data",chunk=>{err+=chunk.toString();});child.on("error",e=>{clearTimeout(timer);reject(e);});child.on("close",code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(err||"PowerShell printer submission failed"));});child.stdin.end(b.text,"utf8");});
    job.status="accepted_by_windows_spooler";job.finishedAt=new Date().toISOString();json(res,202,{job}); 
   }catch(e){job.status="failed";job.error=String(e?.message||e);json(res,502,{job,error:"Windows could not submit this text job to the printer."});}
   return;
  }
  json(res,404,{error:"Endpoint not found"});
 }catch(e){json(res,500,{error:String(e?.message||e)});}
});
server.on("error",e=>{console.error("Print/network agent failed:",e.message);process.exitCode=1;});
server.listen(PORT,HOST,()=>console.log("SifoBooks Hotel Print & Network Agent listening on http://"+HOST+":"+PORT));
