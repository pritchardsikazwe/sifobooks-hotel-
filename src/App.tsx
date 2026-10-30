import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BedDouble, CalendarDays, CheckCircle2, ClipboardList, CreditCard, DoorOpen, Hotel, LogOut, Moon, Plus, RefreshCw, Users, Wallet, Wrench } from "lucide-react";
import { requireSupabase, supabase, supabaseReady } from "./lib/supabase";

type Row = Record<string, any>;
type Tab = "overview" | "rooms" | "guests" | "reservations" | "housekeeping" | "folios" | "maintenance" | "night_audit" | "settings";
const tabs: { id: Tab; label: string; icon: typeof Hotel }[] = [
  { id: "overview", label: "Overview", icon: Hotel },
  { id: "rooms", label: "Rooms", icon: BedDouble },
  { id: "guests", label: "Guests", icon: Users },
  { id: "reservations", label: "Reservations", icon: CalendarDays },
  { id: "housekeeping", label: "Housekeeping", icon: ClipboardList },
  { id: "folios", label: "Folios & payments", icon: Wallet },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "night_audit", label: "Night audit", icon: Moon },
  { id: "settings", label: "Hotel settings", icon: DoorOpen },
];
const today = () => new Date().toISOString().slice(0, 10);
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
  const [hotelName, setHotelName] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Record<string, Row[]>>({
    room_types: [], rooms: [], guests: [], reservations: [], folios: [], folio_items: [], payments: [],
    housekeeping_tasks: [], maintenance_requests: [], night_audits: [],
  });
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!supabase) { setAuthLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => setSession(data.session)).finally(() => setAuthLoading(false));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, current) => setSession(current));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadHotel = useCallback(async () => {
    if (!session?.user?.id) { setHotel(null); return; }
    const client = requireSupabase();
    const { data: own, error: ownError } = await client.from("hotels").select("*").eq("owner_user_id", session.user.id).order("created_at").limit(1).maybeSingle();
    if (ownError) throw ownError;
    if (own) { setHotel(own); return; }
    const { data: membership, error: memberError } = await client.from("hotel_memberships").select("hotel_id,hotels(*)").eq("user_id", session.user.id).eq("active", true).limit(1).maybeSingle();
    if (memberError) throw memberError;
    setHotel((membership as any)?.hotels ?? null);
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

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const client = requireSupabase();
      if (authMode === "signup") {
        const { data, error } = await client.auth.signUp({ email: email.trim(), password });
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

  const createHotel = async (event: FormEvent) => {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const client = requireSupabase();
      const user = (await client.auth.getUser()).data.user;
      if (!user) throw new Error("Please sign in again.");
      const { data: created, error: createError } = await client.from("hotels").insert({
        owner_user_id: user.id, name: hotelName.trim(), country: "Zambia", currency_code: "ZMW", timezone: "Africa/Lusaka",
      }).select("*").single();
      if (createError) throw createError;
      // A database trigger creates the owner's membership in the same transaction.
      setHotel(created); setNotice("Hotel workspace created.");
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
        const { error } = await client.from("guests").insert({ hotel_id: hotel.id, first_name: v.first_name.trim(), last_name: v.last_name.trim(), email: v.email || null, phone: v.phone || null, nationality: v.nationality || null });
        if (error) throw error;
        setNotice("Guest saved.");
      } else if (tab === "reservations") {
        const room = data.rooms.find((r) => r.id === v.room_id);
        if (!room) throw new Error("Choose a room.");
        const type = data.room_types.find((r) => r.id === room.room_type_id);
        const guest = data.guests.find((g) => g.id === v.guest_id);
        if (!guest) throw new Error("Choose a guest.");
        const reservationNo = `HT-${Date.now().toString().slice(-8)}`;
        const { data: created, error } = await client.from("reservations").insert({
          hotel_id: hotel.id, reservation_number: reservationNo, guest_id: guest.id, room_id: room.id,
          check_in_date: v.check_in_date, check_out_date: v.check_out_date, adults: Number(v.adults || 1),
          children: Number(v.children || 0), nightly_rate: Number(v.nightly_rate || type?.base_rate || 0),
          currency_code: hotel.currency_code || "ZMW", status: "confirmed", created_by: session.user.id,
        }).select("*").single();
        if (error) throw error;
        const { error: folioError } = await client.from("folios").insert({ hotel_id: hotel.id, reservation_id: created.id, folio_number: `F-${Date.now().toString().slice(-8)}` });
        if (folioError) throw new Error(`Reservation saved, but folio creation failed: ${folioError.message}`);
        setNotice(`Reservation ${reservationNo} confirmed.`);
      } else if (tab === "housekeeping") {
        const { error } = await client.from("housekeeping_tasks").insert({ hotel_id: hotel.id, room_id: v.room_id, task_type: v.task_type || "cleaning", priority: v.priority || "normal", notes: v.notes || null });
        if (error) throw error;
        await client.from("rooms").update({ status: "dirty" }).eq("id", v.room_id).eq("hotel_id", hotel.id);
        setNotice("Housekeeping task created.");
      } else if (tab === "folios" && v.kind === "charge") {
        const { error } = await client.from("folio_items").insert({ hotel_id: hotel.id, folio_id: v.folio_id, item_type: v.item_type || "other", description: v.description, quantity: Number(v.quantity || 1), unit_price: Number(v.unit_price || 0), amount: Number(v.quantity || 1) * Number(v.unit_price || 0), service_date: v.service_date || today(), posted_by: session.user.id });
        if (error) throw error;
        setNotice("Charge added to folio.");
      } else if (tab === "folios" && v.kind === "payment") {
        const folio = data.folios.find((f) => f.id === v.folio_id);
        if (!folio) throw new Error("Choose a folio.");
        const { error } = await client.from("payments").insert({ hotel_id: hotel.id, folio_id: folio.id, reservation_id: folio.reservation_id, payment_number: `RC-${Date.now().toString().slice(-8)}`, payment_type: "receipt", method: v.method || "cash", amount: Number(v.amount || 0), currency_code: hotel.currency_code || "ZMW", reference: v.reference || null, received_by: session.user.id });
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
        const receiptsForDay = data.payments.filter((p) => p.status === "posted" && p.received_at?.slice(0, 10) === businessDate);
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
      } else if (tab === "settings") {
        const { error } = await client.from("hotels").update({ name: (v.name ?? hotel.name).trim(), legal_name: v.legal_name ?? hotel.legal_name ?? null, email: v.email ?? hotel.email ?? null, phone: v.phone ?? hotel.phone ?? null, address: v.address ?? hotel.address ?? null, city: v.city ?? hotel.city ?? null, tax_registration_number: v.tax_registration_number ?? hotel.tax_registration_number ?? null, vat_enabled: (v.vat_enabled ?? String(hotel.vat_enabled)) === "true", vat_rate: Number(v.vat_rate ?? hotel.vat_rate ?? 0) }).eq("id", hotel.id);
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
      const now = new Date().toISOString();
      const status = action === "checkin" ? "checked_in" : action === "checkout" ? "checked_out" : "cancelled";
      const patch: Row = { status };
      if (action === "checkin") patch.checked_in_at = now;
      if (action === "checkout") patch.checked_out_at = now;
      if (action === "cancel") patch.cancelled_at = now;
      const { error } = await client.from("reservations").update(patch).eq("id", reservation.id).eq("hotel_id", hotel.id);
      if (error) throw error;
      const roomStatus = action === "checkin" ? "occupied" : action === "checkout" ? "dirty" : "available";
      const { error: roomError } = await client.from("rooms").update({ status: roomStatus }).eq("id", reservation.room_id).eq("hotel_id", hotel.id);
      if (roomError) throw roomError;
      if (action === "checkin") {
        const folio = data.folios.find((f) => f.reservation_id === reservation.id);
        if (folio) {
          const nights = Math.max(1, Math.round((new Date(reservation.check_out_date).getTime() - new Date(reservation.check_in_date).getTime()) / 86400000));
          const { error: chargeError } = await client.from("folio_items").insert({ hotel_id: hotel.id, folio_id: folio.id, item_type: "room_charge", description: `Room ${data.rooms.find((r) => r.id === reservation.room_id)?.room_number ?? ""} · ${nights} night(s)`, quantity: nights, unit_price: reservation.nightly_rate, amount: nights * Number(reservation.nightly_rate), service_date: reservation.check_in_date, posted_by: session.user.id });
          if (chargeError) throw chargeError;
        }
      }
      setNotice(`Reservation ${status.replace("_", " ")}.`);
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
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
    const paid = data.payments.filter((p) => p.status === "posted" && p.received_at?.slice(0, 10) === today()).reduce((s, p) => s + Number(p.amount || 0), 0);
    const outstanding = data.folios.filter((f) => f.status === "open").reduce((sum, f) => {
      const charges = data.folio_items.filter((i) => i.folio_id === f.id).reduce((s, i) => s + Number(i.amount || 0), 0);
      const payments = data.payments.filter((p) => p.folio_id === f.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0) * (p.payment_type === "refund" ? -1 : 1), 0);
      return sum + charges - payments;
    }, 0);
    return { rooms, occupied, arrivals, departures, revenue, paid, outstanding };
  }, [data]);

  if (!supabaseReady) return <main className="auth-wrap"><section className="auth-card"><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks Hotel</strong><small>Independent hotel management</small></div></div><h1>Connect your hotel workspace</h1><p>Copy <code>.env.example</code> to <code>.env.local</code> and set the Supabase publishable/anon key. Do not put a service-role key in this app.</p></section></main>;
  if (authLoading) return <main className="auth-wrap"><section className="auth-card">Loading secure workspace…</section></main>;
  if (!session) return <main className="auth-wrap"><form className="auth-card" onSubmit={submitAuth}><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks Hotel</strong><small>Independent hotel management</small></div></div><h1>{authMode === "signin" ? "Welcome back" : "Create your hotel account"}</h1><p>Manage rooms, reservations, guests and guest folios in one workspace.</p>{error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}<label>Email address<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label><label>Password<input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={authMode === "signin" ? "current-password" : "new-password"} /></label><button className="primary wide" disabled={busy}>{busy ? "Please wait…" : authMode === "signin" ? "Sign in" : "Create account"}</button><button type="button" className="link-button" onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setError(""); setNotice(""); }}>{authMode === "signin" ? "New to SifoBooks Hotel? Create an account" : "Already registered? Sign in"}</button></form></main>;
  if (!hotel) return <main className="auth-wrap"><form className="auth-card" onSubmit={createHotel}><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks Hotel</strong><small>First-time setup</small></div></div><h1>Set up your property</h1><p>This creates your own private hotel workspace, configured for Zambia.</p>{error && <div className="alert error">{error}</div>}<label>Hotel or lodge name<input required minLength={2} value={hotelName} onChange={(e) => setHotelName(e.target.value)} placeholder="e.g. Copperbelt Grand Hotel" /></label><button className="primary wide" disabled={busy}>{busy ? "Creating…" : "Create hotel workspace"}</button><button type="button" className="link-button" onClick={() => requireSupabase().auth.signOut()}>Sign out</button></form></main>;

  const roomName = (id: string) => data.rooms.find((r) => r.id === id)?.room_number ?? "Room";
  const guestName = (id: string) => { const g = data.guests.find((x) => x.id === id); return g ? `${g.first_name} ${g.last_name}` : "Guest"; };
  const folioBalance = (folio: Row) => data.folio_items.filter((i) => i.folio_id === folio.id).reduce((s, i) => s + Number(i.amount || 0), 0) - data.payments.filter((p) => p.folio_id === folio.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0) * (p.payment_type === "refund" ? -1 : 1), 0);
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
      content = <><div className="metrics"><Metric title="Sellable rooms" value={totals.rooms} icon={<BedDouble />} /><Metric title="Occupied" value={totals.occupied} icon={<DoorOpen />} /><Metric title="Arrivals today" value={totals.arrivals} icon={<CalendarDays />} /><Metric title="Departures today" value={totals.departures} icon={<LogOut />} /><Metric title="Revenue charged today" value={money(totals.revenue)} icon={<Wallet />} /><Metric title="Received today" value={money(totals.paid)} icon={<CreditCard />} /><Metric title="Open folio balance" value={money(totals.outstanding)} icon={<Users />} /></div><div className="panel"><div className="panel-head"><div><h2>Today's arrivals</h2><p>Confirmed reservations due to check in today.</p></div><button className="small" onClick={() => setTab("reservations")}>Open reservations</button></div>{table(["Reservation", "Guest", "Room", "Dates", "Status"], data.reservations.filter((r) => r.check_in_date === today()).map((r) => [r.reservation_number, guestName(r.guest_id), roomName(r.room_id), `${r.check_in_date} → ${r.check_out_date}`, badge(r.status)]))}</div></>;
      break;
    case "rooms":
      content = <><div className="panel"><h2>Add room type</h2>{submitForm(<><input type="hidden" value="room_type" onChange={() => {}} />{select("kind", "Record type", [{value:"room_type",label:"Room type"}])}{field("type_name", "Type name")}{field("type_code", "Code")}{field("max_occupancy", "Max occupancy", "number", true, {min:1, defaultValue:"2"})}{field("base_rate", "Nightly rate (ZMW)", "number", true, {min:0,step:"0.01"})}{field("description", "Description", "text", false)}{submitButton("Save room type")}</>)}</div><div className="panel"><h2>Add room</h2>{data.room_types.length === 0 ? <p className="muted">Create a room type first.</p> : submitForm(<>{select("kind", "Record type", [{value:"room",label:"Room"}])}{field("room_number", "Room number")}{select("room_type_id", "Room type", data.room_types.map((r) => ({value:r.id,label:`${r.name} · ${money(r.base_rate)}`})))}{field("floor_label", "Floor / wing", "text", false)}{submitButton("Save room")}</>)}</div><div className="panel"><h2>Room inventory</h2>{table(["Room", "Type", "Rate / night", "Status"], data.rooms.map((r) => [r.room_number, data.room_types.find((t) => t.id === r.room_type_id)?.name ?? "—", money(data.room_types.find((t) => t.id === r.room_type_id)?.base_rate), badge(r.status)]))}</div></>;
      break;
    case "guests":
      content = <><div className="panel"><h2>Add guest</h2>{submitForm(<>{field("first_name", "First name")}{field("last_name", "Last name")}{field("email", "Email", "email", false)}{field("phone", "Phone", "tel", false)}{field("nationality", "Nationality", "text", false)}{submitButton("Save guest")}</>)}</div><div className="panel"><h2>Guest directory</h2>{table(["Guest", "Email", "Phone", "Nationality"], data.guests.map((g) => [`${g.first_name} ${g.last_name}`, g.email ?? "—", g.phone ?? "—", g.nationality ?? "—"]))}</div></>;
      break;
    case "reservations":
      content = <><div className="panel"><h2>Create reservation</h2>{data.guests.length === 0 || data.rooms.length === 0 ? <p className="muted">Add at least one guest and one room before creating a reservation.</p> : submitForm(<>{select("guest_id", "Guest", data.guests.map((g) => ({value:g.id,label:`${g.first_name} ${g.last_name}`})))}{select("room_id", "Room", data.rooms.filter((r) => r.active && !["maintenance","out_of_service"].includes(r.status)).map((r) => ({value:r.id,label:`${r.room_number} · ${data.room_types.find((t) => t.id === r.room_type_id)?.name ?? "Room"}`})))}{field("check_in_date", "Check-in", "date", true, {min:today(),defaultValue:today()})}{field("check_out_date", "Check-out", "date", true, {min:today()})}{field("adults", "Adults", "number", true, {min:1,defaultValue:"1"})}{field("children", "Children", "number", true, {min:0,defaultValue:"0"})}{field("nightly_rate", "Nightly rate (ZMW)", "number", true, {min:0,step:"0.01"})}{submitButton("Confirm reservation")}</>)}</div><div className="panel"><h2>Reservation book</h2>{table(["Reference", "Guest", "Room", "Check-in", "Check-out", "Status", "Actions"], data.reservations.map((r) => [r.reservation_number, guestName(r.guest_id), roomName(r.room_id), r.check_in_date, r.check_out_date, badge(r.status), reservationActions(r)]))}</div></>;
      break;
    case "housekeeping":
      content = <><div className="panel"><h2>Create housekeeping task</h2>{data.rooms.length === 0 ? <p className="muted">Add rooms first.</p> : submitForm(<>{select("room_id", "Room", data.rooms.map((r) => ({value:r.id,label:r.room_number})))}{select("task_type", "Task", [{value:"cleaning",label:"Cleaning"},{value:"inspection",label:"Inspection"},{value:"linen",label:"Linen"},{value:"deep_clean",label:"Deep clean"}])}{select("priority", "Priority", [{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"},{value:"urgent",label:"Urgent"}])}{field("notes", "Notes", "text", false)}{submitButton("Create task")}</>)}</div><div className="panel"><h2>Housekeeping queue</h2>{table(["Room", "Task", "Priority", "Status", "Action"], data.housekeeping_tasks.map((t) => [roomName(t.room_id), t.task_type, badge(t.priority), badge(t.status), ["completed","verified","cancelled"].includes(t.status) ? "—" : <button className="small" onClick={() => completeTask(t)}>{t.status === "pending" ? "Start task" : "Complete task"}</button>]))}</div></>;
      break;
    case "folios":
      content = <><div className="panel"><h2>Add folio charge</h2>{data.folios.length === 0 ? <p className="muted">A folio is created automatically when you confirm a reservation.</p> : submitForm(<>{select("kind", "Action", [{value:"charge",label:"Add charge"}])}{select("folio_id", "Folio", data.folios.filter((f) => f.status === "open").map((f) => ({value:f.id,label:`${f.folio_number} · ${guestName(data.reservations.find((r) => r.id === f.reservation_id)?.guest_id ?? "")}`})))}{select("item_type", "Charge type", [{value:"room_charge",label:"Room charge"},{value:"food_beverage",label:"Food & beverage"},{value:"service",label:"Service"},{value:"tax",label:"Tax"},{value:"discount",label:"Discount"},{value:"other",label:"Other"}])}{field("description", "Description")}{field("quantity", "Quantity", "number", true, {min:0.001,step:"0.001",defaultValue:"1"})}{field("unit_price", "Unit price (ZMW)", "number", true, {step:"0.01"})}{field("service_date", "Service date", "date", true, {defaultValue:today()})}{submitButton("Add charge")}</>)}</div><div className="panel"><h2>Record payment</h2>{data.folios.length === 0 ? <p className="muted">Create a reservation first.</p> : submitForm(<>{select("kind", "Action", [{value:"payment",label:"Record payment"}])}{select("folio_id", "Folio", data.folios.filter((f) => f.status === "open").map((f) => ({value:f.id,label:f.folio_number})))}{select("method", "Method", [{value:"cash",label:"Cash"},{value:"card",label:"Card"},{value:"bank_transfer",label:"Bank transfer"},{value:"mobile_money",label:"Mobile money"},{value:"voucher",label:"Voucher"},{value:"other",label:"Other"}])}{field("amount", "Amount (ZMW)", "number", true, {min:0.01,step:"0.01"})}{field("reference", "Reference", "text", false)}{submitButton("Record receipt")}</>)}</div><div className="panel"><h2>Guest folios</h2>{table(["Folio", "Guest", "Reservation", "Charges", "Payments", "Balance", "Status"], data.folios.map((f) => [f.folio_number, guestName(data.reservations.find((r) => r.id === f.reservation_id)?.guest_id ?? ""), data.reservations.find((r) => r.id === f.reservation_id)?.reservation_number ?? "—", money(data.folio_items.filter((i) => i.folio_id === f.id).reduce((s, i) => s + Number(i.amount || 0), 0)), money(data.payments.filter((p) => p.folio_id === f.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0), 0)), money(folioBalance(f)), badge(f.status)]))}</div></>;
      break;
    case "maintenance":
      content = <><div className="panel"><h2>Report maintenance issue</h2>{submitForm(<>{field("title", "Issue title")}{select("room_id", "Room (optional)", data.rooms.map((r) => ({value:r.id,label:r.room_number})), false)}{select("priority", "Priority", [{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"},{value:"urgent",label:"Urgent"}])}{select("blocks_room_sale", "Block room sales?", [{value:"true",label:"Yes — mark room unavailable"},{value:"false",label:"No"}])}{field("description", "Details", "text", false)}{submitButton("Create maintenance ticket")}</>)}</div><div className="panel"><h2>Maintenance log</h2>{table(["Issue", "Room", "Priority", "Status", "Reported"], data.maintenance_requests.map((m) => [m.title, roomName(m.room_id), badge(m.priority), badge(m.status), new Date(m.created_at).toLocaleDateString()]))}</div></>;
      break;
    case "night_audit": {
      const auditedToday = data.night_audits.find((a) => a.business_date === today());
      content = <><div className="panel"><h2>Night audit · Daily close</h2><p className="muted">Reconcile today's room charges, other charges, receipts and physical cash before closing the business date. This does not post to an external accounting ledger.</p>{auditedToday ? <div className="alert success"><CheckCircle2 size={18} />Audit closed for {auditedToday.business_date}. Cash variance: {money(auditedToday.variance)}.</div> : submitForm(<>{field("business_date", "Business date", "date", true, {defaultValue:today(),max:today()})}{field("cash_counted", "Physical cash counted (ZMW)", "number", true, {min:0,step:"0.01",defaultValue:"0"})}{field("notes", "Closing notes", "text", false)}{submitButton("Reconcile and close day")}</>)}</div><div className="panel"><h2>Previous night audits</h2>{table(["Business date", "Room revenue", "Other revenue", "Payments", "Cash variance", "Status"], data.night_audits.map((a) => [a.business_date, money(a.room_revenue), money(a.other_revenue), money(a.payments_total), money(a.variance), badge(a.status)]))}</div></>;
      break;
    }
    case "settings":
      content = <div className="panel"><h2>Property settings</h2><p className="muted">Zambia defaults: ZMW, Africa/Lusaka, with VAT disabled until configured by the hotel.</p>{submitForm(<>{field("name", "Hotel name", "text", true, {defaultValue:hotel.name})}{field("legal_name", "Registered legal name", "text", false, {defaultValue:hotel.legal_name ?? ""})}{field("email", "Business email", "email", false, {defaultValue:hotel.email ?? ""})}{field("phone", "Phone", "tel", false, {defaultValue:hotel.phone ?? ""})}{field("address", "Address", "text", false, {defaultValue:hotel.address ?? ""})}{field("city", "City", "text", false, {defaultValue:hotel.city ?? ""})}{field("tax_registration_number", "Tax registration number", "text", false, {defaultValue:hotel.tax_registration_number ?? ""})}{select("vat_enabled", "VAT enabled?", [{value:"false",label:"No"},{value:"true",label:"Yes"}], true)}{field("vat_rate", "VAT rate (%)", "number", true, {min:0,max:100,step:"0.01",defaultValue:String(hotel.vat_rate ?? 0)})}{submitButton("Save settings")}</>)}</div>;
      break;
  }

  return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks</strong><small>Hotel Management</small></div></div><div className="property-label">PROPERTY</div><div className="property-name">{hotel.name}</div><nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? "nav-item active" : "nav-item"} onClick={() => { setTab(item.id); setForm({}); setError(""); setNotice(""); }}><item.icon size={18} />{item.label}</button>)}</nav><div className="sidebar-bottom"><span>{session.user.email}</span><button className="nav-item" onClick={() => requireSupabase().auth.signOut()}><LogOut size={18} />Sign out</button></div></aside><main className="main"><header className="topbar"><div><span className="eyebrow">SIFOBOOKS HOTEL PMS</span><h1>{tabs.find((t) => t.id === tab)?.label}</h1><p>{hotel.city ? `${hotel.city}, ${hotel.country}` : hotel.country} · {hotel.currency_code} · {new Date().toLocaleDateString()}</p></div><button className="secondary" onClick={() => refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />Refresh</button></header>{error && <div className="alert error">{error}<button onClick={() => setError("")}>×</button></div>}{notice && <div className="alert success">{notice}<button onClick={() => setNotice("")}>×</button></div>}{loading && <div className="loading-line">Syncing hotel records…</div>}{content}<footer>Private hotel workspace · Row-level security enabled · {hotel.timezone}</footer></main></div>;
}

function Metric({ title, value, icon }: { title: string; value: ReactNode; icon: ReactNode }) {
  return <div className="metric"><span className="metric-icon">{icon}</span><span className="metric-label">{title}</span><strong>{value}</strong></div>;
}
