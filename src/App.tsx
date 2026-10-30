import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BedDouble, CalendarDays, CheckCircle2, ClipboardList, CreditCard, DoorOpen, FileBarChart, Hotel, LogOut, Moon, Plus, Printer, RefreshCw, UserCog, Users, Wallet, Wrench } from "lucide-react";
import { ZraPanel } from "./ZraPanel";
import { requireSupabase, supabase, supabaseReady } from "./lib/supabase";

type Row = Record<string, any>;
type Tab = "overview" | "rooms" | "guests" | "reservations" | "housekeeping" | "folios" | "maintenance" | "night_audit" | "reports" | "staff" | "settings" | "zra";
const tabs: { id: Tab; label: string; icon: typeof Hotel }[] = [
  { id: "overview", label: "Overview", icon: Hotel },
  { id: "rooms", label: "Rooms", icon: BedDouble },
  { id: "guests", label: "Guests", icon: Users },
  { id: "reservations", label: "Reservations", icon: CalendarDays },
  { id: "housekeeping", label: "Housekeeping", icon: ClipboardList },
  { id: "folios", label: "Folios & payments", icon: Wallet },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "night_audit", label: "Night audit", icon: Moon },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "staff", label: "Staff & access", icon: UserCog },
  { id: "settings", label: "Hotel settings", icon: DoorOpen },
  { id: "zra", label: "ZRA Smart Invoice", icon: Printer },
];
const dateInZambia = (value: string | Date) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lusaka", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)); const v = Object.fromEntries(p.map((x) => [x.type, x.value])); return `${v.year}-${v.month}-${v.day}`; };
const today = () => dateInZambia(new Date());
const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const money = (n: unknown) => new Intl.NumberFormat("en-ZM", { style: "currency", currency: "ZMW", maximumFractionDigits: 2 }).format(Number(n || 0));
const errorMessage = (e: unknown) => e instanceof Error ? e.message : String(e);

