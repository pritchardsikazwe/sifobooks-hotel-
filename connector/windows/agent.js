import { setTimeout as delay } from "node:timers/promises";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(process.env.PROGRAMDATA || "C:\\ProgramData", "SifoBooksHotel", "connector.json");
let config;
try { config = JSON.parse(readFileSync(configPath, "utf8")); }
catch { console.error("Missing connector.json. Copy connector.example.json to ProgramData\\SifoBooksHotel\\connector.json and configure it securely."); process.exit(2); }
const endpoint = String(config.supabaseUrl || "").replace(/\/$/, "") + "/functions/v1/hotel-zra-control";
const token = String(config.connectorToken || "");
if (!endpoint.startsWith("https://") || token.length < 30) { console.error("Configuration invalid: HTTPS endpoint and one-time paired token are required."); process.exit(2); }
const interval = Math.max(15, Number(config.pollSeconds || 30)) * 1000;
const vsdcHealthUrl = String(config.vsdcHealthUrl || "http://127.0.0.1:8085/");

async function call(action, extra = {}) {
  const response = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json","x-connector-token":token}, body:JSON.stringify({action,...extra}), signal:AbortSignal.timeout(12000) });
  const data = await response.json().catch(()=>({error:"Non-JSON response"}));
  if (!response.ok) throw new Error(data.error || "Connector API HTTP " + response.status);
  return data;
}
async function checkVsdc() {
  try {
    const response = await fetch(vsdcHealthUrl,{signal:AbortSignal.timeout(3000)});
    return { reachable:response.ok, status:response.status };
  } catch (error) { return { reachable:false, error:error instanceof Error?error.message:"VSDC unreachable" }; }
}
async function tick() {
  const vsdc = await checkVsdc();
  await call("connector_heartbeat", { error:vsdc.reachable?null:"Local VSDC health check failed: "+(vsdc.error||("HTTP "+vsdc.status)) });
  const queue = await call("connector_poll");
  if ((queue.items || []).length) {
    // Deliberate safety gate: the hotel-specific VSDC payload adapter must be implemented
    // and tested against ZRA's current API before any fiscal transaction is transmitted.
    for (const item of queue.items) {
      await call("connector_result", {
        submission_id:item.id, status:"retry_wait", response_code:"ADAPTER_NOT_CONFIGURED",
        response_message:"Connector heartbeat is active, but no approved hotel VSDC payload adapter is configured. No fiscal request was sent."
      });
    }
  }
  console.log(new Date().toISOString(), "heartbeat ok; VSDC", vsdc.reachable?"reachable":"unreachable", "queue", (queue.items||[]).length);
}
console.log("SifoBooks Hotel ZRA Connector starting. Fiscal transmission is fail-closed until the hotel adapter is approved.");
while (true) {
  try { await tick(); } catch (error) { console.error(new Date().toISOString(), error instanceof Error?error.message:String(error)); }
  await delay(interval);
}
