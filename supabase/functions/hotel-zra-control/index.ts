import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(["https://hotel.sifobooks.com","https://pritchardsikazwe.github.io","http://localhost:5173","http://127.0.0.1:5173"]);
const headersBase = { "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-connector-token", "Access-Control-Allow-Methods":"POST, OPTIONS", "Vary":"Origin" };
const json = (body: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), {status,headers:{...headersBase,...headers,"Content-Type":"application/json"}});
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,"0")).join("");
const randomToken = () => { const bytes = crypto.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=",""); };

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const headers = allowedOrigins.has(origin) ? {"Access-Control-Allow-Origin":origin} : {};
  if (req.method === "OPTIONS") return new Response("ok",{headers:{...headersBase,...headers}});
  if (req.method !== "POST") return json({error:"Method not allowed"},405,headers);
  if (origin && !allowedOrigins.has(origin)) return json({error:"Origin not allowed"},403,headers);
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) throw new Error("Server configuration missing.");
    const admin = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
    const body = await req.json();
    const action = String(body.action ?? "");
    // Connector machine authentication: token is stored only as a SHA-256 digest in the hotel's settings JSON.
    if (["connector_poll","connector_heartbeat","connector_result"].includes(action)) {
      const token = req.headers.get("x-connector-token") ?? String(body.connector_token ?? "");
      if (token.length < 30) return json({error:"Connector token required."},401,headers);
      const digest = await sha256(token);
      const {data:setting,error:findError} = await admin.from("hotel_zra_settings").select("*").eq("configuration->>connector_token_hash",digest).maybeSingle();
      if (findError || !setting || !setting.enabled) return json({error:"Connector is not paired or integration is disabled."},401,headers);
      if (action === "connector_heartbeat") {
        const {error} = await admin.from("hotel_zra_settings").update({connector_status:body.error?"error":"online",last_heartbeat_at:new Date().toISOString(),last_error_message:body.error?String(body.error).slice(0,500):null}).eq("hotel_id",setting.hotel_id);
        if (error) throw error;
        return json({ok:true,hotel_id:setting.hotel_id,environment:setting.environment},200,headers);
      }
      if (action === "connector_poll") {
        const {data:items,error} = await admin.from("hotel_zra_submissions").select("id,source_type,source_id,idempotency_key,environment,status,request_summary,attempt_count").eq("hotel_id",setting.hotel_id).in("status",["queued","retry_wait"]).lte("next_attempt_at",new Date().toISOString()).order("created_at").limit(10);
        if (error) throw error;
        if (items?.length) {
          const ids=items.map(x=>x.id);
          const {error:updateError}=await admin.from("hotel_zra_submissions").update({status:"sending",attempt_count:1}).in("id",ids).eq("hotel_id",setting.hotel_id);
          if (updateError) throw updateError;
        }
        return json({ok:true,hotel_id:setting.hotel_id,environment:setting.environment,device_serial:setting.device_serial,items:items??[],note:"Queue metadata only. The adapter must validate mapped fiscal payloads before calling VSDC."},200,headers);
      }
      const submissionId=String(body.submission_id??"");
      const status=String(body.status??"");
      if (!submissionId || !["accepted","rejected","retry_wait"].includes(status)) throw new Error("Invalid connector result.");
      const {data:existing,error:subError}=await admin.from("hotel_zra_submissions").select("id,status,environment").eq("id",submissionId).eq("hotel_id",setting.hotel_id).maybeSingle();
      if (subError || !existing || existing.status!=="sending") throw new Error("Submission is not in a claimable sending state.");
      if (existing.environment!==setting.environment) throw new Error("Environment mismatch; submission stopped.");
      const updates={status,response_code:body.response_code?String(body.response_code).slice(0,100):null,response_message:body.response_message?String(body.response_message).slice(0,1000):null,zra_reference:body.zra_reference?String(body.zra_reference).slice(0,200):null,fiscal_signature:body.fiscal_signature?String(body.fiscal_signature).slice(0,500):null,receipt_qr_url:body.receipt_qr_url?String(body.receipt_qr_url).slice(0,1000):null,submitted_at:new Date().toISOString(),accepted_at:status==="accepted"?new Date().toISOString():null,updated_at:new Date().toISOString()};
      const {error:updateError}=await admin.from("hotel_zra_submissions").update(updates).eq("id",submissionId).eq("hotel_id",setting.hotel_id);
      if(updateError) throw updateError;
      await admin.from("hotel_zra_events").insert({hotel_id:setting.hotel_id,submission_id:submissionId,event_type:"connector_result",status,message:updates.response_message,details:{response_code:updates.response_code,zra_reference:updates.zra_reference}});
      return json({ok:true},200,headers);
    }
    const authHeader=req.headers.get("Authorization")??"";
    if(!authHeader.startsWith("Bearer ")) return json({error:"Sign in first."},401,headers);
    const userClient=createClient(url,anon,{global:{headers:{Authorization:authHeader}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:userData,error:userError}=await userClient.auth.getUser();
    if(userError||!userData.user) return json({error:"Session invalid. Sign in again."},401,headers);
    const user=userData.user;
    const hotelId=String(body.hotel_id??"");
    if(!hotelId) throw new Error("hotel_id is required.");
    const {data:membership,error:membershipError}=await admin.from("hotel_memberships").select("role,active").eq("hotel_id",hotelId).eq("user_id",user.id).maybeSingle();
    if(membershipError||!membership?.active) throw new Error("You do not have active access to this hotel.");
    const role=membership.role;
    if(action==="save_settings") {
      if(!["owner","manager","accountant"].includes(role)) throw new Error("Only owner, manager or accountant can change Smart Invoice settings.");
      const environment=String(body.environment??"test");
      if(!["test","production"].includes(environment)) throw new Error("Invalid environment.");
      if(environment==="production" && body.enabled!==true) throw new Error("Production must be explicitly enabled before selecting production.");
      const {data:prior}=await admin.from("hotel_zra_settings").select("configuration,connector_id,connector_status,last_heartbeat_at").eq("hotel_id",hotelId).maybeSingle();
      const {error}=await admin.from("hotel_zra_settings").upsert({hotel_id:hotelId,enabled:body.enabled===true,environment,tpin:String(body.tpin??"").trim()||null,branch_id:String(body.branch_id??"").trim()||null,device_serial:String(body.device_serial??"").trim()||null,connector_id:prior?.connector_id??null,connector_status:prior?.connector_status??"not_configured",last_heartbeat_at:prior?.last_heartbeat_at??null,configuration:prior?.configuration??{},updated_by:user.id},{onConflict:"hotel_id"});
      if(error) throw error;
      await admin.from("hotel_zra_events").insert({hotel_id:hotelId,event_type:"settings_updated",status:"saved",message:"Smart Invoice settings updated",actor_user_id:user.id,details:{environment,enabled:body.enabled===true}});
      return json({ok:true},200,headers);
    }
    if(action==="pair_connector") {
      if(!["owner","manager"].includes(role)) throw new Error("Only owner or manager can pair a connector.");
      const token=randomToken(); const digest=await sha256(token);
      const {data:prior}=await admin.from("hotel_zra_settings").select("configuration").eq("hotel_id",hotelId).maybeSingle();
      const configuration={...(prior?.configuration??{}),connector_token_hash:digest,connector_paired_at:new Date().toISOString()};
      const {error}=await admin.from("hotel_zra_settings").upsert({hotel_id:hotelId,enabled:true,environment:"test",configuration,connector_status:"offline",updated_by:user.id},{onConflict:"hotel_id"});
      if(error) throw error;
      await admin.from("hotel_zra_events").insert({hotel_id:hotelId,event_type:"connector_paired",status:"pending",message:"One-time connector token issued",actor_user_id:user.id});
      return json({ok:true,connector_token:token,message:"Token displayed once. Configure it on the trusted Windows connector."},200,headers);
    }
    if(action==="retry_submission") {
      if(!["owner","manager","accountant"].includes(role)) throw new Error("Not authorised to retry fiscal submissions.");
      const submissionId=String(body.submission_id??"");
      const {data:item,error}=await admin.from("hotel_zra_submissions").select("id,status,environment,idempotency_key").eq("id",submissionId).eq("hotel_id",hotelId).maybeSingle();
      if(error||!item) throw new Error("Submission not found for this hotel.");
      if(!["rejected","retry_wait"].includes(item.status)) throw new Error("Only rejected or retry_wait submissions can be retried.");
      const {error:updateError}=await admin.from("hotel_zra_submissions").update({status:"queued",next_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",submissionId).eq("hotel_id",hotelId);
      if(updateError) throw updateError;
      await admin.from("hotel_zra_events").insert({hotel_id:hotelId,submission_id:submissionId,event_type:"retry_requested",status:"queued",message:"Retry requested with original idempotency key",actor_user_id:user.id,details:{idempotency_key:item.idempotency_key}});
      return json({ok:true},200,headers);
    }
    return json({error:"Unsupported action."},400,headers);
  } catch(error) {
    return json({error:error instanceof Error?error.message:"Unexpected server error"},400,headers);
  }
});