export function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [hotel, setHotel] = useState<Row | null>(null);
  const [membershipRole, setMembershipRole] = useState("owner");
  const [hotelName, setHotelName] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, Row[]>>({
    room_types: [], rooms: [], guests: [], reservations: [], folios: [], folio_items: [], payments: [],
    housekeeping_tasks: [], maintenance_requests: [], night_audits: [],
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<Row[]>([]);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).finally(() => setAuthLoading(false));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadStaff = useCallback(async () => {
    if (!hotel?.id) return;
    const { data: rows, error } = await requireSupabase().rpc("list_hotel_members", { p_hotel_id: hotel.id });
    if (error) { setStaff([]); if (tab === "staff") setError(error.message); return; }
    setStaff(Array.isArray(rows) ? rows : []);
  }, [hotel?.id, tab]);

  const loadHotel = useCallback(async () => {
    if (!session?.user?.id) { setHotel(null); return; }
    const client = requireSupabase();
    const { data: own, error: ownError } = await client.from("hotels").select("*").eq("owner_user_id", session.user.id).order("created_at").limit(1).maybeSingle();
    if (ownError) throw ownError;
    if (own) { setHotel(own); setMembershipRole("owner"); return; }
    const { data: membership, error: memberError } = await client.from("hotel_memberships").select("hotel_id,hotels(*)").eq("user_id", session.user.id).eq("active", true).limit(1).maybeSingle();
    if (memberError) throw memberError;
    setHotel((membership as any)?.hotels ?? null);
    setMembershipRole((membership as any)?.role ?? "viewer");
  }, [session?.user?.id]);

  const refresh = useCallback(async () => {
    if (!hotel?.id) return;
    setLoading(true);
    const client = requireSupabase();
    const tables = ["room_types", "rooms", "guests", "reservations", "folios", "folio_items", "payments", "housekeeping_tasks", "maintenance_requests", "night_audits"];
    try {
      const results = await Promise.all(tables.map((table) => client.from(table).select("*").eq("hotel_id", hotel.id).order("created_at", { ascending: false }).limit(1000)));
      const next: Record<string, Row[]> = {};
      results.forEach((r, i) => { if (r.error) throw r.error; next[tables[i]] = r.data ?? []; });
      setData((current) => ({ ...current, ...next }));
    } catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, [hotel?.id]);

  useEffect(() => { if (session) loadHotel().catch((e) => setError(errorMessage(e))); }, [session, loadHotel]);
  useEffect(() => { if (hotel?.id) refresh(); }, [hotel?.id, refresh]);
  useEffect(() => { if (hotel?.id) loadStaff(); }, [hotel?.id, loadStaff]);

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const client = requireSupabase();
      if (authMode === "signup") {
        const { data, error } = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: "https://hotel.sifobooks.com/" } });
        if (error) throw error;
        if (!data.session) setNotice("Account created. Check your email to confirm the account, then sign in.");
        else setNotice("Account created. Continue by setting up your hotel.");
      } else {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const resetPassword = async () => {
    setError(""); setNotice("");
    if (!email.trim()) { setError("Enter your email address first."); return; }
    setBusy(true);
    try {
      const { error } = await requireSupabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: "https://hotel.sifobooks.com/" });
      if (error) throw error;
      setNotice("If that account exists, a password-reset email has been sent.");
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const createHotel = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const client = requireSupabase();
      const user = (await client.auth.getUser()).data.user;
      if (!user) throw new Error("Please sign in again.");
      const { data: created, error: createError } = await client.rpc("create_hotel_for_current_user", { p_name: hotelName.trim() });
      if (createError) throw createError;
      setHotel(created as Row); setNotice("Hotel workspace created.");
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault(); if (!hotel) return;
    setError(""); setNotice(""); setSaving(true);
    const client = requireSupabase();
    const v = form;
    try {
      if (tab === "rooms" && v.kind === "room_type") {
        const { error } = await client.from("room_types").insert({ hotel_id: hotel.id, name: v.type_name, code: v.type_code.toUpperCase(), max_occupancy: Number(v.max_occupancy || 2), base_rate: Number(v.base_rate || 0), description: v.description || null });
        if (error) throw error;
        setNotice("Room type saved.");
      } else if (tab === "rooms" && v.kind === "room") {
        const { error } = await client.from("rooms").insert({ hotel_id: hotel.id, room_type_id: v.room_type_id, room_number: v.room_number.trim(), floor_label: v.floor_label || null });
        if (error) throw error;
        setNotice("Room saved.");
      } else if (tab === "guests") {
        const { error } = await client.from("guests").insert({ hotel_id: hotel.id, first_name: v.first_name.trim(), last_name: v.last_name.trim(), email: v.email || null, phone: v.phone || null, nationality: v.nationality || null, id_document_type: v.id_document_type || null, id_document_number: v.id_document_number || null, company_name: v.company_name || null, address: v.address || null, notes: v.notes || null });
        if (error) throw error;
        setNotice("Guest saved.");
      } else if (tab === "reservations") {
        const room = data.rooms.find((r) => r.id === v.room_id);
        if (!room) throw new Error("Choose a room.");
        const type = data.room_types.find((r) => r.id === room.room_type_id);
        const guest = data.guests.find((g) => g.id === v.guest_id);
        if (!guest) throw new Error("Choose a guest.");
        if (!v.check_in_date || !v.check_out_date || v.check_out_date <= v.check_in_date) throw new Error("Check-out must be after check-in.");
        if (Number(v.adults || 1) + Number(v.children || 0) > Number(type?.max_occupancy || 99)) throw new Error("Guest count exceeds this room type maximum occupancy.");
        const { data: created, error } = await client.rpc("create_hotel_reservation", {
          p_hotel_id: hotel.id, p_guest_id: guest.id, p_room_id: room.id,
          p_check_in: v.check_in_date, p_check_out: v.check_out_date,
          p_adults: Number(v.adults || 1), p_children: Number(v.children || 0),
          p_nightly_rate: v.nightly_rate === "" ? null : Number(v.nightly_rate),
        });
        if (error) throw error;
        setNotice("Reservation " + ((created as any)?.reservation?.reservation_number ?? "confirmed") + " confirmed and folio created.");
      } else if (tab === "housekeeping") {
        const { error } = await client.from("housekeeping_tasks").insert({ hotel_id: hotel.id, room_id: v.room_id, task_type: v.task_type || "cleaning", priority: v.priority || "normal", notes: v.notes || null });
        if (error) throw error;
        await client.from("rooms").update({ status: "dirty" }).eq("id", v.room_id).eq("hotel_id", hotel.id);
        setNotice("Housekeeping task created.");
      } else if (tab === "folios" && v.kind === "charge") {
        if (Number(v.quantity || 1) <= 0 || Number(v.unit_price || 0) < 0) throw new Error("Quantity must be positive and unit price cannot be negative.");
        const { error } = await client.from("folio_items").insert({ hotel_id: hotel.id, folio_id: v.folio_id, item_type: v.item_type || "other", description: v.description, quantity: Number(v.quantity || 1), unit_price: Number(v.unit_price || 0), amount: Number(v.quantity || 1) * Number(v.unit_price || 0), service_date: v.service_date || today(), posted_by: session.user.id });
        if (error) throw error;
        setNotice("Charge added to folio.");
      } else if (tab === "folios" && v.kind === "payment") {
        const folio = data.folios.find((f) => f.id === v.folio_id);
        if (!folio) throw new Error("Choose a folio.");
        const { error } = await client.rpc("record_hotel_payment", { p_hotel_id: hotel.id, p_folio_id: folio.id, p_method: v.method || "cash", p_amount: Number(v.amount || 0), p_reference: v.reference || null });
        if (error) throw error;
        setNotice("Payment receipt recorded.");
      } else if (tab === "maintenance") {
        const { error } = await client.from("maintenance_requests").insert({ hotel_id: hotel.id, room_id: v.room_id || null, title: v.title.trim(), description: v.description || null, priority: v.priority || "normal", blocks_room_sale: v.blocks_room_sale !== "false", reported_by: session.user.id });
        if (error) throw error;
        if (v.room_id && v.blocks_room_sale !== "false") await client.from("rooms").update({ status: "maintenance" }).eq("id", v.room_id).eq("hotel_id", hotel.id);
        setNotice("Maintenance request created.");
      } else if (tab === "night_audit") {
        const businessDate = v.business_date || today();
        const existingAudit = data.night_audits.find((a) => a.business_date === businessDate);
        if (existingAudit) throw new Error("A night audit already exists for this business date.");
        const chargesForDay = data.folio_items.filter((i) => i.service_date === businessDate);
        const roomRevenue = chargesForDay.filter((i) => i.item_type === "room_charge").reduce((s, i) => s + Number(i.amount || 0), 0);
        const otherRevenue = chargesForDay.filter((i) => i.item_type !== "room_charge" && i.item_type !== "discount").reduce((s, i) => s + Number(i.amount || 0), 0);
        const receiptsForDay = data.payments.filter((p) => p.status === "posted" && dateInZambia(p.received_at) === businessDate);
        const paymentsTotal = receiptsForDay.reduce((s, p) => s + Number(p.amount || 0), 0);
        const expectedCash = receiptsForDay.filter((p) => p.method === "cash").reduce((s, p) => s + Number(p.amount || 0), 0);
        const countedCash = Number(v.cash_counted || 0);
        const { error } = await client.from("night_audits").insert({
          hotel_id: hotel.id, business_date: businessDate, status: "closed", room_revenue: roomRevenue,
          other_revenue: otherRevenue, payments_total: paymentsTotal, variance: countedCash - expectedCash,
          checklist: { cash_expected: expectedCash, cash_counted: countedCash, cash_variance: countedCash - expectedCash, reconciled: true },
          notes: v.notes || null, opened_by: session.user.id, closed_by: session.user.id, closed_at: new Date().toISOString(),
        });
        if (error) throw error;
        setNotice(`Night audit closed for ${businessDate}. Cash variance: ${money(countedCash - expectedCash)}.`);
      } else if (tab === "staff") {
        const { data: inviteResult, error } = await client.functions.invoke("invite-hotel-staff", { body: { hotel_id: hotel.id, email: v.staff_email.trim(), role: v.staff_role } });
        if (error) throw error;
        if (inviteResult?.error) throw new Error(inviteResult.error);
        setNotice(inviteResult?.message ?? "Staff access updated.");
        await loadStaff();
      } else if (tab === "settings") {
        const { error } = await client.from("hotels").update({ name: (v.name ?? hotel.name).trim(), legal_name: v.legal_name ?? hotel.legal_name ?? null, email: v.email ?? hotel.email ?? null, phone: v.phone ?? hotel.phone ?? null, address: v.address ?? hotel.address ?? null, city: v.city ?? hotel.city ?? null, tax_registration_number: v.tax_registration_number ?? hotel.tax_registration_number ?? null, check_in_time: v.check_in_time ?? hotel.check_in_time ?? "14:00", check_out_time: v.check_out_time ?? hotel.check_out_time ?? "10:00", vat_enabled: (v.vat_enabled ?? String(hotel.vat_enabled)) === "true", vat_rate: Number(v.vat_rate ?? hotel.vat_rate ?? 0) }).eq("id", hotel.id);
        if (error) throw error;
        setHotel({ ...hotel, ...v });
        setNotice("Hotel settings saved.");
      }
      setForm({});
      await refresh();
      if (tab === "settings") await loadHotel();
    } catch (e) { setError(errorMessage(e)); }
    finally { setSaving(false); }
  };

  const updateReservation = async (reservation: Row, action: "checkin" | "checkout" | "cancel") => {
    if (!hotel) return;
    setError(""); setNotice("");
    try {
      const client = requireSupabase();
      const { error } = await client.rpc("transition_hotel_reservation", { p_reservation_id: reservation.id, p_action: action });
      if (error) throw error;
      setNotice("Reservation " + (action === "checkin" ? "checked in" : action === "checkout" ? "checked out" : "cancelled") + ".");
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
  };

  const toggleStaff = async (member: Row) => {
    if (!hotel || member.role === "owner") return;
    setError(""); setNotice("");
    const { error } = await requireSupabase().rpc("set_hotel_member_active", { p_hotel_id: hotel.id, p_membership_id: member.id, p_active: !member.active });
    if (error) setError(error.message); else { setNotice(member.active ? "Staff access suspended." : "Staff access restored."); await loadStaff(); }
  };

  const completeTask = async (task: Row) => {
    if (!hotel) return;
    try {
      const client = requireSupabase();
      const next = task.status === "pending" ? "in_progress" : "completed";
      const patch: Row = { status: next };
      if (next === "in_progress") patch.started_at = new Date().toISOString();
      else patch.completed_at = new Date().toISOString();
      const { error } = await client.from("housekeeping_tasks").update(patch).eq("id", task.id).eq("hotel_id", hotel.id);
      if (error) throw error;
      if (next === "completed") await client.from("rooms").update({ status: "inspected" }).eq("id", task.room_id).eq("hotel_id", hotel.id);
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
  };

  const totals = useMemo(() => {
    const rooms = data.rooms.filter((r) => r.active && !["maintenance", "out_of_service"].includes(r.status)).length;
    const occupied = data.rooms.filter((r) => r.status === "occupied").length;
    const arrivals = data.reservations.filter((r) => r.check_in_date === today() && ["pending", "confirmed"].includes(r.status)).length;
    const departures = data.reservations.filter((r) => r.check_out_date === today() && r.status === "checked_in").length;
    const revenue = data.folio_items.filter((i) => i.service_date === today() && i.item_type !== "discount").reduce((s, i) => s + Number(i.amount || 0), 0);
    const paid = data.payments.filter((p) => p.status === "posted" && dateInZambia(p.received_at) === today()).reduce((s, p) => s + Number(p.amount || 0), 0);
    const outstanding = data.folios.filter((f) => f.status === "open").reduce((sum, f) => {
      const charges = data.folio_items.filter((i) => i.folio_id === f.id).reduce((s, i) => s + (i.item_type === "discount" ? -Math.abs(Number(i.amount || 0)) : Number(i.amount || 0)), 0);
      const payments = data.payments.filter((p) => p.folio_id === f.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0) * (p.payment_type === "refund" ? -1 : 1), 0);
      return sum + charges - payments;
    }, 0);
    return { rooms, occupied, arrivals, departures, revenue, paid, outstanding };
  }, [data]);

  if (!supabaseReady) return <main className="auth-wrap"><section className="auth-card"><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks Hotel</strong><small>Independent hotel management</small></div></div><h1>Connect your hotel workspace</h1><p>Copy <code>.env.example</code> to <code>.env.local</code> and set the Supabase publishable/anon key. Do not put a service-role key in this app.</p></section></main>;
  if (authLoading) return <main className="auth-wrap"><section className="auth-card">Loading secure workspace…</section></main>;
  if (!session) return <main className="auth-wrap"><form className="auth-card" onSubmit={submitAuth}><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks Hotel</strong><small>Independent hotel management</small></div></div><h1>{authMode === "signin" ? "Welcome back" : "Create your hotel account"}</h1><p>Manage rooms, reservations, guests and guest folios in one workspace.</p>{error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}<label>Email address<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label><label>Password<input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={authMode === "signin" ? "current-password" : "new-password"} /></label><button className="primary wide" disabled={busy}>{busy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}</button><button type="button" className="link-button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}>{authMode === "signin" ? "New to SifoBooks Hotel? Create an account" : "Already registered? Sign in"}</button>{authMode === "signin" && <button type="button" className="link-button" onClick={resetPassword} disabled={busy}>Forgot password?</button>}</form></main>;
  if (!hotel) return <main className="auth-wrap"><form className="auth-card" onSubmit={createHotel}><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks Hotel</strong><small>First-time setup</small></div></div><h1>Set up your property</h1><p>This creates your own private hotel workspace, configured for Zambia.</p>{error && <div className="alert error">{error}</div>}<label>Hotel or lodge name<input required minLength={2} value={hotelName} onChange={(e) => setHotelName(e.target.value)} placeholder="e.g. Copperbelt Grand Hotel" /></label><button className="primary wide" disabled={busy}>{busy ? "Creating…" : "Create hotel workspace"}</button><button type="button" className="link-button" onClick={() => requireSupabase().auth.signOut()}>Sign out</button></form></main>;

  const roomName = (id: string) => data.rooms.find((r) => r.id === id)?.room_number ?? "Room";
  const guestName = (id: string) => { const g = data.guests.find((x) => x.id === id); return g ? `${g.first_name} ${g.last_name}` : "Guest"; };
  const exportCsv = (filename: string, headers: string[], rows: unknown[][]) => {
    const quote = (value: unknown) => '"' + String(value ?? "").replaceAll('"', '""') + '"';
    const csv = [headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
    const blob = new Blob(["\\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    URL.revokeObjectURL(url);
  };
  const changeRoomStatus = async (room: Row, status: string) => {
    if (!hotel) return;
    if (status === "available" && data.reservations.some((r) => r.room_id === room.id && r.status === "checked_in")) { setError("This room has an active checked-in reservation. Check the guest out first."); return; }
    if (status === "occupied" && !data.reservations.some((r) => r.room_id === room.id && r.status === "checked_in")) { setError("Use Check in on a reservation to mark a room occupied."); return; }
    setError(""); setNotice("");
    try {
      const { error } = await requireSupabase().from("rooms").update({ status }).eq("id", room.id).eq("hotel_id", hotel.id);
      if (error) throw error;
      setNotice(`Room ${room.room_number} updated to ${status.replaceAll("_", " ")}.`);
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
  };
  const printReceipt = (payment: Row) => {
    const folio = data.folios.find((f) => f.id === payment.folio_id);
    const reservation = data.reservations.find((r) => r.id === payment.reservation_id || r.id === folio?.reservation_id);
    const guest = reservation ? data.guests.find((g) => g.id === reservation.guest_id) : null;
    const popup = window.open("", "_blank", "width=720,height=820");
    if (!popup) { setError("Your browser blocked the receipt window. Allow pop-ups for this site and try again."); return; }
    const html = "<!doctype html><html><head><title>Receipt " + escapeHtml(payment.payment_number) + "</title><meta charset='utf-8'><style>body{font:15px Arial,sans-serif;color:#18231f;padding:36px;max-width:680px;margin:auto}h1{margin:0 0 4px;color:#075c45}small{color:#64736c}.line{display:flex;justify-content:space-between;border-bottom:1px solid #ddd;padding:12px 0}.total{font-size:22px;font-weight:bold;margin-top:20px}.stamp{margin-top:36px;border-top:1px dashed #aaa;padding-top:16px;color:#667}</style></head><body><h1>" + escapeHtml(hotel.name) + "</h1><small>PAYMENT RECEIPT · " + escapeHtml(hotel.city || "Zambia") + "</small><h2>Receipt " + escapeHtml(payment.payment_number) + "</h2><div class='line'><span>Received from</span><strong>" + escapeHtml(guest ? guest.first_name + " " + guest.last_name : "Guest") + "</strong></div><div class='line'><span>Reservation</span><strong>" + escapeHtml(reservation?.reservation_number || "—") + "</strong></div><div class='line'><span>Folio</span><strong>" + escapeHtml(folio?.folio_number || "—") + "</strong></div><div class='line'><span>Date</span><strong>" + escapeHtml(new Date(payment.received_at || payment.created_at).toLocaleString("en-ZM", { timeZone: "Africa/Lusaka" })) + "</strong></div><div class='line'><span>Method</span><strong>" + escapeHtml(payment.method) + "</strong></div><div class='line'><span>Reference</span><strong>" + escapeHtml(payment.reference || "—") + "</strong></div><div class='total'>Amount received: " + escapeHtml(money(payment.amount)) + "</div><div class='stamp'>Thank you for staying with us.<br>Generated by SifoBooks Hotel.</div><script>window.onload=()=>window.print()</script></body></html>";
    popup.document.open(); popup.document.write(html); popup.document.close();
  };

  const folioBalance = (folio: Row) => data.folio_items.filter((i) => i.folio_id === folio.id).reduce((s, i) => s + (i.item_type === "discount" ? -Math.abs(Number(i.amount || 0)) : Number(i.amount || 0)), 0) - data.payments.filter((p) => p.folio_id === folio.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0) * (p.payment_type === "refund" ? -1 : 1), 0);
  const field = (name: string, label: string, type = "text", required = true, extra: Record<string, any> = {}) => <label key={name}>{label}<input type={type} required={required} value={form[name] ?? extra.defaultValue ?? ""} onChange={(e) => setForm((s) => ({ ...s, [name]: e.target.value }))} {...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "defaultValue"))} /></label>;
  const select = (name: string, label: string, options: { value: string; label: string }[], required = true) => <label key={name}>{label}<select required={required} value={form[name] ?? ""} onChange={(e) => setForm((s) => ({ ...s, [name]: e.target.value }))}><option value="">Select…</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>;
  const submitButton = (label: string) => <button className="primary" disabled={saving}><Plus size={16} />{saving ? "Saving…" : label}</button>;
  const submitForm = (children: ReactNode) => <form className="form-grid" onSubmit={save}>{children}</form>;
  const table = (headers: string[], rows: (string | ReactNode)[][]) => <div className="table-scroll"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length ? rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length} className="empty">No records yet. Add your first record above.</td></tr>}</tbody></table></div>;
  const badge = (status: string) => <span className={`badge ${status}`}>{status?.replaceAll("_", " ")}</span>;
  const reservationActions = (r: Row) => <div className="actions">{r.status === "confirmed" && <button className="small" onClick={() => updateReservation(r, "checkin")}>Check in</button>}{r.status === "checked_in" && <button className="small" onClick={() => updateReservation(r, "checkout")}>Check out</button>}{["pending", "confirmed"].includes(r.status) && <button className="small danger" onClick={() => updateReservation(r, "cancel")}>Cancel</button>}</div>;

  let content: ReactNode;
  switch (tab) {
    case "overview":
      content = <><section className="dashboard-hero"><div className="hero-kicker">PROPERTY OPERATIONS · LIVE OVERVIEW</div><h2>Good day, {hotel.name}</h2><p>Your front desk at a glance. Review room availability, arrivals, departures and today’s collections from one workspace.</p><div className="hero-stats"><div className="hero-stat">Occupancy <strong>{totals.rooms ? Math.round(totals.occupied / totals.rooms * 100) : 0}%</strong></div><div className="hero-stat">Arrivals <strong>{totals.arrivals}</strong></div><div className="hero-stat">Departures <strong>{totals.departures}</strong></div><div className="hero-stat">Business date <strong>{today()}</strong></div></div></section><div className="metrics"><Metric title="Sellable rooms" value={totals.rooms} icon={<BedDouble />} /><Metric title="Occupied" value={totals.occupied} icon={<DoorOpen />} /><Metric title="Arrivals today" value={totals.arrivals} icon={<CalendarDays />} /><Metric title="Departures today" value={totals.departures} icon={<LogOut />} /><Metric title="Revenue charged today" value={money(totals.revenue)} icon={<Wallet />} /><Metric title="Received today" value={money(totals.paid)} icon={<CreditCard />} /><Metric title="Open folio balance" value={money(totals.outstanding)} icon={<Users />} /></div><div className="panel"><div className="panel-head"><div><h2>Today's arrivals</h2><p>Confirmed reservations due to check in today.</p></div><button className="small" onClick={() => setTab("reservations")}>Open reservations</button></div>{table(["Reservation", "Guest", "Room", "Dates", "Status"], data.reservations.filter((r) => r.check_in_date === today()).map((r) => [r.reservation_number, guestName(r.guest_id), roomName(r.room_id), `${r.check_in_date} → ${r.check_out_date}`, badge(r.status)]))}</div></>;
      break;
    case "rooms":
      content = <><div className="panel"><h2>Add room type</h2>{submitForm(<><input type="hidden" value="room_type" onChange={() => {}} />{select("kind", "Record type", [{value:"room_type",label:"Room type"}])}{field("type_name", "Type name")}{field("type_code", "Code")}{field("max_occupancy", "Max occupancy", "number", true, {min:1, defaultValue:"2"})}{field("base_rate", "Nightly rate (ZMW)", "number", true, {min:0,step:"0.01"})}{field("description", "Description", "text", false)}{submitButton("Save room type")}</>)}</div><div className="panel"><h2>Add room</h2>{data.room_types.length === 0 ? <p className="muted">Create a room type first.</p> : submitForm(<>{select("kind", "Record type", [{value:"room",label:"Room"}])}{field("room_number", "Room number")}{select("room_type_id", "Room type", data.room_types.map((r) => ({value:r.id,label:`${r.name} · ${money(r.base_rate)}`})))}{field("floor_label", "Floor / wing", "text", false)}{submitButton("Save room")}</>)}</div><div className="panel"><h2>Room inventory</h2>{table(["Room", "Type", "Rate / night", "Status", "Quick update"], data.rooms.map((r) => [r.room_number, data.room_types.find((t) => t.id === r.room_type_id)?.name ?? "—", money(data.room_types.find((t) => t.id === r.room_type_id)?.base_rate), badge(r.status), <select aria-label={`Update room ${r.room_number} status`} className="inline-select" value={r.status} onChange={(e) => changeRoomStatus(r, e.target.value)}><option value="available">Available</option><option value="occupied">Occupied</option><option value="dirty">Dirty</option><option value="cleaning">Cleaning</option><option value="maintenance">Maintenance</option><option value="out_of_service">Out of service</option></select>]))}</div></>;
      break;
    case "guests":
      content = <><div className="panel"><h2>Add guest</h2>{submitForm(<>{field("first_name", "First name")}{field("last_name", "Last name")}{field("email", "Email", "email", false)}{field("phone", "Phone", "tel", false)}{field("nationality", "Nationality", "text", false)}{field("id_document_type", "ID document type", "text", false)}{field("id_document_number", "ID / passport number", "text", false)}{field("company_name", "Company / organisation", "text", false)}{field("address", "Address", "text", false)}{field("notes", "Guest notes / preferences", "text", false)}{submitButton("Save guest")}</>)}</div><div className="panel"><div className="panel-head"><div><h2>Guest directory</h2><p>Export your guest register or contact a guest directly.</p></div><button className="secondary" onClick={() => exportCsv("sifobooks-guests.csv", ["First name","Last name","Email","Phone","Nationality"], data.guests.map((g) => [g.first_name,g.last_name,g.email,g.phone,g.nationality]))}>Export CSV</button></div>{table(["Guest", "Email", "Phone", "Nationality", "Contact"], data.guests.map((g) => [`${g.first_name} ${g.last_name}`, g.email ?? "—", g.phone ?? "—", g.nationality ?? "—", <div className="actions">{g.email && <a className="small" href={`mailto:${encodeURIComponent(g.email)}?subject=${encodeURIComponent("Message from "+hotel.name)}`}>Email</a>}{g.phone && <a className="small" target="_blank" rel="noreferrer" href={`https://wa.me/${String(g.phone).replace(/[^0-9]/g,"")}`}>WhatsApp</a>}</div>]))}</div></>;
      break;
    case "reservations":
      content = <><div className="panel"><h2>Create reservation</h2>{data.guests.length === 0 || data.rooms.length === 0 ? <p className="muted">Add at least one guest and one room before creating a reservation.</p> : submitForm(<>{select("guest_id", "Guest", data.guests.map((g) => ({value:g.id,label:`${g.first_name} ${g.last_name}`})))}{select("room_id", "Room", data.rooms.filter((r) => r.active && !["maintenance","out_of_service"].includes(r.status)).map((r) => ({value:r.id,label:`${r.room_number} · ${data.room_types.find((t) => t.id === r.room_type_id)?.name ?? "Room"}`})))}{field("check_in_date", "Check-in", "date", true, {min:today(),defaultValue:today()})}{field("check_out_date", "Check-out", "date", true, {min:today()})}{field("adults", "Adults", "number", true, {min:1,defaultValue:"1"})}{field("children", "Children", "number", true, {min:0,defaultValue:"0"})}{field("nightly_rate", "Nightly rate (ZMW, blank uses room rate)", "number", false, {min:0,step:"0.01"})}{submitButton("Confirm reservation")}</>)}</div><div className="panel"><div className="panel-head"><div><h2>Reservation book</h2><p>Bookings, arrivals, departures and stay status.</p></div><button className="secondary" onClick={() => exportCsv("sifobooks-reservations.csv", ["Reference","Guest","Room","Check-in","Check-out","Status"], data.reservations.map((r) => [r.reservation_number,guestName(r.guest_id),roomName(r.room_id),r.check_in_date,r.check_out_date,r.status]))}>Export CSV</button></div>{table(["Reference", "Guest", "Room", "Check-in", "Check-out", "Status", "Actions"], data.reservations.map((r) => [r.reservation_number, guestName(r.guest_id), roomName(r.room_id), r.check_in_date, r.check_out_date, badge(r.status), reservationActions(r)]))}</div></>;
      break;
    case "housekeeping":
      content = <><div className="panel"><h2>Create housekeeping task</h2>{data.rooms.length === 0 ? <p className="muted">Add rooms first.</p> : submitForm(<>{select("room_id", "Room", data.rooms.map((r) => ({value:r.id,label:r.room_number})))}{select("task_type", "Task", [{value:"cleaning",label:"Cleaning"},{value:"inspection",label:"Inspection"},{value:"linen",label:"Linen"},{value:"deep_clean",label:"Deep clean"}])}{select("priority", "Priority", [{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"},{value:"urgent",label:"Urgent"}])}{field("notes", "Notes", "text", false)}{submitButton("Create task")}</>)}</div><div className="panel"><h2>Housekeeping queue</h2>{table(["Room", "Task", "Priority", "Status", "Action"], data.housekeeping_tasks.map((t) => [roomName(t.room_id), t.task_type, badge(t.priority), badge(t.status), ["completed","verified","cancelled"].includes(t.status) ? "—" : <button className="small" onClick={() => completeTask(t)}>{t.status === "pending" ? "Start task" : "Complete task"}</button>]))}</div></>;
      break;
    case "folios":
      content = <><div className="panel"><h2>Add folio charge</h2>{data.folios.length === 0 ? <p className="muted">A folio is created automatically when you confirm a reservation.</p> : submitForm(<>{select("kind", "Action", [{value:"charge",label:"Add charge"}])}{select("folio_id", "Folio", data.folios.filter((f) => f.status === "open").map((f) => ({value:f.id,label:`${f.folio_number} · ${guestName(data.reservations.find((r) => r.id === f.reservation_id)?.guest_id ?? "")}`})))}{select("item_type", "Charge type", [{value:"room_charge",label:"Room charge"},{value:"food_beverage",label:"Food & beverage"},{value:"service",label:"Service"},{value:"tax",label:"Tax"},{value:"discount",label:"Discount"},{value:"other",label:"Other"}])}{field("description", "Description")}{field("quantity", "Quantity", "number", true, {min:0.001,step:"0.001",defaultValue:"1"})}{field("unit_price", "Unit price (ZMW)", "number", true, {step:"0.01"})}{field("service_date", "Service date", "date", true, {defaultValue:today()})}{submitButton("Add charge")}</>)}</div><div className="panel"><h2>Record payment</h2>{data.folios.length === 0 ? <p className="muted">Create a reservation first.</p> : submitForm(<>{select("kind", "Action", [{value:"payment",label:"Record payment"}])}{select("folio_id", "Folio", data.folios.filter((f) => f.status === "open").map((f) => ({value:f.id,label:f.folio_number})))}{select("method", "Method", [{value:"cash",label:"Cash"},{value:"card",label:"Card"},{value:"bank_transfer",label:"Bank transfer"},{value:"mobile_money",label:"Mobile money"},{value:"voucher",label:"Voucher"},{value:"other",label:"Other"}])}{field("amount", "Amount (ZMW)", "number", true, {min:0.01,step:"0.01"})}{field("reference", "Reference", "text", false)}{submitButton("Record receipt")}</>)}</div><div className="panel"><h2>Guest folios</h2>{table(["Folio", "Guest", "Reservation", "Charges", "Payments", "Balance", "Status"], data.folios.map((f) => [f.folio_number, guestName(data.reservations.find((r) => r.id === f.reservation_id)?.guest_id ?? ""), data.reservations.find((r) => r.id === f.reservation_id)?.reservation_number ?? "—", money(data.folio_items.filter((i) => i.folio_id === f.id).reduce((s, i) => s + Number(i.amount || 0), 0)), money(data.payments.filter((p) => p.folio_id === f.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0), 0)), money(folioBalance(f)), badge(f.status)]))}</div><div className="panel"><h2>Receipt history</h2>{table(["Receipt", "Date", "Guest", "Method", "Amount", "Reference", "Print"], data.payments.filter((p) => p.status === "posted").map((p) => [p.payment_number, new Date(p.received_at).toLocaleDateString("en-ZM", { timeZone: "Africa/Lusaka" }), guestName(data.reservations.find((r) => r.id === (p.reservation_id || data.folios.find((f) => f.id === p.folio_id)?.reservation_id))?.guest_id ?? ""), p.method, money(p.amount), p.reference ?? "—", <button className="small" onClick={() => printReceipt(p)}>Print receipt</button>]))}</div></>;
      break;
    case "maintenance":
      content = <><div className="panel"><h2>Report maintenance issue</h2>{submitForm(<>{field("title", "Issue title")}{select("room_id", "Room (optional)", data.rooms.map((r) => ({value:r.id,label:r.room_number})), false)}{select("priority", "Priority", [{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"},{value:"urgent",label:"Urgent"}])}{select("blocks_room_sale", "Block room sales?", [{value:"true",label:"Yes — mark room unavailable"},{value:"false",label:"No"}])}{field("description", "Details", "text", false)}{submitButton("Create maintenance ticket")}</>)}</div><div className="panel"><h2>Maintenance log</h2>{table(["Issue", "Room", "Priority", "Status", "Reported"], data.maintenance_requests.map((m) => [m.title, roomName(m.room_id), badge(m.priority), badge(m.status), new Date(m.created_at).toLocaleDateString()]))}</div></>;
      break;
    case "night_audit": {
      const auditedToday = data.night_audits.find((a) => a.business_date === today());
      content = <><div className="panel"><h2>Night audit · Daily close</h2><p className="muted">Reconcile today's room charges, other charges, receipts and physical cash before closing the business date. This does not post to an external accounting ledger.</p>{auditedToday ? <div className="alert success"><CheckCircle2 size={18} />Audit closed for {auditedToday.business_date}. Cash variance: {money(auditedToday.variance)}.</div> : submitForm(<>{field("business_date", "Business date", "date", true, {defaultValue:today(),max:today()})}{field("cash_counted", "Physical cash counted (ZMW)", "number", true, {min:0,step:"0.01",defaultValue:"0"})}{field("notes", "Closing notes", "text", false)}{submitButton("Reconcile and close day")}</>)}</div><div className="panel"><h2>Previous night audits</h2>{table(["Business date", "Room revenue", "Other revenue", "Payments", "Cash variance", "Status"], data.night_audits.map((a) => [a.business_date, money(a.room_revenue), money(a.other_revenue), money(a.payments_total), money(a.variance), badge(a.status)]))}</div></>;
      break;
    }
    case "reports": {
      const bookedNights = data.reservations.filter((r) => !["cancelled", "no_show"].includes(r.status)).reduce((n, r) => n + Math.max(0, (new Date(r.check_out_date).getTime() - new Date(r.check_in_date).getTime()) / 86400000), 0);
      const charged = data.folio_items.filter((i) => i.item_type !== "discount").reduce((n, i) => n + Number(i.amount || 0), 0);
      const discounts = data.folio_items.filter((i) => i.item_type === "discount").reduce((n, i) => n + Number(i.amount || 0), 0);
      const receipts = data.payments.filter((p) => p.status === "posted" && p.payment_type !== "refund").reduce((n, p) => n + Number(p.amount || 0), 0);
      const refunds = data.payments.filter((p) => p.status === "posted" && p.payment_type === "refund").reduce((n, p) => n + Number(p.amount || 0), 0);
      const occupied = data.rooms.filter((r) => r.status === "occupied").length;
      const activeRooms = data.rooms.filter((r) => r.active && !["maintenance", "out_of_service"].includes(r.status)).length;
      const kinds = Array.from(new Set(data.folio_items.map((i) => i.item_type))).sort();
      content = <><div className="metrics"><Metric title="Reservations" value={data.reservations.length} icon={<CalendarDays />} /><Metric title="Room nights booked" value={bookedNights} icon={<BedDouble />} /><Metric title="Gross charges" value={money(charged)} icon={<Wallet />} /><Metric title="Discounts" value={money(discounts)} icon={<CreditCard />} /><Metric title="Receipts" value={money(receipts)} icon={<CreditCard />} /><Metric title="Refunds" value={money(refunds)} icon={<Wallet />} /><Metric title="Current occupancy" value={activeRooms ? Math.round(occupied / activeRooms * 100) + "%" : "0%"} icon={<DoorOpen />} /></div><div className="panel"><div className="panel-head"><div><h2>Revenue by charge type</h2><p>Export the current property reporting dataset.</p></div><button className="secondary" onClick={() => exportCsv("sifobooks-revenue-by-charge.csv", ["Charge type","Transactions","Total ZMW"], kinds.map((kind) => { const items = data.folio_items.filter((i) => i.item_type === kind); return [kind.replaceAll("_", " "), items.length, items.reduce((sum, i) => sum + Number(i.amount || 0), 0).toFixed(2)]; }))}>Export revenue CSV</button></div>{table(["Charge type", "Transactions", "Total"], kinds.map((kind) => { const items = data.folio_items.filter((i) => i.item_type === kind); return [kind.replaceAll("_", " "), String(items.length), money(items.reduce((sum, i) => sum + Number(i.amount || 0), 0))]; }))}</div><div className="panel"><h2>Daily audit history</h2>{table(["Business date", "Room revenue", "Other revenue", "Payments", "Cash variance", "Status"], data.night_audits.map((a) => [a.business_date, money(a.room_revenue), money(a.other_revenue), money(a.payments_total), money(a.variance), badge(a.status)]))}</div></>;
      break;
    }
    case "staff":
      content = <><div className="panel"><h2>Add staff member</h2><p className="muted">Invite a new staff member by email or add an existing confirmed account. Access is limited to this hotel.</p>{submitForm(<>{field("staff_email", "Staff account email", "email")}{select("staff_role", "Role", [{value:"manager",label:"Manager"},{value:"receptionist",label:"Receptionist"},{value:"housekeeping",label:"Housekeeping"},{value:"accountant",label:"Accountant"},{value:"maintenance",label:"Maintenance"},{value:"viewer",label:"Read-only viewer"}])}{submitButton("Grant hotel access")}</>)}</div><div className="panel"><h2>Staff access</h2>{table(["Email", "Role", "Access", "Action"], staff.map((m) => [m.email ?? m.user_id, m.role, badge(m.active ? "active" : "suspended"), m.role === "owner" ? "Property owner" : <button className={m.active ? "small danger" : "small"} onClick={() => toggleStaff(m)}>{m.active ? "Suspend access" : "Restore access"}</button>]))}</div></>;
      break;
    case "settings":
      content = <div className="panel"><h2>Property settings</h2><p className="muted">Zambia defaults: ZMW, Africa/Lusaka, with VAT disabled until configured by the hotel.</p>{submitForm(<>{field("name", "Hotel name", "text", true, {defaultValue:hotel.name})}{field("legal_name", "Registered legal name", "text", false, {defaultValue:hotel.legal_name ?? ""})}{field("email", "Business email", "email", false, {defaultValue:hotel.email ?? ""})}{field("phone", "Phone", "tel", false, {defaultValue:hotel.phone ?? ""})}{field("address", "Address", "text", false, {defaultValue:hotel.address ?? ""})}{field("city", "City", "text", false, {defaultValue:hotel.city ?? ""})}{field("tax_registration_number", "Tax registration number", "text", false, {defaultValue:hotel.tax_registration_number ?? ""})}{field("check_in_time", "Standard check-in time", "time", true, {defaultValue:hotel.check_in_time ?? "14:00"})}{field("check_out_time", "Standard check-out time", "time", true, {defaultValue:hotel.check_out_time ?? "10:00"})}{select("vat_enabled", "VAT enabled?", [{value:"false",label:"No"},{value:"true",label:"Yes"}], true)}{field("vat_rate", "VAT rate (%)", "number", true, {min:0,max:100,step:"0.01",defaultValue:String(hotel.vat_rate ?? 0)})}{submitButton("Save settings")}</>)}</div>;
      break;
  }

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks</strong><small>Hotel Management</small></div></div><div className="property-label">PROPERTY</div><div className="property-name">{hotel.name}</div><nav>{tabs.filter((item) => { const allowed: Record<string, string[]> = { owner: tabs.map((t) => t.id), manager: tabs.filter((t) => t.id !== "staff").map((t) => t.id), receptionist: ["overview","rooms","guests","reservations","folios"], housekeeping: ["overview","rooms","housekeeping"], accountant: ["overview","guests","reservations","folios","night_audit","reports"], maintenance: ["overview","rooms","maintenance"], viewer: ["overview","reports"] }; return (allowed[membershipRole] ?? allowed.viewer).includes(item.id); }).map((item) => <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => { setTab(item.id); setForm({}); setError(""); setNotice(""); }}><item.icon size={18} />{item.label}</button>)}</nav><div className="sidebar-bottom"><span>{session.user.email}</span><button className="nav-item" onClick={() => requireSupabase().auth.signOut()}><LogOut size={18} />Sign out</button></div></aside><main className="main"><header className="topbar"><div><span className="eyebrow">SIFOBOOKS HOTEL PMS</span><h1>{tabs.find((t) => t.id === tab)?.label}</h1><p>{hotel.city ? `${hotel.city}, ${hotel.country}` : hotel.country} · {hotel.currency_code} · {new Date().toLocaleDateString()}</p></div><button className="secondary" onClick={() => refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />Refresh</button></header>{error && <div className="alert error">{error}<button onClick={() => setError("")}>×</button></div>}{notice && <div className="alert success">{notice}<button onClick={() => setNotice("")}>×</button></div>}{loading && <div className="loading-line">Syncing hotel records…</div>}{tab !== "overview" && <section className="page-intro"><div className="page-intro-mark">{(() => { const PageIcon = tabs.find((item) => item.id === tab)?.icon ?? Hotel; return <PageIcon size={23} />; })()}</div><div className="page-intro-copy"><div className="hero-kicker">PROPERTY WORKSPACE <span className="intro-dot">·</span> {today()}</div><h2>{tabs.find((item) => item.id === tab)?.label}</h2><p>{({rooms:"Manage room inventory, room types, rates and availability.",guests:"Keep guest contact details organised for a smooth arrival.",reservations:"Create bookings, manage the reservation book and process guest arrivals and departures.",housekeeping:"Coordinate room cleaning, inspections and task priorities.",folios:"Manage guest charges, balances, payments and printable receipts.",maintenance:"Track maintenance issues and protect rooms that cannot be sold.",night_audit:"Reconcile daily charges, receipts and cash before closing the business date.",reports:"Review property performance, revenue, room nights and daily audit history.",staff:"Control staff access and assign permissions by hotel role.",settings:"Manage property details, operating times and Zambia VAT configuration.",zra:"Configure hotel-specific ZRA Smart Invoice settings, connector pairing and submission history."} as Record<string,string>)[tab]}</p></div><span className="intro-status"><span></span> HOTEL OPERATIONS</span></section>}{content}<footer>Private hotel workspace · Row-level security enabled · {hotel.timezone}</footer></main></div>;
}

function Metric({ title, value, icon }: { title: string; value: ReactNode; icon: ReactNode }) {
  return <div className="metric"><span className="metric-icon">{icon}</span><span className="metric-label">{title}</span><strong>{value}</strong></div>;
}
