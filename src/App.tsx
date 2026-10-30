import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BedDouble, CalendarDays, CheckCircle2, ClipboardList, CreditCard, DoorOpen, FileBarChart, BookOpen, Hotel, LogOut, Moon, Plus, Printer, RefreshCw, UserCog, Users, Wallet, Wrench, Utensils, Wifi } from "lucide-react";
import { ZraPanel } from "./ZraPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { PosWorkspace } from "./PosWorkspace";
import { PrintingNetworkPanel } from "./PrintingNetworkPanel";
import { AccountingPanel } from "./AccountingPanel";
import { requireSupabase, supabase, supabaseReady } from "./lib/supabase";

type Row = Record<string, any>;
type Tab = "overview" | "rooms" | "guests" | "reservations" | "housekeeping" | "folios" | "maintenance" | "night_audit" | "reports" | "accounting" | "staff" | "settings" | "zra" | "documents" | "pos" | "printing_network";
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
  { id: "accounting", label: "Accounting & posting", icon: BookOpen },
  { id: "staff", label: "Staff & access", icon: UserCog },
  { id: "settings", label: "Hotel settings", icon: DoorOpen },
  { id: "printing_network", label: "Printing & network", icon: Wifi },
  { id: "zra", label: "ZRA Smart Invoice", icon: Printer },
  { id: "documents", label: "Document designs", icon: FileBarChart },
  { id: "pos", label: "POS · Bar & Restaurant", icon: Utensils },
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
    housekeeping_tasks: [], maintenance_requests: [], night_audits: [], hotel_maintenance_work_logs: [], hotel_locations: [],
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<Row[]>([]);
  const [tableSearch, setTableSearch] = useState("");
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);

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
    const tables = ["room_types", "rooms", "guests", "reservations", "folios", "folio_items", "payments", "housekeeping_tasks", "maintenance_requests", "night_audits", "hotel_maintenance_work_logs", "hotel_locations"];
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
        const guestPayload = { first_name: v.first_name.trim(), last_name: v.last_name.trim(), email: v.email || null, phone: v.phone || null, nationality: v.nationality || null, id_document_type: v.id_document_type || null, id_document_number: v.id_document_number || null, company_name: v.company_name || null, address: v.address || null, notes: v.notes || null };
        const result = editingGuestId ? await client.from("guests").update(guestPayload).eq("id", editingGuestId).eq("hotel_id", hotel.id) : await client.from("guests").insert({ hotel_id: hotel.id, ...guestPayload });
        if (result.error) throw result.error;
        setEditingGuestId(null);
        setNotice(editingGuestId ? "Guest profile updated." : "Guest saved.");
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
      } else if (tab === "maintenance" && v.kind !== "maintenance_work") {
        const { error } = await client.from("maintenance_requests").insert({ hotel_id: hotel.id, room_id: v.room_id || null, title: v.title.trim(), description: v.description || null, priority: v.priority || "normal", blocks_room_sale: v.blocks_room_sale !== "false", reported_by: session.user.id });
        if (error) throw error;
        if (v.room_id && v.blocks_room_sale !== "false") await client.from("rooms").update({ status: "maintenance" }).eq("id", v.room_id).eq("hotel_id", hotel.id);
        setNotice("Maintenance request created.");
      } else if (tab === "maintenance" && v.kind === "maintenance_work") {
        const { error } = await client.from("hotel_maintenance_work_logs").insert({
          hotel_id: hotel.id, maintenance_request_id: v.maintenance_request_id || null,
          room_id: v.room_id || null, work_title: v.work_title.trim(), work_description: v.work_description || null,
          performed_by: v.performed_by || null, vendor_name: v.vendor_name || null,
          work_date: v.work_date || today(), status: v.work_status || "completed",
          labour_cost: Number(v.labour_cost || 0), parts_cost: Number(v.parts_cost || 0),
          other_cost: Number(v.other_cost || 0), invoice_reference: v.invoice_reference || null,
          notes: v.work_notes || null, created_by: session.user.id
        });
        if (error) throw error;
        if (v.maintenance_request_id && v.work_status === "completed") {
          await client.from("maintenance_requests").update({ status: "completed", resolved_at: new Date().toISOString(), resolution_notes: v.work_description || v.work_notes || "Work completed; see maintenance work log." }).eq("id", v.maintenance_request_id).eq("hotel_id", hotel.id);
        }
        setNotice("Maintenance work and costs recorded.");
      } else if (tab === "settings" && v.kind === "hotel_location") {
        const { error } = await client.from("hotel_locations").insert({
          hotel_id: hotel.id, location_name: v.location_name.trim(), town: v.town.trim(),
          address: v.location_address || null, phone: v.location_phone || null,
          email: v.location_email || null, manager_name: v.location_manager || null
        });
        if (error) throw error;
        setNotice("Hotel location added.");
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

  const editGuest = (guest: Row) => { setEditingGuestId(guest.id); setForm({ first_name: guest.first_name || "", last_name: guest.last_name || "", email: guest.email || "", phone: guest.phone || "", nationality: guest.nationality || "", id_document_type: guest.id_document_type || "", id_document_number: guest.id_document_number || "", company_name: guest.company_name || "", address: guest.address || "", notes: guest.notes || "" }); window.scrollTo({ top: 0, behavior: "smooth" }); };

  const deletePropertyRecord = async (tableName: string, record: Row, label: string) => {
    if (!hotel || !record?.id) return;
    if (!window.confirm(`Delete this ${label}? This cannot be undone. Records linked to reservations, payments or audit history may be protected by the database.`)) return;
    setError(""); setNotice("");
    try {
      const { error } = await requireSupabase().from(tableName).delete().eq("id", record.id).eq("hotel_id", hotel.id);
      if (error) throw error;
      setNotice(`${label[0].toUpperCase()+label.slice(1)} deleted.`);
      if (tableName === "guests" && editingGuestId === record.id) { setEditingGuestId(null); setForm({}); }
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
  const table = (headers: string[], rows: (string | ReactNode)[][]) => {
    const textOf = (node: ReactNode): string => {
      if (node == null || typeof node === "boolean") return "";
      if (typeof node === "string" || typeof node === "number") return String(node);
      if (Array.isArray(node)) return node.map(textOf).join(" ");
      if (typeof node === "object" && "props" in node) return textOf((node as any).props?.children);
      return "";
    };
    const query = tableSearch.trim().toLocaleLowerCase();
    const filtered = query ? rows.filter((row) => row.some((cell) => textOf(cell).toLocaleLowerCase().includes(query))) : rows;
    return <section className="data-table-card"><div className="data-table-toolbar"><div><span className="data-table-eyebrow">PROPERTY RECORDS</span><strong>{filtered.length} <small>{filtered.length === 1 ? "record" : "records"}{query ? " found" : ""}</small></strong></div><label className="table-search"><span className="sr-only">Search records</span><input type="search" value={tableSearch} onChange={(e) => setTableSearch(e.target.value)} placeholder="Search this list…" /><span aria-hidden="true">⌕</span></label></div><div className="table-scroll"><table><thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{filtered.length ? filtered.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>) : <tr><td colSpan={headers.length} className="empty">{query ? "No matching records. Try another search." : "No records yet. Add your first record above."}</td></tr>}</tbody></table></div></section>;
  };
  const badge = (status: string) => <span className={`badge ${status}`}>{status?.replaceAll("_", " ")}</span>;
  const reservationActions = (r: Row) => <div className="actions">{r.status === "confirmed" && <button className="small" onClick={() => updateReservation(r, "checkin")}>Check in</button>}{r.status === "checked_in" && <button className="small" onClick={() => updateReservation(r, "checkout")}>Check out</button>}{["pending", "confirmed"].includes(r.status) && <button className="small danger" onClick={() => updateReservation(r, "cancel")}>Cancel</button>}</div>;

  let content: ReactNode;
  switch (tab) {
    case "overview": {
      const arrivalRows = data.reservations.filter((r) => r.check_in_date === today() && ["pending","confirmed"].includes(r.status)).slice(0,6);
      const departureRows = data.reservations.filter((r) => r.check_out_date === today() && r.status === "checked_in").slice(0,5);
      const openTasks = data.housekeeping_tasks.filter((t) => !["completed","verified","cancelled"].includes(t.status));
      const roomCounts = [
        {label:"Occupied",status:"occupied",count:data.rooms.filter((r)=>r.status==="occupied").length,cls:"occupied"},
        {label:"Available",status:"available",count:data.rooms.filter((r)=>r.active&&!["occupied","maintenance","out_of_service","dirty","cleaning"].includes(r.status)).length,cls:"available"},
        {label:"Cleaning",status:"dirty",count:data.rooms.filter((r)=>["dirty","cleaning"].includes(r.status)).length,cls:"cleaning"},
        {label:"Maintenance",status:"maintenance",count:data.rooms.filter((r)=>["maintenance","out_of_service"].includes(r.status)).length,cls:"maintenance"},
      ];
      const recent = [...data.reservations].sort((a,b)=>String(b.created_at??"").localeCompare(String(a.created_at??""))).slice(0,5);
      const roomRevenue = data.folio_items.filter((i)=>i.service_date===today()&&i.item_type==="room_charge").reduce((n,i)=>n+Number(i.amount||0),0);
      const restaurantSales = 0; // POS sales are shown in the POS workspace; not inferred from folio charges.
      const maxRate = Math.max(1,...[6,5,4,3,2,1,0].map((offset)=>data.folio_items.filter((i)=>i.service_date===dateInZambia(new Date(Date.now()-offset*86400000))&&i.item_type!=="discount").reduce((n,i)=>n+Number(i.amount||0),0)));
      const revenueDays = [6,5,4,3,2,1,0].map((offset)=>{const day=dateInZambia(new Date(Date.now()-offset*86400000));return {day,total:data.folio_items.filter((i)=>i.service_date===day&&i.item_type!=="discount").reduce((n,i)=>n+Number(i.amount||0),0)};});
      content = <div className="manager-dashboard">
        <section className="manager-welcome"><div><div className="hero-kicker">HOTEL OPERATIONS · MANAGER VIEW</div><h2>Welcome back</h2><p>Here’s what is happening at {hotel.name} today. Review front desk activity and take action from one place.</p><div className="manager-date"><CalendarDays size={15}/>{today()} <span>·</span> {hotel.city || "Hotel workspace"} <span className="live-dot"/> Live property records</div></div><div className="manager-actions"><button className="primary" onClick={()=>{setTab("reservations");setForm({});}}> <Plus size={16}/> New reservation</button><button className="secondary" onClick={()=>{setTab("guests");setForm({});}}><Users size={16}/> Walk-in guest</button></div></section>
        <div className="manager-kpis">
          <div className="manager-kpi"><span className="kpi-icon blue"><BedDouble/></span><span className="kpi-label">Occupancy</span><strong>{totals.rooms?Math.round(totals.occupied/totals.rooms*100):0}%</strong><small>{totals.occupied} occupied · {totals.rooms} sellable rooms</small><div className="kpi-track"><i style={{width:(totals.rooms?Math.min(100,totals.occupied/totals.rooms*100):0)+"%"}}/></div></div>
          <div className="manager-kpi"><span className="kpi-icon green"><CalendarDays/></span><span className="kpi-label">Arrivals today</span><strong>{totals.arrivals}</strong><small>{arrivalRows.filter(r=>r.status==="confirmed").length} confirmed in this list</small></div>
          <div className="manager-kpi"><span className="kpi-icon red"><LogOut/></span><span className="kpi-label">Departures today</span><strong>{totals.departures}</strong><small>Guests expected to check out</small></div>
          <div className="manager-kpi"><span className="kpi-icon gold"><Wallet/></span><span className="kpi-label">Room revenue today</span><strong>{money(roomRevenue)}</strong><small>Posted room charges</small></div>
          <div className="manager-kpi"><span className="kpi-icon green"><CreditCard/></span><span className="kpi-label">Payments received</span><strong>{money(totals.paid)}</strong><small>Posted receipts today</small></div>
          <div className="manager-kpi"><span className="kpi-icon purple"><Wallet/></span><span className="kpi-label">Open folio balance</span><strong>{money(totals.outstanding)}</strong><small>Balances across open folios</small></div>
        </div>
        <div className="manager-grid manager-grid-main">
          <section className="manager-card room-overview-card"><div className="manager-card-head"><div><h3>Room status</h3><p>At a glance, across your property</p></div><button className="text-action" onClick={()=>setTab("rooms")}>View all rooms →</button></div><div className="room-status-counts">{roomCounts.map(x=><div key={x.label} className={"room-status-count "+x.cls}><span>{x.label}</span><strong>{x.count}</strong></div>)}</div><div className="room-mini-grid">{data.rooms.slice(0,15).map(r=><button key={r.id} className={"room-mini "+(r.status||"available")} onClick={()=>setTab("rooms")}><strong>{r.room_number}</strong><span>{data.room_types.find(t=>t.id===r.room_type_id)?.name||"Room"}</span><em>{String(r.status||"available").replaceAll("_"," ")}</em></button>)}</div>{data.rooms.length===0&&<p className="muted">Add rooms to see your room map here.</p>}</section>
          <section className="manager-card"><div className="manager-card-head"><div><h3>Today’s activity</h3><p>Latest front desk and payment activity</p></div><button className="text-action" onClick={()=>setTab("reservations")}>Open reservations →</button></div><div className="activity-list">{recent.length===0?<p className="muted">New reservations will appear here.</p>:recent.map(r=><div className="activity-row" key={r.id}><span className="activity-icon"><CalendarDays size={16}/></span><div><strong>{r.status==="checked_in"?"Guest checked in":r.status==="checked_out"?"Guest checked out":"Reservation "+String(r.status||"created").replaceAll("_"," ")}</strong><small>{guestName(r.guest_id)} · Room {roomName(r.room_id)}</small></div><time>{r.check_in_date||"—"}</time></div>)}</div></section>
          <section className="manager-card revenue-card"><div className="manager-card-head"><div><h3>Revenue · last 7 days</h3><p>Folio charges recorded by service date</p></div><button className="text-action" onClick={()=>setTab("reports")}>Reports →</button></div><div className="revenue-chart">{revenueDays.map(d=><div className="revenue-column" key={d.day}><strong>{d.total?money(d.total):"—"}</strong><div className="revenue-bar-wrap"><i style={{height:Math.max(4,d.total/maxRate*100)+"%"}}/></div><small>{d.day.slice(5)}</small></div>)}</div><div className="chart-note"><span/> Daily charges (ZMW)</div></section>
          <section className="manager-card"><div className="manager-card-head"><div><h3>Upcoming arrivals</h3><p>Guests expected today</p></div><button className="text-action" onClick={()=>setTab("reservations")}>View all →</button></div>{arrivalRows.length===0?<div className="manager-empty">No arrivals due today.</div>:<div className="compact-list">{arrivalRows.map(r=><div className="compact-row" key={r.id}><span className="guest-avatar"><Users size={16}/></span><div className="compact-main"><strong>{guestName(r.guest_id)}</strong><small>Room {roomName(r.room_id)} · {r.check_in_date}</small></div>{badge(r.status)}</div>)}</div>}</section>
          <section className="manager-card"><div className="manager-card-head"><div><h3>Important tasks</h3><p>Items that may need attention</p></div><button className="text-action" onClick={()=>setTab("housekeeping")}>Manage →</button></div><div className="manager-task-list"><button onClick={()=>setTab("housekeeping")}><span className="task-mark green"><ClipboardList size={16}/></span><span><strong>{openTasks.length} housekeeping tasks open</strong><small>Review room cleaning and inspection queue</small></span><b>→</b></button><button onClick={()=>setTab("maintenance")}><span className="task-mark red"><Wrench size={16}/></span><span><strong>{data.maintenance_requests.filter(m=>!["completed","closed","resolved"].includes(m.status)).length} maintenance issues open</strong><small>Check rooms and maintenance requests</small></span><b>→</b></button><button onClick={()=>setTab("folios")}><span className="task-mark gold"><Wallet size={16}/></span><span><strong>Open guest folios</strong><small>{money(totals.outstanding)} outstanding balance to review</small></span><b>→</b></button><button onClick={()=>setTab("zra")}><span className="task-mark blue"><Printer size={16}/></span><span><strong>ZRA Smart Invoice</strong><small>Open connector and submission status</small></span><b>→</b></button></div></section>
          <section className="manager-card"><div className="manager-card-head"><div><h3>Departures today</h3><p>Checkout follow-up</p></div><button className="text-action" onClick={()=>setTab("reservations")}>View all →</button></div>{departureRows.length===0?<div className="manager-empty">No checked-in guests are due to depart today.</div>:<div className="compact-list">{departureRows.map(r=><div className="compact-row" key={r.id}><span className="guest-avatar"><LogOut size={16}/></span><div className="compact-main"><strong>{guestName(r.guest_id)}</strong><small>Room {roomName(r.room_id)} · Checkout {r.check_out_date}</small></div><button className="small" onClick={()=>updateReservation(r,"checkout")}>Check out</button></div>)}</div>}</section>
        </div>
        <div className="manager-grid manager-grid-bottom"><section className="manager-card"><div className="manager-card-head"><div><h3>Recent reservations</h3><p>Latest bookings in this property</p></div><button className="text-action" onClick={()=>setTab("reservations")}>Open booking book →</button></div>{table(["Reference","Guest","Room","Check-in","Check-out","Status"],recent.map(r=>[r.reservation_number,guestName(r.guest_id),roomName(r.room_id),r.check_in_date,r.check_out_date,badge(r.status)]))}</section><section className="manager-card financial-summary"><div className="manager-card-head"><div><h3>Today’s financial summary</h3><p>Hotel charges and collections</p></div><button className="text-action" onClick={()=>setTab("accounting")}>Accounting →</button></div><div className="financial-line"><span>Room charges</span><strong>{money(roomRevenue)}</strong></div><div className="financial-line"><span>All folio charges</span><strong>{money(totals.revenue)}</strong></div><div className="financial-line"><span>Payments received</span><strong>{money(totals.paid)}</strong></div><div className="financial-line"><span>Open folio balance</span><strong>{money(totals.outstanding)}</strong></div><div className="financial-total"><span>Payments received today</span><strong>{money(totals.paid)}</strong></div><p className="muted">Restaurant sales are tracked separately in POS and are not added to room revenue here.</p></section></div>
        <section className="manager-onboarding"><div><strong>New to SifoBooks Hotel?</strong><span>Complete your property setup before processing live transactions.</span></div><button className="secondary" onClick={()=>setTab("settings")}>Property settings</button><button className="secondary" onClick={()=>setTab("rooms")}>Set up rooms</button><button className="secondary" onClick={()=>setTab("staff")}>Manage staff access</button></section>
      </div>;
      break;
    }
    case "rooms":
      content = <><div className="panel"><h2>Add room type</h2>{submitForm(<><input type="hidden" value="room_type" onChange={() => {}} />{select("kind", "Record type", [{value:"room_type",label:"Room type"}])}{field("type_name", "Type name")}{field("type_code", "Code")}{field("max_occupancy", "Max occupancy", "number", true, {min:1, defaultValue:"2"})}{field("base_rate", "Nightly rate (ZMW)", "number", true, {min:0,step:"0.01"})}{field("description", "Description", "text", false)}{submitButton("Save room type")}</>)}</div><div className="panel"><h2>Add room</h2>{data.room_types.length === 0 ? <p className="muted">Create a room type first.</p> : submitForm(<>{select("kind", "Record type", [{value:"room",label:"Room"}])}{field("room_number", "Room number")}{select("room_type_id", "Room type", data.room_types.map((r) => ({value:r.id,label:`${r.name} · ${money(r.base_rate)}`})))}{field("floor_label", "Floor / wing", "text", false)}{submitButton("Save room")}</>)}</div><section className="panel room-board-panel"><div className="panel-head"><div><span className="data-table-eyebrow">FRONT DESK</span><h2>Live room board</h2><p>Room status at a glance. Use the status control to update housekeeping and availability.</p></div><span className="board-count">{data.rooms.length} rooms</span></div><div className="live-room-grid">{data.rooms.map((r)=>{const type=data.room_types.find((t)=>t.id===r.room_type_id);const activeBooking=data.reservations.find(b=>b.room_id===r.id&&["confirmed","checked_in"].includes(b.status)&&b.check_in_date<=today()&&b.check_out_date>today());return <article className={'live-room-tile '+String(r.status||'available')} key={r.id}><div className="live-room-top"><span className="room-number-label">ROOM</span><strong>{r.room_number}</strong><span className={'room-status-dot '+String(r.status||'available')}/></div><span className="live-room-type">{type?.name||'Room type not set'}</span><span className="live-room-rate">{money(type?.base_rate)} <small>/ night</small></span>{activeBooking&&<span className="room-guest-line">{guestName(activeBooking.guest_id)}</span>}<label className="room-status-control">Status<select value={r.status||'available'} onChange={(e)=>changeRoomStatus(r,e.target.value)}><option value="available">Available</option><option value="occupied">Occupied</option><option value="dirty">Dirty</option><option value="cleaning">Cleaning</option><option value="maintenance">Maintenance</option><option value="out_of_service">Out of service</option></select></label></article>})}{!data.rooms.length&&<div className="manager-empty">Add rooms to start using the live room board.</div>}</div></section><div className="panel"><h2>Room inventory</h2>{table(["Room", "Type", "Rate / night", "Status", "Quick update"], data.rooms.map((r) => [r.room_number, data.room_types.find((t) => t.id === r.room_type_id)?.name ?? "—", money(data.room_types.find((t) => t.id === r.room_type_id)?.base_rate), badge(r.status), <select aria-label={`Update room ${r.room_number} status`} className="inline-select" value={r.status} onChange={(e) => changeRoomStatus(r, e.target.value)}><option value="available">Available</option><option value="occupied">Occupied</option><option value="dirty">Dirty</option><option value="cleaning">Cleaning</option><option value="maintenance">Maintenance</option><option value="out_of_service">Out of service</option></select>]))}</div></>;
      break;
    case "guests":
      content = <><div className="panel"><div className="panel-head"><div><h2>{editingGuestId ? "Edit guest profile" : "Add guest"}</h2><p>Save changes to update this guest throughout the property records.</p></div>{editingGuestId && <button type="button" className="secondary" onClick={() => { setEditingGuestId(null); setForm({}); }}>Cancel edit</button>}</div>{submitForm(<>{field("first_name", "First name")}{field("last_name", "Last name")}{field("email", "Email", "email", false)}{field("phone", "Phone", "tel", false)}{field("nationality", "Nationality", "text", false)}{field("id_document_type", "ID document type", "text", false)}{field("id_document_number", "ID / passport number", "text", false)}{field("company_name", "Company / organisation", "text", false)}{field("address", "Address", "text", false)}{field("notes", "Guest notes / preferences", "text", false)}{submitButton("Save guest")}</>)}</div><section className="guest-relationship-strip"><div><span>GUEST RELATIONSHIPS</span><strong>{data.guests.length}</strong><small>Profiles in your directory</small></div><div><span>REPEAT VISITORS</span><strong>{data.guests.filter(g=>data.reservations.filter(r=>r.guest_id===g.id&&!['cancelled','no_show'].includes(r.status)).length>1).length}</strong><small>More than one reservation</small></div><div><span>CONTACTABLE</span><strong>{data.guests.filter(g=>g.email||g.phone).length}</strong><small>Email or phone available</small></div></section><div className="panel"><div className="panel-head"><div><h2>Guest directory</h2><p>Export your guest register or contact a guest directly.</p></div><button className="secondary" onClick={() => exportCsv("sifobooks-guests.csv", ["First name","Last name","Email","Phone","Nationality"], data.guests.map((g) => [g.first_name,g.last_name,g.email,g.phone,g.nationality]))}>Export CSV</button></div>{table(["Guest", "Email", "Phone", "Nationality", "Contact"], data.guests.map((g) => [`${g.first_name} ${g.last_name}`, g.email ?? "—", g.phone ?? "—", g.nationality ?? "—", <div className="actions"><button type="button" className="small" onClick={() => editGuest(g)}>Edit</button><button type="button" className="small danger" onClick={() => void deletePropertyRecord("guests", g, "guest")}>Delete</button>{g.email && <a className="small guest-share-action" href={`mailto:${encodeURIComponent(g.email)}?subject=${encodeURIComponent("Greetings from "+hotel.name)}&body=${encodeURIComponent("Dear "+g.first_name+",\n\nThank you for choosing "+hotel.name+". We hope you had a pleasant stay. If you need a reservation, invoice or any assistance, simply reply to this email.\n\nKind regards,\n"+hotel.name+(hotel.phone?"\n"+hotel.phone:""))}`}>Email guest ↗</a>}{g.phone && <a className="small guest-share-action whatsapp-share" target="_blank" rel="noreferrer" href={`https://wa.me/${(String(g.phone).replace(/[^0-9]/g,"").startsWith("0")?"260"+String(g.phone).replace(/[^0-9]/g,"").slice(1):String(g.phone).replace(/[^0-9]/g,""))}?text=${encodeURIComponent("Hello "+g.first_name+", greetings from "+hotel.name+". Thank you for choosing us. How may we assist you with your stay or next reservation?")}`}>WhatsApp ↗</a>}</div>]))}</div></>;
      break;
    case "reservations":
      content = <><div className="panel"><h2>Create reservation</h2>{data.guests.length === 0 || data.rooms.length === 0 ? <p className="muted">Add at least one guest and one room before creating a reservation.</p> : submitForm(<>{select("guest_id", "Guest", data.guests.map((g) => ({value:g.id,label:`${g.first_name} ${g.last_name}`})))}{select("room_id", "Room", data.rooms.filter((r) => r.active && !["maintenance","out_of_service"].includes(r.status)).map((r) => ({value:r.id,label:`${r.room_number} · ${data.room_types.find((t) => t.id === r.room_type_id)?.name ?? "Room"}`})))}{field("check_in_date", "Check-in", "date", true, {min:today(),defaultValue:today()})}{field("check_out_date", "Check-out", "date", true, {min:today()})}{field("adults", "Adults", "number", true, {min:1,defaultValue:"1"})}{field("children", "Children", "number", true, {min:0,defaultValue:"0"})}{field("nightly_rate", "Nightly rate (ZMW, blank uses room rate)", "number", false, {min:0,step:"0.01"})}{submitButton("Confirm reservation")}</>)}</div><section className="panel reservation-calendar-panel"><div className="panel-head"><div><span className="data-table-eyebrow">PLANNING</span><h2>Reservation calendar</h2><p>Monthly arrival and stay overview. Select a date to review bookings for that day.</p></div><div className="calendar-controls"><button className="secondary" type="button" onClick={()=>setCalendarMonth(m=>new Date(m.getFullYear(),m.getMonth()-1,1))}>‹</button><strong>{calendarMonth.toLocaleDateString('en-ZM',{month:'long',year:'numeric'})}</strong><button className="secondary" type="button" onClick={()=>setCalendarMonth(m=>new Date(m.getFullYear(),m.getMonth()+1,1))}>›</button><button className="small" type="button" onClick={()=>setCalendarMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1))}>Today</button></div></div><div className="reservation-calendar-grid">{['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=><div className="calendar-weekday" key={d}>{d}</div>)}{Array.from({length:(new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1).getDay()+6)%7},(_,i)=><div className="calendar-day outside" key={'blank-'+i}/>) }{Array.from({length:new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,0).getDate()},(_,i)=>{const day=new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),i+1);const iso=day.getFullYear()+'-'+String(day.getMonth()+1).padStart(2,'0')+'-'+String(day.getDate()).padStart(2,'0');const bookings=data.reservations.filter(r=>r.check_in_date<=iso&&r.check_out_date>iso&&!['cancelled','no_show'].includes(r.status));const arrivals=data.reservations.filter(r=>r.check_in_date===iso&&!['cancelled','no_show'].includes(r.status));return <button type="button" key={iso} className={'calendar-day '+(iso===today()?'is-today':'')} onClick={()=>{setTableSearch(iso);setNotice('Calendar date selected: '+iso+'. Matching reservations are filtered below.');}}><span className="calendar-date">{i+1}</span>{arrivals.length>0&&<span className="calendar-event arrival">{arrivals.length} arrival{arrivals.length===1?'':'s'}</span>}{bookings.length>0&&<span className="calendar-event stay">{bookings.length} in-house</span>}</button>})}</div><div className="calendar-legend"><span><i className="arrival-key"/> Arrival day</span><span><i className="stay-key"/> Active stay</span><span>Tap a date to filter the reservation book by date.</span></div></section><div className="panel"><div className="panel-head"><div><h2>Reservation book</h2><p>Bookings, arrivals, departures and stay status.</p></div><button className="secondary" onClick={() => exportCsv("sifobooks-reservations.csv", ["Reference","Guest","Room","Check-in","Check-out","Status"], data.reservations.map((r) => [r.reservation_number,guestName(r.guest_id),roomName(r.room_id),r.check_in_date,r.check_out_date,r.status]))}>Export CSV</button></div>{table(["Reference", "Guest", "Room", "Check-in", "Check-out", "Status", "Actions"], data.reservations.map((r) => [r.reservation_number, guestName(r.guest_id), roomName(r.room_id), r.check_in_date, r.check_out_date, badge(r.status), reservationActions(r)]))}</div></>;
      break;
    case "housekeeping":
      content = <><div className="panel"><h2>Create housekeeping task</h2>{data.rooms.length === 0 ? <p className="muted">Add rooms first.</p> : submitForm(<>{select("room_id", "Room", data.rooms.map((r) => ({value:r.id,label:r.room_number})))}{select("task_type", "Task", [{value:"cleaning",label:"Cleaning"},{value:"inspection",label:"Inspection"},{value:"linen",label:"Linen"},{value:"deep_clean",label:"Deep clean"}])}{select("priority", "Priority", [{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"},{value:"urgent",label:"Urgent"}])}{field("notes", "Notes", "text", false)}{submitButton("Create task")}</>)}</div><section className="panel housekeeping-board-panel"><div className="panel-head"><div><span className="data-table-eyebrow">ROOM READINESS</span><h2>Housekeeping workboard</h2><p>Tasks grouped by operational status for quick shift handover.</p></div></div><div className="housekeeping-lanes">{[{key:'pending',label:'To do',cls:'todo'},{key:'in_progress',label:'In progress',cls:'progress'},{key:'completed',label:'Completed',cls:'done'}].map(lane=>{const tasks=data.housekeeping_tasks.filter(t=>lane.key==='completed'?['completed','verified'].includes(t.status):t.status===lane.key);return <div className="housekeeping-lane" key={lane.key}><div className="housekeeping-lane-head"><span className={'lane-dot '+lane.cls}/><strong>{lane.label}</strong><span>{tasks.length}</span></div>{tasks.length?tasks.map(t=><article className="housekeeping-task-card" key={t.id}><div className="housekeeping-task-title">Room {roomName(t.room_id)}</div><span className="housekeeping-task-kind">{String(t.task_type||'cleaning').replaceAll('_',' ')}</span><div className="housekeeping-task-meta"><span className={'priority-label '+String(t.priority||'normal')}>{t.priority||'normal'} priority</span></div>{t.notes&&<p>{t.notes}</p>}{!['completed','verified','cancelled'].includes(t.status)&&<button className="small" type="button" onClick={()=>completeTask(t)}>{t.status==='pending'?'Start task':'Complete task'}</button>}</article>):<div className="lane-empty">No tasks in this stage.</div>}</div>})}</div></section><div className="panel"><h2>Housekeeping queue</h2>{table(["Room", "Task", "Priority", "Status", "Action"], data.housekeeping_tasks.map((t) => [roomName(t.room_id), t.task_type, badge(t.priority), badge(t.status), ["completed","verified","cancelled"].includes(t.status) ? "—" : <button className="small" onClick={() => completeTask(t)}>{t.status === "pending" ? "Start task" : "Complete task"}</button>]))}</div></>;
      break;
    case "folios":
      content = <><div className="panel"><h2>Add folio charge</h2>{data.folios.length === 0 ? <p className="muted">A folio is created automatically when you confirm a reservation.</p> : submitForm(<>{select("kind", "Action", [{value:"charge",label:"Add charge"}])}{select("folio_id", "Folio", data.folios.filter((f) => f.status === "open").map((f) => ({value:f.id,label:`${f.folio_number} · ${guestName(data.reservations.find((r) => r.id === f.reservation_id)?.guest_id ?? "")}`})))}{select("item_type", "Charge type", [{value:"room_charge",label:"Room charge"},{value:"food_beverage",label:"Food & beverage"},{value:"service",label:"Service"},{value:"tax",label:"Tax"},{value:"discount",label:"Discount"},{value:"other",label:"Other"}])}{field("description", "Description")}{field("quantity", "Quantity", "number", true, {min:0.001,step:"0.001",defaultValue:"1"})}{field("unit_price", "Unit price (ZMW)", "number", true, {step:"0.01"})}{field("service_date", "Service date", "date", true, {defaultValue:today()})}{submitButton("Add charge")}</>)}</div><div className="panel"><h2>Record payment</h2>{data.folios.length === 0 ? <p className="muted">Create a reservation first.</p> : submitForm(<>{select("kind", "Action", [{value:"payment",label:"Record payment"}])}{select("folio_id", "Folio", data.folios.filter((f) => f.status === "open").map((f) => ({value:f.id,label:f.folio_number})))}{select("method", "Method", [{value:"cash",label:"Cash"},{value:"card",label:"Card"},{value:"bank_transfer",label:"Bank transfer"},{value:"mobile_money",label:"Mobile money"},{value:"voucher",label:"Voucher"},{value:"other",label:"Other"}])}{field("amount", "Amount (ZMW)", "number", true, {min:0.01,step:"0.01"})}{field("reference", "Reference", "text", false)}{submitButton("Record receipt")}</>)}</div><div className="panel"><h2>Guest folios</h2>{table(["Folio", "Guest", "Reservation", "Charges", "Payments", "Balance", "Status"], data.folios.map((f) => [f.folio_number, guestName(data.reservations.find((r) => r.id === f.reservation_id)?.guest_id ?? ""), data.reservations.find((r) => r.id === f.reservation_id)?.reservation_number ?? "—", money(data.folio_items.filter((i) => i.folio_id === f.id).reduce((s, i) => s + Number(i.amount || 0), 0)), money(data.payments.filter((p) => p.folio_id === f.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0), 0)), money(folioBalance(f)), badge(f.status)]))}</div><div className="panel"><h2>Receipt history</h2>{table(["Receipt", "Date", "Guest", "Method", "Amount", "Reference", "Print"], data.payments.filter((p) => p.status === "posted").map((p) => [p.payment_number, new Date(p.received_at).toLocaleDateString("en-ZM", { timeZone: "Africa/Lusaka" }), guestName(data.reservations.find((r) => r.id === (p.reservation_id || data.folios.find((f) => f.id === p.folio_id)?.reservation_id))?.guest_id ?? ""), p.method, money(p.amount), p.reference ?? "—", <button className="small" onClick={() => printReceipt(p)}>Print receipt</button>]))}</div></>;
      break;
    case "maintenance":
      content = <><div className="panel"><h2>Report maintenance issue</h2>{submitForm(<>{field("title", "Issue title")}{select("room_id", "Room (optional)", data.rooms.map((r) => ({value:r.id,label:r.room_number})), false)}{select("priority", "Priority", [{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"},{value:"urgent",label:"Urgent"}])}{select("blocks_room_sale", "Block room sales?", [{value:"true",label:"Yes — mark room unavailable"},{value:"false",label:"No"}])}{field("description", "Details", "text", false)}{submitButton("Create maintenance ticket")}</>)}</div>
      <div className="panel"><h2>Works completed & costs</h2><p className="muted">Record labour, parts, contractor and other costs against a maintenance issue or room.</p>{submitForm(<><input type="hidden" name="kind" value="maintenance_work"/>{field("work_title","Work completed / job title")}{select("maintenance_request_id","Related maintenance ticket",data.maintenance_requests.map(m=>({value:m.id,label:m.title+" · "+String(m.status||"open")})),false)}{select("room_id","Room",data.rooms.map(r=>({value:r.id,label:r.room_number})),false)}{field("work_date","Work date","date",true,{defaultValue:today()})}{select("work_status","Work status",[{value:"planned",label:"Planned"},{value:"in_progress",label:"In progress"},{value:"completed",label:"Completed"},{value:"cancelled",label:"Cancelled"}])}{field("performed_by","Technician / staff")}{field("vendor_name","Contractor / supplier", "text",false)}{field("labour_cost","Labour cost (ZMW)","number",true,{min:0,step:"0.01",defaultValue:"0"})}{field("parts_cost","Parts / materials cost (ZMW)","number",true,{min:0,step:"0.01",defaultValue:"0"})}{field("other_cost","Other cost (ZMW)","number",true,{min:0,step:"0.01",defaultValue:"0"})}{field("invoice_reference","Invoice / receipt reference","text",false)}{field("work_description","Work performed","text",false)}{field("work_notes","Notes","text",false)}{submitButton("Save work record & costs")}</>)}</div>
      <div className="panel"><h2>Maintenance tickets</h2>{table(["Issue","Room","Priority","Status","Reported"],data.maintenance_requests.map(m=>[m.title,roomName(m.room_id),badge(m.priority),badge(m.status),m.created_at?new Date(m.created_at).toLocaleDateString():"—"]))}</div>
      <div className="panel"><h2>Work history & cost register</h2>{table(["Date","Work completed","Room","Technician / vendor","Labour","Parts","Other","Total cost","Status"],data.hotel_maintenance_work_logs.map(w=>[w.work_date,w.work_title,roomName(w.room_id),[w.performed_by,w.vendor_name].filter(Boolean).join(" / ")||"—",money(w.labour_cost),money(w.parts_cost),money(w.other_cost),money(w.total_cost),badge(w.status)]))}</div></>;
      break;
    case "night_audit": {
      const auditedToday = data.night_audits.find((a) => a.business_date === today());
      content = <><div className="panel"><h2>Night audit · Daily close</h2><p className="muted">Reconcile today's room charges, other charges, receipts and physical cash before closing the business date. This does not post to an external accounting ledger.</p>{auditedToday ? <div className="alert success"><CheckCircle2 size={18} />Audit closed for {auditedToday.business_date}. Cash variance: {money(auditedToday.variance)}.</div> : submitForm(<>{field("business_date", "Business date", "date", true, {defaultValue:today(),max:today()})}{field("cash_counted", "Physical cash counted (ZMW)", "number", true, {min:0,step:"0.01",defaultValue:"0"})}{field("notes", "Closing notes", "text", false)}{submitButton("Reconcile and close day")}</>)}</div><div className="panel"><h2>Previous night audits</h2>{table(["Business date", "Room revenue", "Other revenue", "Payments", "Cash variance", "Status"], data.night_audits.map((a) => [a.business_date, money(a.room_revenue), money(a.other_revenue), money(a.payments_total), money(a.variance), badge(a.status)]))}</div></>;
      break;
    }
    case "accounting":
      content = <AccountingPanel hotelId={hotel.id} />;
      break;
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
      content = <><div className="panel"><h2>Add staff member</h2><p className="muted">Invite a new staff member by email or add an existing confirmed account. Access is limited to this hotel.</p>{submitForm(<>{field("staff_email", "Staff account email", "email")}{select("staff_role", "Role", [{value:"manager",label:"Manager"},{value:"receptionist",label:"Receptionist"},{value:"housekeeping",label:"Housekeeping"},{value:"accountant",label:"Accountant"},{value:"pos_cashier",label:"POS Cashier"},{value:"bar_cashier",label:"Bar Cashier"},{value:"restaurant_cashier",label:"Restaurant Cashier"},{value:"maintenance",label:"Maintenance"},{value:"viewer",label:"Read-only viewer"}])}{submitButton("Grant hotel access")}</>)}</div><div className="panel"><h2>Staff access</h2>{table(["Email", "Role", "Access", "Action"], staff.map((m) => [m.email ?? m.user_id, m.role, badge(m.active ? "active" : "suspended"), m.role === "owner" ? "Property owner" : <button className={m.active ? "small danger" : "small"} onClick={() => toggleStaff(m)}>{m.active ? "Suspend access" : "Restore access"}</button>]))}</div></>;
      break;
    case "zra":
      content = <ZraPanel hotelId={hotel.id} role={membershipRole} />;
      break;
    case "documents":
      content = <DocumentsPanel hotel={hotel} guests={data.guests} reservations={data.reservations} rooms={data.rooms} roomTypes={data.room_types} folios={data.folios} folioItems={data.folio_items} payments={data.payments} />;
      break;
    case "pos":
      content = <PosWorkspace hotel={hotel} session={session} role={membershipRole} />;
      break;
    case "printing_network":
      content = <PrintingNetworkPanel />;
      break;
    case "settings":
      content = <><div className="panel"><h2>Property settings</h2><p className="muted">Zambia defaults: ZMW, Africa/Lusaka, with VAT disabled until configured by the hotel.</p>{submitForm(<>{field("name", "Hotel name", "text", true, {defaultValue:hotel.name})}{field("legal_name", "Registered legal name", "text", false, {defaultValue:hotel.legal_name ?? ""})}{field("email", "Business email", "email", false, {defaultValue:hotel.email ?? ""})}{field("phone", "Phone", "tel", false, {defaultValue:hotel.phone ?? ""})}{field("address", "Address", "text", false, {defaultValue:hotel.address ?? ""})}{field("city", "City", "text", false, {defaultValue:hotel.city ?? ""})}{field("tax_registration_number", "Tax registration number", "text", false, {defaultValue:hotel.tax_registration_number ?? ""})}{field("check_in_time", "Standard check-in time", "time", true, {defaultValue:hotel.check_in_time ?? "14:00"})}{field("check_out_time", "Standard check-out time", "time", true, {defaultValue:hotel.check_out_time ?? "10:00"})}{select("vat_enabled", "VAT enabled?", [{value:"false",label:"No"},{value:"true",label:"Yes"}], true)}{field("vat_rate", "VAT rate (%)", "number", true, {min:0,max:100,step:"0.01",defaultValue:String(hotel.vat_rate ?? 0)})}{submitButton("Save settings")}</>)}</div><div className="panel"><h2>Additional hotel locations</h2><p className="muted">Add branches in other towns under this hotel group. Each location is stored with its town, contact details and manager.</p>{submitForm(<><input type="hidden" name="kind" value="hotel_location"/>{field("location_name","Location / branch name")}{field("town","Town / city")}{field("location_address","Street address","text",false)}{field("location_phone","Location phone","tel",false)}{field("location_email","Location email","email",false)}{field("location_manager","Location manager","text",false)}{submitButton("Add location")}</>)}{table(["Branch","Town","Manager","Phone","Email","Status"],data.hotel_locations.map(l=>[l.location_name,l.town,l.manager_name||"—",l.phone||"—",l.email||"—",badge(l.active?"active":"inactive")]))}</div></>;
      break;
  }

  const pageHighlights: {label:string;value:string|number;note:string}[] = tab === "rooms" ? [
    {label:"Total rooms",value:data.rooms.length,note:"Configured inventory"},
    {label:"Occupied",value:data.rooms.filter(r=>r.status==="occupied").length,note:"Currently in use"},
    {label:"Ready to sell",value:data.rooms.filter(r=>r.active&&!["occupied","maintenance","out_of_service","dirty","cleaning"].includes(r.status)).length,note:"Available room status"},
    {label:"Needs attention",value:data.rooms.filter(r=>["dirty","cleaning","maintenance","out_of_service"].includes(r.status)).length,note:"Housekeeping or maintenance"}
  ] : tab === "guests" ? [
    {label:"Guest profiles",value:data.guests.length,note:"Saved guest records"},
    {label:"With email",value:data.guests.filter(g=>g.email).length,note:"Email contact available"},
    {label:"With phone",value:data.guests.filter(g=>g.phone).length,note:"Phone contact available"},
    {label:"Reservations",value:data.reservations.length,note:"All recorded bookings"}
  ] : tab === "reservations" ? [
    {label:"All bookings",value:data.reservations.length,note:"Reservation register"},
    {label:"Confirmed",value:data.reservations.filter(r=>r.status==="confirmed").length,note:"Ready for arrival"},
    {label:"Checked in",value:data.reservations.filter(r=>r.status==="checked_in").length,note:"Guests currently staying"},
    {label:"Due today",value:data.reservations.filter(r=>r.check_in_date===today()&&["pending","confirmed"].includes(r.status)).length,note:"Expected arrivals"}
  ] : tab === "housekeeping" ? [
    {label:"Open tasks",value:data.housekeeping_tasks.filter(t=>!["completed","verified","cancelled"].includes(t.status)).length,note:"Require follow-up"},
    {label:"Pending",value:data.housekeeping_tasks.filter(t=>t.status==="pending").length,note:"Not yet started"},
    {label:"In progress",value:data.housekeeping_tasks.filter(t=>t.status==="in_progress").length,note:"Currently being handled"},
    {label:"Completed",value:data.housekeeping_tasks.filter(t=>["completed","verified"].includes(t.status)).length,note:"Finished tasks"}
  ] : tab === "folios" ? [
    {label:"Open folios",value:data.folios.filter(f=>f.status==="open").length,note:"Active guest accounts"},
    {label:"Outstanding",value:money(totals.outstanding),note:"Calculated open balance"},
    {label:"Payments today",value:money(totals.paid),note:"Posted receipts"},
    {label:"Receipts",value:data.payments.filter(p=>p.status==="posted").length,note:"Posted payment records"}
  ] : tab === "maintenance" ? [
    {label:"Open issues",value:data.maintenance_requests.filter(m=>!["completed","closed","resolved"].includes(m.status)).length,note:"Need attention"},
    {label:"High priority",value:data.maintenance_requests.filter(m=>["high","urgent"].includes(m.priority)&&!["completed","closed","resolved"].includes(m.status)).length,note:"Prioritise these issues"},
    {label:"Work records",value:data.hotel_maintenance_work_logs.length,note:"Maintenance history"},
    {label:"Recorded costs",value:money(data.hotel_maintenance_work_logs.reduce((n,w)=>n+Number(w.total_cost||0),0)),note:"Logged labour and parts"}
  ] : tab === "night_audit" ? [
    {label:"Audit records",value:data.night_audits.length,note:"Closed business dates"},
    {label:"Room charges today",value:money(data.folio_items.filter(i=>i.service_date===today()&&i.item_type==="room_charge").reduce((n,i)=>n+Number(i.amount||0),0)),note:"Folio room charges"},
    {label:"Receipts today",value:money(totals.paid),note:"Posted payments"},
    {label:"Open folios",value:data.folios.filter(f=>f.status==="open").length,note:"Still active"}
  ] : tab === "reports" ? [
    {label:"Reservations",value:data.reservations.length,note:"Bookings in current register"},
    {label:"Rooms",value:data.rooms.length,note:"Configured room inventory"},
    {label:"Guest profiles",value:data.guests.length,note:"Saved guest directory"},
    {label:"Payments posted",value:data.payments.filter(p=>p.status==="posted").length,note:"Recorded collections"}
  ] : [];
  return <div className="app-shell"><header className="app-header"><div className="app-brand-row"><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks</strong><small>Hotel Management</small></div></div><div className="app-header-right"><span className="property-chip">{hotel.name}</span><span className="user-chip">{session.user.email}</span><button className="secondary signout-button" onClick={() => requireSupabase().auth.signOut()}><LogOut size={16}/> Sign out</button></div></div><nav className="top-menu">{tabs.filter((item) => { const allowed: Record<string, string[]> = { owner: tabs.map((t) => t.id), manager: tabs.filter((t) => t.id !== "staff").map((t) => t.id), pos_cashier: ["pos"], cashier: ["pos"], bar_cashier: ["pos"], restaurant_cashier: ["pos"], receptionist: ["overview","rooms","guests","reservations","folios"], housekeeping: ["overview","rooms","housekeeping"], accountant: ["overview","guests","reservations","folios","night_audit","reports","accounting","zra"], maintenance: ["overview","rooms","maintenance"], viewer: ["overview","reports","accounting"] }; return (allowed[membershipRole] ?? allowed.viewer).includes(item.id); }).map((item) => <button key={item.id} title={item.label} className={tab === item.id ? "top-menu-item active" : "top-menu-item"} onClick={() => { setTab(item.id); setForm({}); setError(""); setNotice(""); }}><item.icon size={17}/><span>{item.label}</span></button>)}</nav></header><main className="main"><header className="topbar"><div><span className="eyebrow">SIFOBOOKS HOTEL PMS</span><h1>{tabs.find((t) => t.id === tab)?.label}</h1><p>{hotel.city ? `${hotel.city}, ${hotel.country}` : hotel.country} · {hotel.currency_code} · {new Date().toLocaleDateString()}</p></div><button className="secondary" onClick={() => refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />Refresh</button></header>{error && <div className="alert error">{error}<button onClick={() => setError("")}>×</button></div>}{notice && <div className="alert success">{notice}<button onClick={() => setNotice("")}>×</button></div>}{loading && <div className="loading-line">Syncing hotel records…</div>}{tab !== "overview" && <section className="page-intro"><div className="page-intro-mark">{(() => { const PageIcon = tabs.find((item) => item.id === tab)?.icon ?? Hotel; return <PageIcon size={23} />; })()}</div><div className="page-intro-copy"><div className="hero-kicker">PROPERTY WORKSPACE <span className="intro-dot">·</span> {today()}</div><h2>{tabs.find((item) => item.id === tab)?.label}</h2><p>{({rooms:"Manage room inventory, room types, rates and availability.",guests:"Keep guest contact details organised for a smooth arrival.",reservations:"Create bookings, manage the reservation book and process guest arrivals and departures.",housekeeping:"Coordinate room cleaning, inspections and task priorities.",folios:"Manage guest charges, balances, payments and printable receipts.",maintenance:"Track maintenance issues and protect rooms that cannot be sold.",night_audit:"Reconcile daily charges, receipts and cash before closing the business date.",reports:"Review property performance, revenue, room nights and daily audit history.",accounting:"Review double-entry postings, trial balance and profit-and-loss summaries.",staff:"Control staff access and assign permissions by hotel role.",settings:"Manage property details, operating times and Zambia VAT configuration.",printing_network:"Discover local Windows printers, check network details and send test text jobs to the Windows print spooler.",zra:"Configure hotel-specific ZRA Smart Invoice settings, connector pairing and submission history.",documents:"Print-ready hotel documents using the navy, gold and white SifoBooks design system."} as Record<string,string>)[tab]}</p></div><span className="intro-status"><span></span> HOTEL OPERATIONS</span></section>}{pageHighlights.length>0&&<section className="page-highlights">{pageHighlights.map((item)=><article className="page-highlight" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></article>)}</section>}{content}<footer>Private hotel workspace · Row-level security enabled · {hotel.timezone}</footer></main></div>;
}

function Metric({ title, value, icon }: { title: string; value: ReactNode; icon: ReactNode }) {
  return <div className="metric"><span className="metric-icon">{icon}</span><span className="metric-label">{title}</span><strong>{value}</strong></div>;
}
