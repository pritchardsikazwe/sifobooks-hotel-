import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const allowedOrigins = new Set(["https://hotel.sifobooks.com", "http://localhost:5173", "http://127.0.0.1:5173"]);

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin") ?? "";
  const headers = { ...corsHeaders, ...(allowedOrigins.has(origin) ? { "Access-Control-Allow-Origin": origin } : {}) };
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...headers, "Content-Type": "application/json" } });
  if (origin && !allowedOrigins.has(origin)) return new Response(JSON.stringify({ error: "Origin not allowed" }), { status: 403, headers: { ...headers, "Content-Type": "application/json" } });
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anonKey || !serviceKey) throw new Error("Server auth configuration is missing.");
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) throw new Error("Sign in before inviting staff.");
    const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    const user = authData.user;
    if (authError || !user) throw new Error("Your session is invalid. Sign in again.");
    const body = await req.json();
    const hotelId = String(body.hotel_id ?? "");
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "");
    const roles = new Set(["manager", "receptionist", "housekeeping", "accountant", "maintenance", "viewer"]);
    if (!hotelId || !email || !email.includes("@") || !roles.has(role)) throw new Error("Provide a valid hotel, email and staff role.");
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: membership, error: memberError } = await admin.from("hotel_memberships").select("role,active").eq("hotel_id", hotelId).eq("user_id", user.id).maybeSingle();
    if (memberError || !membership || !membership.active || membership.role !== "owner") throw new Error("Only the active hotel owner can invite staff.");
    const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: "https://hotel.sifobooks.com" });
    if (inviteError) {
      const { data: existing, error: existingError } = await userClient.rpc("add_hotel_member_by_email", { p_hotel_id: hotelId, p_email: email, p_role: role });
      if (!existingError) return new Response(JSON.stringify({ ok: true, mode: "existing", membership: existing, message: "Existing user added to this hotel." }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
      throw new Error(existingError.message || inviteError.message);
    }
    const invitedUser = inviteData.user;
    if (!invitedUser) throw new Error("Invitation was sent but no user record was returned. Check Supabase Auth users before retrying.");
    const { error: upsertError } = await admin.from("hotel_memberships").upsert({ hotel_id: hotelId, user_id: invitedUser.id, role, active: true }, { onConflict: "hotel_id,user_id" });
    if (upsertError) throw new Error("Invitation was sent, but hotel access could not be saved. Retry staff access setup: " + upsertError.message);
    return new Response(JSON.stringify({ ok: true, mode: "invited", email, role, message: "Invitation sent. Access is limited to this hotel." }), { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), { status: 400, headers: { ...headers, "Content-Type": "application/json" } });
  }
});
