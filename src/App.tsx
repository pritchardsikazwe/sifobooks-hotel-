import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { BedDouble, Building2, CalendarDays, CheckCircle2, ClipboardList, CreditCard, DoorOpen, FileBarChart, BookOpen, Hotel, LogOut, Moon, Plus, Printer, RefreshCw, UserCog, Users, Wallet, Wrench, Utensils, Wifi, Boxes, MessageCircle } from "lucide-react";
import { ZraPanel } from "./ZraPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { PosWorkspace } from "./PosWorkspace";
import { InventoryManagementPanel } from "./InventoryManagementPanel";
import { DailyOperationsPanel } from "./DailyOperationsPanel";
import { GuestPortalAdmin } from "./GuestPortalAdmin";
import { PrintingNetworkPanel } from "./PrintingNetworkPanel";
import { AccountingPanel } from "./AccountingPanel";
import { PropertyWorkspace } from "./PropertyWorkspace";
import { requireSupabase, supabase, supabaseReady } from "./lib/supabase";

type Row = Record<string, any>;
type Tab = "overview" | "rooms" | "guests" | "reservations" | "housekeeping" | "folios" | "maintenance" | "night_audit" | "reports" | "accounting" | "staff" | "settings" | "zra" | "documents" | "pos" | "printing_network" | "inventory" | "daily_ops" | "guest_portal" | "property_setup";
const tabs: { id: Tab; label: string; icon: typeof Hotel }[] = [
  { id: "overview", label: "Overview", icon: Hotel },
  { id: "rooms", label: "Rooms & units", icon: BedDouble },
  { id: "guests", label: "Guests", icon: Users },
  { id: "reservations", label: "Reservations", icon: CalendarDays },
  { id: "housekeeping", label: "Housekeeping", icon: ClipboardList },
  { id: "daily_ops", label: "Daily Operations", icon: CheckCircle2 },
  { id: "guest_portal", label: "Guest QR & Messages", icon: MessageCircle },
  { id: "folios", label: "Folios & payments", icon: Wallet },
  { id: "maintenance", label: "Maintenance", icon: Wrench },
  { id: "night_audit", label: "Night audit", icon: Moon },
  { id: "reports", label: "Reports", icon: FileBarChart },
  { id: "accounting", label: "Accounting & posting", icon: BookOpen },
  { id: "staff", label: "Staff & access", icon: UserCog },
  { id: "settings", label: "Property settings", icon: DoorOpen },
  { id: "property_setup", label: "Property setup", icon: Building2 },
  { id: "printing_network", label: "Printing & network", icon: Wifi },
  { id: "zra", label: "ZRA Smart Invoice", icon: Printer },
  { id: "documents", label: "Document designs", icon: FileBarChart },
  { id: "pos", label: "POS · Bar & Restaurant", icon: Utensils },
  { id: "inventory", label: "Inventory & Purchasing", icon: Boxes },
];
let activeTimeZone = "UTC";
const dateInPropertyTimeZone = (value: string | Date) => { const p = new Intl.DateTimeFormat("en-GB", { timeZone: activeTimeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value)); const v = Object.fromEntries(p.map((x) => [x.type, x.value])); return `${v.year}-${v.month}-${v.day}`; };
const today = () => dateInPropertyTimeZone(new Date());
const escapeHtml = (value: unknown) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
let activeCurrencyCode = "USD";
const money = (n: unknown, currencyCode = activeCurrencyCode) => { const currency = /^[A-Z]{3}$/.test(currencyCode) ? currencyCode : "USD"; try { return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(Number(n || 0)); } catch { return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(Number(n || 0)) + " " + currency; } };
const propertyUnitLabel = (hotel: Row | null) => {
  const settings = hotel?.settings && typeof hotel.settings === "object" ? hotel.settings : {};
  if (settings.unit_label) return String(settings.unit_label);
  const names: Record<string, string> = { hotel: "Rooms", lodge: "Rooms & chalets", serviced_apartment: "Apartments", resort: "Rooms & villas", guest_house: "Rooms", boutique_stay: "Rooms & suites" };
  return names[settings.property_type || "hotel"] || "Rooms";
};
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
  activeCurrencyCode = hotel?.currency_code || "USD";
  activeTimeZone = hotel?.timezone || "UTC";
  const [membershipRole, setMembershipRole] = useState("owner");
  const [hotelName, setHotelName] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
  const [selectedCalendarDate, setSelectedCalendarDate] = useState(() => today());
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const [guestView, setGuestView] = useState<"all" | "in_house" | "arrivals" | "departures" | "repeat">("all");
  const [guestSearch, setGuestSearch] = useState("");
  const [reportFrom, setReportFrom] = useState(() => `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,"0")}-01`);
  const [reportTo, setReportTo] = useState(() => today());

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
        if (!room.active || ["maintenance", "out_of_service"].includes(room.status)) throw new Error("This room is not available for new reservations.");
        if (v.nightly_rate !== "" && (!Number.isFinite(Number(v.nightly_rate)) || Number(v.nightly_rate) < 0)) throw new Error("Nightly rate must be a valid non-negative amount.");
        const type = data.room_types.find((r) => r.id === room.room_type_id);
        const guest = data.guests.find((g) => g.id === v.guest_id);
        if (!guest) throw new Error("Choose a guest.");
        if (!v.check_in_date || !v.check_out_date || v.check_out_date <= v.check_in_date) throw new Error("Check-out must be after check-in.");
        if (Number(v.adults || 1) < 1 || Number(v.children || 0) < 0) throw new Error("Enter a valid number of adults and children.");
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
        const receiptsForDay = data.payments.filter((p) => p.status === "posted" && dateInPropertyTimeZone(p.received_at) === businessDate);
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

  const updatePropertyRecord = async (tableName: string, record: Row, patch: Row, label: string) => {
    if (!hotel || !record?.id) return;
    setError(""); setNotice("");
    try { const { error } = await requireSupabase().from(tableName as any).update(patch).eq("id", record.id).eq("hotel_id", hotel.id); if (error) throw error; setNotice(`${label} updated.`); await refresh(); }
    catch (e) { setError(errorMessage(e)); }
  };

  const deletePropertyRecord = async (tableName: string, record: Row, label: string) => {
    if (!hotel || !record?.id) return;
    if (!window.confirm(`Delete this ${label}? This cannot be undone. Records linked to reservations, payments or audit history may be protected by the database.`)) return;
    setError(""); setNotice("");
    try {
      const { error } = await requireSupabase().from(tableName as any).delete().eq("id", record.id).eq("hotel_id", hotel.id);
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
    const paid = data.payments.filter((p) => p.status === "posted" && dateInPropertyTimeZone(p.received_at) === today()).reduce((s, p) => s + Number(p.amount || 0), 0);
    const outstanding = data.folios.filter((f) => f.status === "open").reduce((sum, f) => {
      const charges = data.folio_items.filter((i) => i.folio_id === f.id).reduce((s, i) => s + (i.item_type === "discount" ? -Math.abs(Number(i.amount || 0)) : Number(i.amount || 0)), 0);
      const payments = data.payments.filter((p) => p.folio_id === f.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0) * (p.payment_type === "refund" ? -1 : 1), 0);
      return sum + charges - payments;
    }, 0);
    return { rooms, occupied, arrivals, departures, revenue, paid, outstanding };
  }, [data]);

  if (!supabaseReady) return <main className="auth-wrap"><section className="auth-card"><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks Hotel</strong><small>Independent hotel management</small></div></div><h1>Connect your hotel workspace</h1><p>Copy <code>.env.example</code> to <code>.env.local</code> and set the Supabase publishable/anon key. Do not put a service-role key in this app.</p></section></main>;
  if (authLoading) return <main className="auth-wrap"><section className="auth-card">Loading secure workspace…</section></main>;
  if (!session) return <main className="hotel-landing">
    <style>{`
      @keyframes orbitSpin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      @keyframes orbitSpinReverse{from{transform:rotate(360deg)}to{transform:rotate(0deg)}}
      @keyframes featurePulse{0%,100%{box-shadow:0 0 0 0 #e9b84b20,0 0 18px #4da7ff20}50%{box-shadow:0 0 0 8px #e9b84b00,0 0 30px #4da7ff40}}
      @keyframes landingReveal{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      .hotel-landing{min-height:100vh;overflow:hidden;color:#f7f9fc;background:radial-gradient(ellipse at 65% 35%,#163b57 0%,#071a2d 42%,#04101e 100%);font-family:Inter,ui-sans-serif,system-ui,sans-serif;position:relative}
      .hotel-landing *{box-sizing:border-box}.hl-nav{height:78px;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 clamp(18px,4vw,58px);border-bottom:1px solid #ffffff12;position:relative;z-index:5}
      .hl-brand{display:flex;align-items:center;gap:11px;min-width:max-content}.hl-mark{width:43px;height:43px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,#f4ca70,#d99d2f);color:#08243b}.hl-brand strong{display:block;font-size:18px;letter-spacing:-.4px}.hl-brand small{display:block;color:#a9bbcd;font-size:9px;letter-spacing:1.6px;text-transform:uppercase;margin-top:3px}
      .hl-links{display:flex;align-items:center;gap:clamp(12px,2.2vw,32px);color:#dce5ef;font-size:13px;font-weight:650}.hl-links span:first-child{color:#f3bd4d}.hl-country{border:1px solid #ffffff24;border-radius:20px;padding:9px 12px;font-size:12px;color:#e9eff6;white-space:nowrap}
      .hl-main{display:grid;grid-template-columns:minmax(270px,.92fr) minmax(330px,1.2fr) minmax(280px,.86fr);gap:clamp(16px,2vw,32px);align-items:center;max-width:1600px;margin:auto;padding:clamp(28px,4vh,48px) clamp(18px,3.4vw,52px) 34px;min-height:590px}
      .hl-copy{animation:landingReveal .7s ease-out}.hl-pill{display:inline-flex;border:1px solid #dca83f;border-radius:22px;padding:8px 13px;color:#f4c55e;font-size:11px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}.hl-copy h1{font-size:clamp(34px,3.4vw,58px);line-height:1.06;letter-spacing:-1.8px;margin:20px 0 17px}.hl-copy h1 em{font-style:normal;color:#efb846}.hl-copy p{color:#c5d3e1;font-size:clamp(14px,1.2vw,17px);line-height:1.65;max-width:460px}.hl-benefits{display:grid;gap:11px;margin:22px 0 25px;color:#dce6ef;font-size:13px}.hl-benefits span{display:flex;align-items:center;gap:10px}.hl-tick{color:#efb846;font-size:17px}.hl-actions{display:flex;gap:12px;flex-wrap:wrap}.hl-btn{border:0;border-radius:11px;padding:14px 18px;font-weight:800;cursor:pointer;transition:transform .2s,filter .2s}.hl-btn:hover{transform:translateY(-2px);filter:brightness(1.06)}.hl-btn.gold{background:linear-gradient(100deg,#dfa83d,#f4ca6a);color:#13283b}.hl-btn.ghost{background:#071b2d99;color:#fff;border:1px solid #66839c}
      .hl-orbit-area{position:relative;min-height:490px;display:grid;place-items:center;isolation:isolate}.hl-hotel-photo{position:absolute;inset:18% 12%;border-radius:50%;background:radial-gradient(ellipse at 50% 45%,#f0bb5d30,#0a2036 57%,transparent 72%);filter:blur(2px);z-index:-1}.hl-core{width:210px;height:210px;border-radius:50%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border:1px solid #e9b84b90;background:radial-gradient(circle at 50% 35%,#174461,#07182b 70%);box-shadow:0 0 0 12px #e9b84b0c,0 0 65px #e9b84b25;z-index:2}.hl-core-icon{width:62px;height:62px;border-radius:18px;display:grid;place-items:center;background:linear-gradient(145deg,#f5ce77,#d89c2f);color:#08243b;margin-bottom:11px}.hl-core strong{font-size:20px;letter-spacing:-.5px}.hl-core small{color:#b7c7d6;margin-top:5px;font-size:11px}.hl-ring{position:absolute;width:min(100%,440px);aspect-ratio:1;border:1px solid #57baff7a;border-radius:50%;animation:orbitSpin 34s linear infinite;box-shadow:0 0 35px #1785df13,inset 0 0 30px #1785df0b}.hl-ring:before{content:"";position:absolute;inset:12px;border:1px dashed #e7b64a85;border-radius:50%}.hl-ring.reverse{width:min(82%,360px);border-color:#e9b84b75;animation:orbitSpinReverse 27s linear infinite}.hl-feature{position:absolute;width:112px;min-height:104px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:5px;color:#f7f9fc;animation:orbitSpinReverse 34s linear infinite}.hl-feature .ico{width:58px;height:58px;display:grid;place-items:center;border:2px solid #55baff;border-radius:50%;background:#071c30;box-shadow:0 0 20px #2c9fff42;animation:featurePulse 3.4s ease-in-out infinite}.hl-feature.gold .ico{border-color:#eab64b;box-shadow:0 0 22px #eab64b38}.hl-feature b{font-size:11px;line-height:1.2}.hl-feature small{font-size:9px;line-height:1.25;color:#b7c8d9;max-width:105px}.hl-feature.f1{top:-35px;left:calc(50% - 56px)}.hl-feature.f2{top:calc(20% - 52px);right:-43px}.hl-feature.f3{bottom:calc(20% - 52px);right:-43px}.hl-feature.f4{bottom:-35px;left:calc(50% - 56px)}.hl-feature.f5{bottom:calc(20% - 52px);left:-43px}.hl-feature.f6{top:calc(20% - 52px);left:-43px}.hl-ring.reverse .hl-feature{animation:orbitSpin 27s linear infinite}.hl-ring.reverse .f1{top:-37px}.hl-ring.reverse .f4{bottom:-37px}.hl-orbit-caption{position:absolute;bottom:0;left:50%;transform:translateX(-50%);color:#9eb5ca;font-size:10px;letter-spacing:1.1px;text-transform:uppercase;white-space:nowrap}
      .hl-auth{background:linear-gradient(145deg,#10263dF2,#07182bf5);border:1px solid #7896b55c;border-radius:20px;padding:25px;box-shadow:0 24px 70px #0005;animation:landingReveal .8s ease-out;backdrop-filter:blur(18px)}.hl-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:4px;border:1px solid #ffffff12;border-radius:12px;background:#061523;margin-bottom:24px}.hl-tabs button{border:0;border-radius:9px;padding:12px 8px;background:transparent;color:#d8e3ef;font-weight:750;cursor:pointer}.hl-tabs button.active{background:linear-gradient(100deg,#dca43b,#f2c968);color:#142a3c}.hl-auth h2{text-align:center;font-size:23px;margin:0 0 7px}.hl-auth>p{text-align:center;color:#afc1d2;font-size:12px;margin:0 0 22px}.hl-label{display:block;font-size:11px;color:#dbe5ef;font-weight:650;margin:13px 0}.hl-input{display:block;width:100%;margin-top:7px;padding:13px 12px;border-radius:9px;border:1px solid #4b657e;background:#081b2d;color:#fff;outline:none;font:inherit;font-size:13px}.hl-input:focus{border-color:#e7b64a;box-shadow:0 0 0 3px #e7b64a18}.hl-submit{width:100%;margin-top:10px}.hl-forgot{display:block;margin:14px auto 0;background:none;border:0;color:#efbf54;font-size:11px;cursor:pointer}.hl-or{display:flex;align-items:center;gap:10px;color:#9eb2c5;font-size:10px;margin:20px 0}.hl-or:before,.hl-or:after{content:"";height:1px;background:#31485e;flex:1}.hl-auth-foot{text-align:center;color:#adbdcd;font-size:11px;margin-top:19px}.hl-auth-foot button{background:none;border:0;color:#f2c45b;text-decoration:underline;font-weight:750;cursor:pointer}
      .hl-feature-strip{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:11px;padding:0 clamp(18px,3.4vw,52px) 22px;max-width:1600px;margin:auto}.hl-card{background:linear-gradient(145deg,#0b2942,#061a2c);border:1px solid #31536f;border-radius:13px;padding:14px;min-height:116px;animation:landingReveal .7s ease-out;transition:transform .2s,border-color .2s}.hl-card:hover{transform:translateY(-4px);border-color:#e5b34c}.hl-card .ci{color:#edb647;margin-bottom:8px}.hl-card b{display:block;font-size:12px;margin-bottom:6px}.hl-card small{display:block;color:#afc2d5;font-size:10px;line-height:1.45}.hl-stats{display:flex;justify-content:space-around;gap:15px;max-width:1450px;margin:auto;padding:20px clamp(18px,4vw,58px) 27px;border-top:1px solid #ffffff12;color:#b8c8d8;font-size:11px}.hl-stat{display:flex;align-items:center;gap:10px}.hl-stat svg{color:#efb846}.hl-stat b{display:block;color:#fff;font-size:13px;margin-bottom:3px}
      @media(max-width:1150px){.hl-main{grid-template-columns:minmax(240px,.9fr) minmax(300px,1fr);}.hl-auth{grid-column:1/-1;max-width:520px;width:100%;justify-self:center;display:grid;grid-template-columns:1fr 1fr;column-gap:22px}.hl-auth .hl-tabs,.hl-auth h2,.hl-auth>p,.hl-auth .hl-or,.hl-auth-foot,.hl-auth .alert{grid-column:1/-1}.hl-feature-strip{grid-template-columns:repeat(3,minmax(0,1fr))}.hl-orbit-area{min-height:430px}.hl-links{display:none}}
      @media(max-width:680px){.hl-nav{height:68px}.hl-country{display:none}.hl-main{display:flex;flex-direction:column;align-items:stretch;padding-top:28px}.hl-copy h1{font-size:39px}.hl-copy p{font-size:14px}.hl-orbit-area{width:100%;min-height:360px;transform:scale(.92);margin:-4px 0}.hl-ring{width:310px}.hl-ring.reverse{width:252px}.hl-core{width:150px;height:150px}.hl-core-icon{width:46px;height:46px;margin-bottom:7px}.hl-core strong{font-size:16px}.hl-feature{width:88px}.hl-feature .ico{width:46px;height:46px}.hl-feature b{font-size:9px}.hl-feature small{display:none}.hl-feature.f2,.hl-feature.f3{right:-20px}.hl-feature.f5,.hl-feature.f6{left:-20px}.hl-feature.f1{top:-22px}.hl-feature.f4{bottom:-22px}.hl-orbit-caption{bottom:-9px;font-size:8px}.hl-auth{display:block;padding:21px}.hl-feature-strip{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.hl-card{padding:12px;min-height:105px}.hl-stats{display:grid;grid-template-columns:1fr 1fr}.hl-stat:last-child{display:none}}
      @media(prefers-reduced-motion:reduce){.hl-ring,.hl-feature,.hl-ring.reverse .hl-feature,.hl-card,.hl-copy,.hl-auth{animation:none!important;transition:none!important}}
    `}</style>
    <header className="hl-nav"><div className="hl-brand"><span className="hl-mark"><Hotel size={25}/></span><div><strong>SifoBooks Hotel</strong><small>Hotel Management System</small></div></div><nav className="hl-links"><span>Home</span><span>Features</span><span>Pricing</span><span>Solutions⌄</span><span>About Us</span><span>Contact</span></nav><div className="hl-country">🌐 &nbsp; Global Hospitality</div></header>
    <section className="hl-main">
      <div className="hl-copy"><span className="hl-pill">Global hospitality management</span><h1>Manage Your Hotel, Lodge or Apartment Smarter with <em>SifoBooks</em></h1><p>One modern platform for hotels, lodges, serviced apartments, resorts, guest houses and boutique stays around the world. Manage rooms, reservations, guest services, restaurant POS, inventory and accounting in one place.</p><div className="hl-benefits"><span><b className="hl-tick">●</b> Increase efficiency and revenue</span><span><b className="hl-tick">●</b> Improve guest experience</span><span><b className="hl-tick">●</b> Configure local taxes and business requirements</span><span><b className="hl-tick">●</b> Real-time operational insights</span></div><div className="hl-actions"><button className="hl-btn gold" onClick={() => {setAuthMode("signup");setError("");setNotice("");document.getElementById("hl-auth-email")?.focus();}}>Get Started Free&nbsp; →</button><button className="hl-btn ghost" onClick={() => document.getElementById("hl-features")?.scrollIntoView({behavior:"smooth"})}>Explore Features ↓</button></div></div>
      <div className="hl-orbit-area" aria-label="SifoBooks hotel modules orbiting in a circle"><div className="hl-hotel-photo"/><div className="hl-ring">
        <div className="hl-feature f1 gold"><span className="ico"><BedDouble size={25}/></span><b>Room Management</b><small>Reservations &amp; rates</small></div>
        <div className="hl-feature f2"><span className="ico"><Utensils size={24}/></span><b>Restaurant &amp; Bar POS</b><small>Orders &amp; tables</small></div>
        <div className="hl-feature f3 gold"><span className="ico"><BookOpen size={24}/></span><b>Accounting</b><small>Ledgers &amp; reports</small></div>
        <div className="hl-feature f4"><span className="ico"><Boxes size={24}/></span><b>Inventory</b><small>Purchasing &amp; stock</small></div>
        <div className="hl-feature f5 gold"><span className="ico"><Users size={24}/></span><b>Payroll &amp; Local Compliance</b><small>Country-specific settings</small></div>
        <div className="hl-feature f6"><span className="ico"><Printer size={24}/></span><b>Tax &amp; Invoicing</b><small>Local integrations where available</small></div>
      </div><div className="hl-ring reverse"><div className="hl-feature f1"><span className="ico"><DoorOpen size={22}/></span><b>Housekeeping</b></div><div className="hl-feature f4 gold"><span className="ico"><FileBarChart size={22}/></span><b>Reports &amp; Analytics</b></div></div><div className="hl-core"><span className="hl-core-icon"><Hotel size={31}/></span><strong>SifoBooks</strong><small>One system. Your whole property.</small></div><div className="hl-orbit-caption">Hotels • Lodges • Apartments • Resorts • Worldwide</div></div>
      <form id="hl-auth" className="hl-auth" onSubmit={submitAuth}><div className="hl-tabs"><button type="button" className={authMode==="signin"?"active":""} onClick={()=>{setAuthMode("signin");setError("");setNotice("");}}>Sign In</button><button type="button" className={authMode==="signup"?"active":""} onClick={()=>{setAuthMode("signup");setError("");setNotice("");}}>Sign Up</button></div><h2>{authMode==="signin"?"Welcome Back":"Create Your Account"}</h2><p>{authMode==="signin"?"Sign in to access your hotel workspace":"Start managing your hotel with SifoBooks"}</p>{error&&<div className="alert error">{error}</div>}{notice&&<div className="alert success">{notice}</div>}<label className="hl-label">Email address<input id="hl-auth-email" className="hl-input" type="email" required value={email} onChange={e=>setEmail(e.target.value)} autoComplete="email" placeholder="you@hotel.com"/></label><label className="hl-label">Password<input className="hl-input" type="password" minLength={8} required value={password} onChange={e=>setPassword(e.target.value)} autoComplete={authMode==="signin"?"current-password":"new-password"} placeholder="At least 8 characters"/></label><button className="hl-btn gold hl-submit" disabled={busy}>{busy?"Please wait…":authMode==="signin"?"Sign In →":"Create Account →"}</button><div className="hl-or">SECURE HOSPITALITY WORKSPACE</div><div className="hl-auth-foot">{authMode==="signin"?"New to SifoBooks Hotel?":"Already have an account?"} <button type="button" onClick={()=>{setAuthMode(authMode==="signin"?"signup":"signin");setError("");setNotice("");}}>{authMode==="signin"?"Create an account":"Sign in"}</button></div>{authMode==="signin"&&<button type="button" className="hl-forgot" onClick={resetPassword} disabled={busy}>Forgot password?</button>}</form>
    </section>
    <section className="hl-feature-strip" id="hl-features"><article className="hl-card"><div className="ci"><BedDouble size={25}/></div><b>Room Management</b><small>Reservations, check-in/out, rates and housekeeping</small></article><article className="hl-card"><div className="ci"><Utensils size={25}/></div><b>Restaurant &amp; Bar</b><small>POS, menu, tables and kitchen orders</small></article><article className="hl-card"><div className="ci"><Printer size={25}/></div><b>Tax &amp; Invoicing</b><small>Configurable taxes and local integrations where available</small></article><article className="hl-card"><div className="ci"><Users size={25}/></div><b>Teams &amp; Permissions</b><small>Manage staff access across your property</small></article><article className="hl-card"><div className="ci"><BookOpen size={25}/></div><b>Accounting</b><small>General ledger, reports and financial records</small></article><article className="hl-card"><div className="ci"><Boxes size={25}/></div><b>Inventory</b><small>Suppliers, purchase orders and stock control</small></article></section>
    <section className="property-showcase" id="property-types">
      <div className="property-heading"><span className="hl-pill">ONE PLATFORM · EVERY STAY</span><h2>Made for every kind of property</h2><p>Choose the hospitality experience you run. SifoBooks brings your daily operations into one clear workspace, with tools you can configure for your property.</p></div>
      <div className="property-grid">
        <article className="property-card property-hotel"><div className="property-art"><div className="art-window"></div><span className="art-badge">FRONT DESK</span><div className="art-stat"><small>Today's arrivals</small><strong>12 <i>↗</i></strong></div></div><div className="property-card-body"><span className="property-number">01 / FULL SERVICE</span><h3>Hotels</h3><p>Coordinate front desk, room inventory, reservations, guest folios and daily financial close.</p><div className="property-tags"><span>Reservations</span><span>Room status</span><span>Night audit</span></div></div></article>
        <article className="property-card property-lodge"><div className="property-art"><div className="art-window"></div><span className="art-badge">LODGE OPERATIONS</span><div className="art-stat"><small>Rooms ready</small><strong>08 <i>✓</i></strong></div></div><div className="property-card-body"><span className="property-number">02 / NATURE & RETREATS</span><h3>Lodges</h3><p>Manage room or chalet availability, housekeeping, guest requests, activities and restaurant services.</p><div className="property-tags"><span>Chalets & rooms</span><span>Guest requests</span><span>Activities</span></div></div></article>
        <article className="property-card property-apartment"><div className="property-art"><div className="art-window"></div><span className="art-badge">RESIDENCE</span><div className="art-stat"><small>Active stays</small><strong>24 <i>↗</i></strong></div></div><div className="property-card-body"><span className="property-number">03 / EXTENDED STAYS</span><h3>Serviced apartments</h3><p>Track apartment availability, longer stays, recurring charges, deposits, cleaning and maintenance.</p><div className="property-tags"><span>Long stays</span><span>Recurring billing*</span><span>Maintenance</span></div></div></article>
        <article className="property-card property-resort"><div className="property-art"><div className="art-window"></div><span className="art-badge">RESORT DESK</span><div className="art-stat"><small>Guest services</small><strong>18 <i>✦</i></strong></div></div><div className="property-card-body"><span className="property-number">04 / DESTINATION STAYS</span><h3>Resorts</h3><p>Bring accommodation, dining, stock, guest charges and service requests together across resort operations.</p><div className="property-tags"><span>Rooms & dining</span><span>POS</span><span>Guest services</span></div></div></article>
        <article className="property-card property-guesthouse"><div className="property-art"><div className="art-window"></div><span className="art-badge">GUEST HOUSE</span><div className="art-stat"><small>Today's check-ins</small><strong>05 <i>✓</i></strong></div></div><div className="property-card-body"><span className="property-number">05 / WARM & PERSONAL</span><h3>Guest houses</h3><p>Keep bookings, guest details, room cleaning, payments and daily expenses simple for a small team.</p><div className="property-tags"><span>Easy check-in</span><span>Housekeeping</span><span>Daily expenses</span></div></div></article>
        <article className="property-card property-boutique"><div className="property-art"><div className="art-window"></div><span className="art-badge">BOUTIQUE STAY</span><div className="art-stat"><small>Guest satisfaction</small><strong>4.9 <i>★</i></strong></div></div><div className="property-card-body"><span className="property-number">06 / DESIGN-LED STAYS</span><h3>Boutique stays</h3><p>Deliver a personal guest experience with tailored room types, direct enquiries, QR requests and clear reporting.</p><div className="property-tags"><span>Guest messaging</span><span>QR portal</span><span>Insights</span></div></div></article>
      </div>
      <div className="property-note">*Recurring billing and some property-specific workflows are product roadmap/mockup items until enabled and validated for your account.</div>
    </section>
    <section className="hospitality-preview" id="hospitality-preview"><div className="preview-copy"><span className="hl-pill">A clearer day, from one screen</span><h2>Your property's operations at a glance.</h2><p>A clean workspace concept for owners and teams: see arrivals, room readiness, guest requests and revenue activity without jumping between spreadsheets.</p><div className="preview-checks"><span>✓ Front desk & reservations</span><span>✓ Housekeeping & maintenance</span><span>✓ Payments, POS & accounting</span><span>✓ Staff roles and activity tracking</span></div><button className="hl-btn gold" onClick={()=>{setAuthMode("signup");setError("");setNotice("");document.getElementById("hl-auth-email")?.focus();}}>Create your workspace →</button></div><div className="preview-dashboard"><div className="preview-top"><div><small>SIFOBOOKS · PROPERTY OVERVIEW</small><strong>Good morning, manager</strong></div><span className="preview-live"><i/> LIVE VIEW MOCKUP</span></div><div className="preview-metrics"><div><small>Occupancy</small><strong>78%</strong><span>↗ Today's snapshot</span></div><div><small>Arrivals</small><strong>12</strong><span>Expected today</span></div><div><small>Room service</small><strong>04</strong><span>Requests open</span></div></div><div className="preview-list"><div className="preview-list-head"><strong>Room readiness</strong><span>Sample data</span></div><div><span><b className="preview-dot ready"/>Room 104 · Deluxe</span><em>Ready</em></div><div><span><b className="preview-dot clean"/>Room 208 · Suite</span><em>Cleaning</em></div><div><span><b className="preview-dot service"/>Apartment 12 · 2 bed</span><em>Guest request</em></div></div><div className="preview-bars"><span style={{height:"36%"}}/><span style={{height:"57%"}}/><span style={{height:"46%"}}/><span style={{height:"77%"}}/><span style={{height:"64%"}}/><span style={{height:"92%"}}/><span style={{height:"73%"}}/><div><small>MON</small><small>TUE</small><small>WED</small><small>THU</small><small>FRI</small><small>SAT</small><small>SUN</small></div></div></div></section>
    <footer className="hl-stats"><div className="hl-stat"><Hotel size={24}/><span><b>One platform</b>For hotel operations</span></div><div className="hl-stat"><Users size={24}/><span><b>Connected teams</b>From front desk to finance</span></div><div className="hl-stat"><FileBarChart size={24}/><span><b>Live visibility</b>Reports and insights</span></div><div className="hl-stat"><CheckCircle2 size={24}/><span><b>Global flexibility</b>Adapt settings to your country</span></div></footer>
  </main>;
  if (!hotel) return <main className="auth-wrap onboarding-shell"><style>{`
@keyframes roboFloat{0%,100%{transform:translateY(0) rotate(-2deg)}50%{transform:translateY(-10px) rotate(2deg)}}
@keyframes roboPulse{0%,100%{box-shadow:0 0 0 0 rgba(226,171,61,.32)}50%{box-shadow:0 0 0 13px rgba(226,171,61,0)}}
@keyframes scan{0%{transform:translateY(-45px);opacity:0}30%{opacity:.8}100%{transform:translateY(45px);opacity:0}}
@keyframes reveal{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
.onboarding-shell{min-height:100vh;background:radial-gradient(ellipse at 15% 15%,#163e5b 0%,#071a2c 46%,#061321 100%);display:flex;align-items:center;justify-content:center;padding:24px;overflow:hidden;position:relative}
.onboarding-shell:before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.035) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.035) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(to bottom,black,transparent)}
.onboard-card{width:min(100%,980px);display:grid;grid-template-columns:.85fr 1.15fr;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 30px 100px #0007;position:relative;z-index:1;animation:reveal .55s ease-out}
.onboard-hero{background:linear-gradient(150deg,#092b46,#071827);color:#fff;padding:36px;display:flex;flex-direction:column;justify-content:space-between;min-height:570px;position:relative;overflow:hidden}
.onboard-hero:after{content:"";position:absolute;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,#e5b24c,transparent);animation:scan 4s ease-in-out infinite;top:35%}
.robot{width:142px;height:142px;margin:28px auto 20px;border:1px solid #d9a83e66;border-radius:36px;background:radial-gradient(circle at 50% 30%,#24516b,#0b263d 70%);display:grid;place-items:center;position:relative;animation:roboFloat 4s ease-in-out infinite;box-shadow:0 0 45px #dca83b22}
.robot-face{width:86px;height:68px;border:3px solid #e8b64f;border-radius:24px;background:#102e43;display:flex;align-items:center;justify-content:center;gap:16px;position:relative;box-shadow:inset 0 0 20px #e7b34a1c,0 0 20px #e7b34a22}
.robot-eye{width:12px;height:18px;background:#62e8ff;border-radius:8px;box-shadow:0 0 12px #62e8ff;animation:roboPulse 2.4s infinite}
.robot-mouth{position:absolute;width:26px;height:3px;border-radius:5px;background:#e8b64f;bottom:12px}
.robot-antenna{position:absolute;top:-20px;left:50%;height:18px;width:3px;background:#e8b64f}.robot-antenna:after{content:"";position:absolute;top:-6px;left:-5px;width:10px;height:10px;border-radius:50%;background:#62e8ff;box-shadow:0 0 14px #62e8ff}
.onboard-main{padding:38px;animation:reveal .7s ease-out}.onboard-brand{display:flex;align-items:center;gap:10px;color:#092b46;font-weight:800}.onboard-brand-mark{width:38px;height:38px;border-radius:12px;background:#092b46;color:#edbb51;display:grid;place-items:center;font-size:21px}
.onboard-steps{display:flex;gap:7px;margin:26px 0 30px}.onboard-step{height:5px;flex:1;border-radius:8px;background:#e7ebf0;transition:background .3s}.onboard-step.active{background:linear-gradient(90deg,#dba536,#f2d17a)}
.onboard-field{display:block;font-size:13px;font-weight:700;color:#25384a;margin:18px 0}.onboard-field input,.onboard-field select{display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:13px 14px;border:1px solid #dbe2e9;border-radius:11px;font:inherit;background:#fbfcfe;color:#10283d;outline:none;transition:border .2s,box-shadow .2s}.onboard-field input:focus,.onboard-field select:focus{border-color:#d7a23b;box-shadow:0 0 0 3px #e6b54a26}
.onboard-primary{border:0;border-radius:11px;background:linear-gradient(100deg,#dca638,#f1c96d);color:#152a3b;font-weight:800;padding:14px 18px;cursor:pointer;transition:transform .2s,filter .2s}.onboard-primary:hover{transform:translateY(-2px);filter:brightness(1.04)}.onboard-primary:disabled{opacity:.65;cursor:wait}
.onboard-secondary{border:1px solid #dce3ea;border-radius:11px;background:#fff;color:#193249;padding:13px 16px;cursor:pointer;font-weight:700}
.onboard-checklist{display:grid;gap:12px;margin:20px 0}.onboard-check{display:flex;gap:12px;align-items:center;border:1px solid #e8edf1;padding:13px;border-radius:12px;background:#fbfcfe}.onboard-check b{display:block;font-size:13px;color:#173047}.onboard-check small{color:#718092}.onboard-check-icon{width:36px;height:36px;border-radius:10px;background:#fff3d6;color:#a87413;display:grid;place-items:center;font-weight:900}
@media(max-width:720px){.onboard-card{grid-template-columns:1fr}.onboard-hero{min-height:230px;padding:24px}.robot{width:88px;height:88px;margin:15px auto}.robot-face{transform:scale(.7)}.onboard-main{padding:24px}.onboard-hero h2{font-size:22px}.onboard-hero .hero-detail{display:none}}
@media(prefers-reduced-motion:reduce){.robot,.onboard-card,.onboard-main,.onboard-hero:after,.robot-eye{animation:none!important;transition:none!important}}
`}</style><section className="onboard-card"><aside className="onboard-hero"><div><div style={{fontSize:12,letterSpacing:2,color:"#edbb51",fontWeight:800}}>SIFONET TECHNOLOGIES</div><div className="robot" aria-label="Animated SifoBooks robot assistant"><div className="robot-face"><span className="robot-antenna"/><span className="robot-eye"/><span className="robot-eye"/><span className="robot-mouth"/></div></div><h2 style={{fontSize:28,lineHeight:1.15,margin:"10px 0"}}>Meet SifoBot<span style={{color:"#edbb51"}}>.</span></h2><p style={{color:"#c1d0dc",lineHeight:1.7}}>Your smart setup assistant. Let’s get your property ready for smoother hotel operations.</p></div><div className="hero-detail" style={{borderTop:"1px solid #ffffff20",paddingTop:18,color:"#9eb2c2",fontSize:12}}>SECURE WORKSPACE · GLOBAL HOSPITALITY · BUILT FOR YOUR PROPERTY</div></aside><form className="onboard-main" onSubmit={createHotel}><div className="onboard-brand"><span className="onboard-brand-mark">⌂</span><span>SifoBooks Hotel</span><span style={{marginLeft:"auto",fontSize:11,color:"#728093",fontWeight:600}}>SETUP WIZARD</span></div><div className="onboard-steps"><span className="onboard-step active"/><span className="onboard-step active"/><span className="onboard-step active"/></div><div style={{fontSize:12,color:"#b07b18",fontWeight:800,letterSpacing:1}}>STEP 1 OF 3 · COMPANY PROFILE</div><h1 style={{fontSize:30,color:"#102b43",margin:"10px 0"}}>Let’s build your workspace</h1><p style={{color:"#6b7b8a",lineHeight:1.6}}>Start with your official hotel or lodge name. SifoBot will guide you through the operational setup after your secure workspace is created.</p>{error && <div className="alert error">{error}</div>}{notice && <div className="alert success">{notice}</div>}<label className="onboard-field">Hotel, lodge or property name<input required minLength={2} maxLength={120} value={hotelName} onChange={(e) => setHotelName(e.target.value)} placeholder="e.g. Copperbelt Grand Hotel" autoFocus/></label><div className="onboard-checklist"><div className="onboard-check"><span className="onboard-check-icon">✓</span><div><b>Private company workspace</b><small>Linked to your signed-in account</small></div></div><div className="onboard-check"><span className="onboard-check-icon">✦</span><div><b>Hotel operations ready</b><small>Rooms, guests, reservations and folios</small></div></div><div className="onboard-check"><span className="onboard-check-icon">⚙</span><div><b>Configure as you go</b><small>Continue with room setup and staff access after creation</small></div></div></div><button className="onboard-primary" style={{width:"100%"}} disabled={busy}>{busy ? "SifoBot is creating your workspace…" : "Create workspace & continue  →"}</button><p style={{textAlign:"center",fontSize:12,color:"#8491a0",marginTop:18}}>Already have an account? Your existing workspace and records remain unchanged.</p><button type="button" className="link-button" onClick={() => requireSupabase().auth.signOut()}>Sign out</button></form></section></main>;

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
    case "property_setup": {
      content = <PropertyWorkspace hotel={hotel} onSaved={(row) => { setHotel(row); setNotice("Property setup saved."); }} />;
      break;
    }
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
      const maxRate = Math.max(1,...[6,5,4,3,2,1,0].map((offset)=>data.folio_items.filter((i)=>i.service_date===dateInPropertyTimeZone(new Date(Date.now()-offset*86400000))&&i.item_type!=="discount").reduce((n,i)=>n+Number(i.amount||0),0)));
      const revenueDays = [6,5,4,3,2,1,0].map((offset)=>{const day=dateInPropertyTimeZone(new Date(Date.now()-offset*86400000));return {day,total:data.folio_items.filter((i)=>i.service_date===day&&i.item_type!=="discount").reduce((n,i)=>n+Number(i.amount||0),0)};});
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
      content = <><div className="panel"><h2>Add room type</h2>{submitForm(<><input type="hidden" value="room_type" onChange={() => {}} />{select("kind", "Record type", [{value:"room_type",label:"Room type"}])}{field("type_name", "Type name")}{field("type_code", "Code")}{field("max_occupancy", "Max occupancy", "number", true, {min:1, defaultValue:"2"})}{field("base_rate", `Nightly rate (${hotel?.currency_code || "USD"})`, "number", true, {min:0,step:"0.01"})}{field("description", "Description", "text", false)}{submitButton("Save room type")}</>)}</div><div className="panel"><h2>Room type register</h2>{table(["Type","Code","Maximum occupancy","Nightly rate","Description","Actions"],data.room_types.map(r=>[r.name,r.code,r.max_occupancy,money(r.base_rate, hotel?.currency_code || "USD"),r.description||"—",<div className="actions"><button className="small" onClick={()=>{const rate=window.prompt("Update nightly rate for "+r.name,String(r.base_rate));if(rate===null)return;const value=Number(rate);if(!Number.isFinite(value)||value<0){setError("Rate must be zero or more.");return;}void updatePropertyRecord("room_types",r,{base_rate:value},"Room type rate");}}>Edit rate</button><button className="small danger" disabled={data.rooms.some(room=>room.room_type_id===r.id)} onClick={()=>void deletePropertyRecord("room_types",r,"room type")}>Delete</button></div>]))}</div><div className="panel"><h2>Add room</h2>{data.room_types.length === 0 ? <p className="muted">Create a room type first.</p> : submitForm(<>{select("kind", "Record type", [{value:"room",label:"Room"}])}{field("room_number", `${propertyUnitLabel(hotel).replace(/s$/i, "")} number / identifier`)}{select("room_type_id", "Room type", data.room_types.map((r) => ({value:r.id,label:`${r.name} · ${money(r.base_rate)}`})))}{field("floor_label", "Floor / wing", "text", false)}{submitButton("Save room")}</>)}</div><section className="panel room-board-panel"><div className="panel-head"><div><span className="data-table-eyebrow">FRONT DESK</span><h2>Live room board</h2><p>Room status at a glance. Use the status control to update housekeeping and availability.</p></div><span className="board-count">{data.rooms.length} rooms</span></div><div className="live-room-grid">{data.rooms.map((r)=>{const type=data.room_types.find((t)=>t.id===r.room_type_id);const activeBooking=data.reservations.find(b=>b.room_id===r.id&&["confirmed","checked_in"].includes(b.status)&&b.check_in_date<=today()&&b.check_out_date>today());return <article className={'live-room-tile '+String(r.status||'available')} key={r.id}><div className="live-room-top"><span className="room-number-label">{propertyUnitLabel(hotel).replace(/s & .*/i, "").replace(/s$/i, "").toUpperCase()}</span><strong>{r.room_number}</strong><span className={'room-status-dot '+String(r.status||'available')}/></div><span className="live-room-type">{type?.name||'Room type not set'}</span><span className="live-room-rate">{money(type?.base_rate, hotel?.currency_code || "USD")} <small>/ night</small></span>{activeBooking&&<span className="room-guest-line">{guestName(activeBooking.guest_id)}</span>}<label className="room-status-control">Status<select value={r.status||'available'} onChange={(e)=>changeRoomStatus(r,e.target.value)}><option value="available">Available</option><option value="occupied">Occupied</option><option value="dirty">Dirty</option><option value="cleaning">Cleaning</option><option value="maintenance">Maintenance</option><option value="out_of_service">Out of service</option></select></label></article>})}{!data.rooms.length&&<div className="manager-empty">Add rooms to start using the live room board.</div>}</div></section><div className="panel"><h2>Room inventory</h2>{table(["Room", "Type", "Rate / night", "Status", "Quick update"], data.rooms.map((r) => [r.room_number, data.room_types.find((t) => t.id === r.room_type_id)?.name ?? "—", money(data.room_types.find((t) => t.id === r.room_type_id)?.base_rate, hotel?.currency_code || "USD"), badge(r.status), <div className="actions"><select aria-label={`Update room ${r.room_number} status`} className="inline-select" value={r.status} onChange={(e) => changeRoomStatus(r, e.target.value)}><option value="available">Available</option><option value="occupied">Occupied</option><option value="dirty">Dirty</option><option value="cleaning">Cleaning</option><option value="maintenance">Maintenance</option><option value="out_of_service">Out of service</option></select><button className="small danger" disabled={data.reservations.some(b=>b.room_id===r.id&&!["cancelled","checked_out","no_show"].includes(b.status))} onClick={() => { if(window.confirm(`Deactivate room ${r.room_number}? It will no longer be offered for new bookings.`)) void updatePropertyRecord("rooms",r,{active:false,status:"out_of_service"},"Room"); }}>Deactivate</button></div>]))}</div></>;
      break;
    case "guests": {
      const guestName = (g: Row) => `${g.first_name || ""} ${g.last_name || ""}`.trim() || "Guest";
      const guestReservations = (g: Row) => data.reservations.filter(r => r.guest_id === g.id && !["cancelled","no_show"].includes(String(r.status || "").toLowerCase()));
      const guestToday = today();
      const isInHouse = (g: Row) => guestReservations(g).some(r => ["checked_in","in_house"].includes(String(r.status || "").toLowerCase()) || (r.check_in_date <= guestToday && r.check_out_date > guestToday));
      const isArrival = (g: Row) => guestReservations(g).some(r => r.check_in_date === guestToday && !["checked_in","in_house","checked_out"].includes(String(r.status || "").toLowerCase()));
      const isDeparture = (g: Row) => guestReservations(g).some(r => r.check_out_date === guestToday && !["checked_out","cancelled","no_show"].includes(String(r.status || "").toLowerCase()));
      const repeatCount = (g: Row) => guestReservations(g).length;
      const searchedGuests = data.guests.filter(g => [guestName(g),g.email,g.phone,g.id_document_number,g.nationality,g.company_name].some(v => String(v || "").toLowerCase().includes(guestSearch.toLowerCase().trim())));
      const filteredGuests = searchedGuests.filter(g => guestView === "in_house" ? isInHouse(g) : guestView === "arrivals" ? isArrival(g) : guestView === "departures" ? isDeparture(g) : guestView === "repeat" ? repeatCount(g) > 1 : true);
      const selectedGuest = data.guests.find(g => g.id === selectedGuestId) || filteredGuests[0] || data.guests[0] || null;
      const selectedReservations = selectedGuest ? guestReservations(selectedGuest).sort((a,b) => String(b.check_in_date || "").localeCompare(String(a.check_in_date || ""))) : [];
      const currentStay = selectedGuest ? selectedReservations.find(r => ["checked_in","in_house"].includes(String(r.status || "").toLowerCase()) || (r.check_in_date <= guestToday && r.check_out_date > guestToday)) : null;
      const guestCard = (label: string, value: number, hint: string, icon: ReactNode, tone: string) => <div className="guest-metric"><span className={`guest-metric-icon ${tone}`}>{icon}</span><div><small>{label}</small><strong>{value}</strong><span>{hint}</span></div></div>;
      content = <div className="guest-workspace">
        <div className="guest-page-heading"><div><span className="data-table-eyebrow">GUEST EXPERIENCE</span><h2><Users size={25}/> Guests</h2><p>Manage guest profiles, stay history, arrivals and guest communications.</p></div><div className="actions"><button className="secondary" onClick={() => exportCsv("sifobooks-guests.csv",["First name","Last name","Email","Phone","Nationality","ID / Passport","Company"],data.guests.map(g=>[g.first_name,g.last_name,g.email,g.phone,g.nationality,g.id_document_number,g.company_name]))}><FileBarChart size={15}/> Export</button><button className="primary" onClick={() => {setEditingGuestId(null);setForm({});window.scrollTo({top:0,behavior:"smooth"});}}><Plus size={16}/> Add Guest</button></div></div>
        <div className="guest-metrics">
          {guestCard("Total guests",data.guests.length,"All saved profiles",<Users size={19}/>,"neutral")}
          {guestCard("In-house",data.guests.filter(isInHouse).length,"Currently staying",<BedDouble size={19}/>,"green")}
          {guestCard("Arrivals today",data.guests.filter(isArrival).length,"Expected check-ins",<CalendarDays size={19}/>,"blue")}
          {guestCard("Departures today",data.guests.filter(isDeparture).length,"Expected check-outs",<DoorOpen size={19}/>,"orange")}
          {guestCard("Repeat guests",data.guests.filter(g=>repeatCount(g)>1).length,"More than one reservation",<RefreshCw size={19}/>,"purple")}
        </div>
        <div className="guest-directory-layout">
          <section className="panel guest-directory-panel">
            <div className="guest-view-tabs">
              {([{id:"all",label:"All Guests"},{id:"in_house",label:"In-House"},{id:"arrivals",label:"Arrivals"},{id:"departures",label:"Departures"},{id:"repeat",label:"Repeat Guests"}] as const).map(v=><button key={v.id} className={guestView===v.id?"active":""} onClick={()=>setGuestView(v.id)}>{v.label}<span>{v.id==="all"?data.guests.length:v.id==="in_house"?data.guests.filter(isInHouse).length:v.id==="arrivals"?data.guests.filter(isArrival).length:v.id==="departures"?data.guests.filter(isDeparture).length:data.guests.filter(g=>repeatCount(g)>1).length}</span></button>)}
            </div>
            <div className="guest-search-row"><label><Users size={16}/><input value={guestSearch} onChange={e=>setGuestSearch(e.target.value)} placeholder="Search name, phone, email, ID or company"/></label><button className="secondary" onClick={()=>{setGuestSearch("");setGuestView("all");}}>Reset</button></div>
            {filteredGuests.length===0 ? <div className="empty guest-empty"><Users size={28}/><strong>No guests found</strong><span>Try another search or add a guest profile.</span></div> :
              <div className="table-scroll guest-table-scroll"><table className="guest-table"><thead><tr><th>Guest</th><th>Contact</th><th>Stay details</th><th>Status</th><th>Type</th><th>Actions</th></tr></thead><tbody>{filteredGuests.map(g=>{const rs=guestReservations(g);const active=rs.find(r=>["checked_in","in_house"].includes(String(r.status||"").toLowerCase())||(r.check_in_date<=guestToday&&r.check_out_date>guestToday));const upcoming=rs.find(r=>r.check_in_date>=guestToday);const stay=active||upcoming||rs[0];const room=data.rooms.find(r=>r.id===stay?.room_id);const roomType=data.room_types.find(t=>t.id===room?.room_type_id);const status=active?"In-house":isArrival(g)?"Arriving":isDeparture(g)?"Departing":"Guest";return <tr key={g.id} className={selectedGuest?.id===g.id?"selected":""} onClick={()=>setSelectedGuestId(g.id)}><td><div className="guest-cell"><span className="guest-avatar">{(g.first_name||"G").slice(0,1)}{(g.last_name||"").slice(0,1)}</span><div><strong>{guestName(g)}</strong><small>{g.id_document_number||"Guest profile"}</small></div></div></td><td><span>{g.phone||"—"}</span><small>{g.email||"No email recorded"}</small></td><td><span>{stay?.check_in_date||"No booking"}{stay?.check_out_date?` – ${stay.check_out_date}`:""}</span><small>{room?`Room ${room.room_number}`: "Room not assigned"}{roomType?` · ${roomType.name}`:""}</small></td><td><span className={`guest-status ${status.toLowerCase().replace(/\s+/g,"-")}`}>{status}</span></td><td><span className="guest-type-pill">{g.company_name?"Business":repeatCount(g)>1?"Repeat":"Leisure"}</span></td><td><div className="actions"><button className="small" onClick={e=>{e.stopPropagation();setSelectedGuestId(g.id);editGuest(g);}}>Edit</button><button className="small danger" onClick={e=>{e.stopPropagation();void deletePropertyRecord("guests",g,"guest");}}>Delete</button></div></td></tr>})}</tbody></table></div>}
            <div className="guest-table-footer">Showing {filteredGuests.length} of {data.guests.length} guest profiles</div>
          </section>
          <aside className="panel guest-profile-panel">{selectedGuest ? <>
            <div className="guest-profile-head"><span className="guest-avatar guest-avatar-large">{(selectedGuest.first_name||"G").slice(0,1)}{(selectedGuest.last_name||"").slice(0,1)}</span><div><h3>{guestName(selectedGuest)}</h3><span className="guest-status profile-status">{isInHouse(selectedGuest)?"● In-house guest":isArrival(selectedGuest)?"● Arriving today":"● Guest profile"}</span><small>Guest ID: {String(selectedGuest.id).slice(0,8).toUpperCase()}</small></div></div>
            <div className="guest-profile-tabs"><span className="active">Details</span><span>Stay History ({selectedReservations.length})</span></div>
            <div className="guest-details-list">{[["Phone",selectedGuest.phone],["Email",selectedGuest.email],["ID / Passport",selectedGuest.id_document_number],["Nationality",selectedGuest.nationality],["Address",selectedGuest.address],["Company",selectedGuest.company_name]].map(([label,value])=><div key={label as string}><span>{label}</span><strong>{String(value||"Not provided")}</strong></div>)}</div>
            <div className="guest-profile-actions"><button className="primary" onClick={()=>editGuest(selectedGuest)}><UserCog size={15}/> Edit Guest</button><button className="secondary" onClick={()=>{setTab("reservations");setForm({guest_id:selectedGuest.id,check_in_date:today(),adults:"1",children:"0"});window.scrollTo({top:0,behavior:"smooth"});}}><CalendarDays size={15}/> New Reservation</button>
            {selectedGuest.phone&&<a className="secondary" target="_blank" rel="noreferrer" href={`https://wa.me/${(String(selectedGuest.phone).replace(/[^0-9]/g,"").startsWith("0")?"260"+String(selectedGuest.phone).replace(/[^0-9]/g,"").slice(1):String(selectedGuest.phone).replace(/[^0-9]/g,""))}?text=${encodeURIComponent("Hello "+selectedGuest.first_name+", greetings from "+hotel.name+". How may we assist with your stay?")}` }><MessageCircle size={15}/> WhatsApp</a>}
            {selectedGuest.email&&<a className="secondary" href={`mailto:${encodeURIComponent(selectedGuest.email)}?subject=${encodeURIComponent("Greetings from "+hotel.name)}`}><MessageCircle size={15}/> Email Guest</a>}</div>
            <div className="guest-current-stay"><h4><BedDouble size={17}/> Current / Next Stay</h4>{currentStay||selectedReservations[0]?<><strong>{(()=>{const r=currentStay||selectedReservations[0];const room=data.rooms.find(x=>x.id===r.room_id);const rt=data.room_types.find(x=>x.id===room?.room_type_id);return room?`Room ${room.room_number} · ${rt?.name||"Room"}`:"Reservation recorded";})()}</strong><p>{(currentStay||selectedReservations[0]).check_in_date} – {(currentStay||selectedReservations[0]).check_out_date}</p><small>{selectedReservations.length} reservation(s) on record</small></>:<><strong>No reservation linked</strong><p>Create a reservation to see room and stay information here.</p></>}</div>
            <div className="guest-history"><h4>Recent Stay History</h4>{selectedReservations.slice(0,3).map(r=><div key={r.id}><span>{r.check_in_date} – {r.check_out_date}</span><small>{r.status||"Reservation"}</small></div>)}{selectedReservations.length===0&&<small>No stay history yet.</small>}</div>
          </> : <div className="empty">Select a guest to view their profile.</div>}</aside>
        </div>
        <section className="panel guest-form-panel"><div className="panel-head"><div><h2>{editingGuestId?"Edit guest profile":"Add a guest"}</h2><p>Guest details are stored in this hotel's existing guest register.</p></div>{editingGuestId&&<button type="button" className="secondary" onClick={()=>{setEditingGuestId(null);setForm({});}}>Cancel edit</button>}</div>{submitForm(<>{field("first_name","First name")}{field("last_name","Last name")}{field("email","Email","email",false)}{field("phone","Phone","tel",false)}{field("nationality","Nationality","text",false)}{field("id_document_type","ID document type","text",false)}{field("id_document_number","ID / passport number","text",false)}{field("company_name","Company / organisation","text",false)}{field("address","Address","text",false)}{field("notes","Guest notes / preferences","text",false)}{submitButton(editingGuestId?"Update guest":"Save guest")}</>)}</section>
      </div>;
      break;
    }
    case "reservations": {
      const activeReservations = data.reservations.filter(r => !["cancelled","no_show","checked_out"].includes(String(r.status||"").toLowerCase()));
      const todayDate = today();
      const arrivalRows = activeReservations.filter(r => r.check_in_date === todayDate && ["pending","confirmed","checked_in"].includes(String(r.status||"").toLowerCase()));
      const departureRows = activeReservations.filter(r => r.check_out_date === todayDate && ["checked_in","confirmed"].includes(String(r.status||"").toLowerCase()));
      const inHouseRows = activeReservations.filter(r => ["checked_in","in_house"].includes(String(r.status||"").toLowerCase()));
      const expectedRevenue = activeReservations.filter(r => String(r.check_in_date||"").slice(0,7)===todayDate.slice(0,7)).reduce((sum,r)=>sum+Number(r.total_amount ?? r.total ?? r.room_total ?? 0),0);
      const filteredReservations = [...data.reservations].filter(r => {
        const q=tableSearch.trim().toLowerCase();
        const guest=guestName(r.guest_id).toLowerCase();
        const room=roomName(r.room_id).toLowerCase();
        const ref=String(r.reservation_number||"").toLowerCase();
        const matchesSearch=!q||guest.includes(q)||room.includes(q)||ref.includes(q)||String(r.status||"").toLowerCase().includes(q)||String(r.check_in_date||"").includes(q)||String(r.check_out_date||"").includes(q);
        const matchesDate=!selectedCalendarDate || (r.check_in_date<=selectedCalendarDate && r.check_out_date>selectedCalendarDate);
        return matchesSearch && (tableSearch.startsWith("date:") ? matchesDate : true);
      }).sort((a,b)=>String(a.check_in_date||"").localeCompare(String(b.check_in_date||"")));
      const daysInMonth = new Date(calendarMonth.getFullYear(),calendarMonth.getMonth()+1,0).getDate();
      const firstOffset = (new Date(calendarMonth.getFullYear(),calendarMonth.getMonth(),1).getDay()+6)%7;
      const calendarDays = Array.from({length:firstOffset+daysInMonth},(_,idx)=>idx<firstOffset?null:idx-firstOffset+1);
      const reservationsForDay = (iso:string) => activeReservations.filter(r=>String(r.check_in_date||"")<=iso&&String(r.check_out_date||"")>iso);
      const timelineStart = new Date(selectedCalendarDate+"T12:00:00");
      const timelineDates = Array.from({length:14},(_,i)=>{const d=new Date(timelineStart);d.setDate(d.getDate()+i);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");});
      const roomTimelineBooking = (roomId:string,iso:string) => activeReservations.find(r=>r.room_id===roomId&&String(r.check_in_date||"")<=iso&&String(r.check_out_date||"")>iso);
      const startReservationForRoom = (room:Row,iso:string) => {const end=new Date(iso+"T12:00:00");end.setDate(end.getDate()+1);const checkout=end.getFullYear()+"-"+String(end.getMonth()+1).padStart(2,"0")+"-"+String(end.getDate()).padStart(2,"0");setForm({guest_id:"",room_id:room.id,check_in_date:iso,check_out_date:checkout,adults:"1",children:"0",nightly_rate:""});document.getElementById("reservation-create-form")?.scrollIntoView({behavior:"smooth",block:"start"});};
      const roomForReservation = (r:Row) => data.rooms.find(x=>x.id===r.room_id);
      const statusClass = (status:string) => ["checked_in","in_house"].includes(String(status||"").toLowerCase())?"in-house":String(status||"").toLowerCase()==="confirmed"?"confirmed":String(status||"").toLowerCase()==="pending"?"pending":String(status||"").toLowerCase()==="checked_out"?"checked-out":String(status||"").toLowerCase()==="cancelled"?"cancelled":"other";
      content = <div className="reservation-workspace">
        <div className="reservation-page-heading"><div><span className="data-table-eyebrow">FRONT DESK · ROOM PLANNING</span><h2><CalendarDays size={25}/> Reservations</h2><p>Create bookings, monitor room availability and manage guest stays from one workspace.</p></div><div className="actions"><button className="secondary" type="button" onClick={()=>{setCalendarMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1));setSelectedCalendarDate(today());setTableSearch("");}}>Today</button><button className="primary" type="button" onClick={()=>document.getElementById("reservation-create-form")?.scrollIntoView({behavior:"smooth",block:"start"})}><Plus size={16}/> New Reservation</button></div></div>
        <div className="reservation-metrics">
          <article><span className="reservation-metric-icon gold"><CalendarDays size={19}/></span><div><small>Total reservations</small><strong>{data.reservations.length}</strong><em>This month: {activeReservations.filter(r=>String(r.check_in_date||"").slice(0,7)===todayDate.slice(0,7)).length}</em></div></article>
          <article><span className="reservation-metric-icon violet"><Users size={19}/></span><div><small>Arrivals today</small><strong>{arrivalRows.length}</strong><em>Expected check-ins</em></div></article>
          <article><span className="reservation-metric-icon coral"><DoorOpen size={19}/></span><div><small>Departures today</small><strong>{departureRows.length}</strong><em>Expected check-outs</em></div></article>
          <article><span className="reservation-metric-icon green"><BedDouble size={19}/></span><div><small>In-house guests</small><strong>{inHouseRows.length}</strong><em>Active checked-in stays</em></div></article>
          <article><span className="reservation-metric-icon blue"><FileBarChart size={19}/></span><div><small>Rooms available today</small><strong>{data.rooms.filter(r=>r.active&&!["maintenance","out_of_service","dirty","cleaning","occupied"].includes(String(r.status||"").toLowerCase())&&!activeReservations.some(b=>b.room_id===r.id&&b.check_in_date<=todayDate&&b.check_out_date>todayDate)).length}</strong><em>{data.rooms.filter(r=>r.active).length} active rooms total</em></div></article>
        </div>
        <section className="panel reservation-calendar-panel reservation-planner"><div className="panel-head"><div><span className="data-table-eyebrow">ROOM PLANNING</span><h2>Reservation calendar</h2><p>Select a date to see stays occupying rooms. Dates use your hotel's saved reservation records.</p></div><div className="calendar-controls"><button className="secondary" type="button" onClick={()=>setCalendarMonth(m=>new Date(m.getFullYear(),m.getMonth()-1,1))}>‹</button><strong>{calendarMonth.toLocaleDateString("en-ZM",{month:"long",year:"numeric"})}</strong><button className="secondary" type="button" onClick={()=>setCalendarMonth(m=>new Date(m.getFullYear(),m.getMonth()+1,1))}>›</button><button className="small" type="button" onClick={()=>{setCalendarMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1));setSelectedCalendarDate(today());}}>Today</button></div></div>
          <div className="reservation-calendar-grid">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(d=><div className="calendar-weekday" key={d}>{d}</div>)}{calendarDays.map((day,idx)=>{if(day===null)return <div className="calendar-day outside" key={"blank-"+idx}/>;const iso=calendarMonth.getFullYear()+"-"+String(calendarMonth.getMonth()+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");const stays=reservationsForDay(iso);const arrivals=activeReservations.filter(r=>r.check_in_date===iso);return <button type="button" key={iso} className={"calendar-day reservation-calendar-day "+(iso===todayDate?"is-today ":"")+(iso===selectedCalendarDate?"is-selected":"")} onClick={()=>{setSelectedCalendarDate(iso);setTableSearch("");}} aria-pressed={iso===selectedCalendarDate}><span className="calendar-date">{day}</span>{arrivals.slice(0,2).map(r=><span key={r.id} className={"reservation-calendar-chip "+statusClass(r.status)} title={guestName(r.guest_id)+" · "+roomName(r.room_id)}><BedDouble size={11}/>{guestName(r.guest_id)}</span>)}{stays.length>arrivals.length&&<span className="calendar-event stay">+{stays.length-arrivals.length} more staying</span>}{stays.length===0&&<span className="calendar-empty-label">Available</span>}</button>})}</div>
          <div className="reservation-calendar-legend"><span><i className="legend-dot confirmed"/> Confirmed</span><span><i className="legend-dot pending"/> Pending</span><span><i className="legend-dot in-house"/> In-house</span><span><i className="legend-dot cancelled"/> Cancelled / no-show excluded from occupancy</span></div>
          <div className="reservation-selected-day"><div><span className="data-table-eyebrow">SELECTED DATE</span><h3>{new Date(selectedCalendarDate+"T12:00:00").toLocaleDateString("en-ZM",{weekday:"long",day:"numeric",month:"long",year:"numeric"})}</h3></div><span className="reservation-count-pill">{reservationsForDay(selectedCalendarDate).length} active stay(s)</span></div>
          {reservationsForDay(selectedCalendarDate).length===0?<p className="calendar-no-bookings">No active stays overlap this date. Use New Reservation to create a booking.</p>:<div className="reservation-day-list">{reservationsForDay(selectedCalendarDate).map(r=><article key={r.id}><span className="reservation-room-badge">{roomName(r.room_id)}</span><div className="reservation-day-guest"><strong>{guestName(r.guest_id)}</strong><small>{r.reservation_number||"Reservation"} · {r.check_in_date} → {r.check_out_date}</small></div><span className={"reservation-status "+statusClass(r.status)}>{String(r.status||"unknown").replaceAll("_"," ")}</span><div className="actions">{reservationActions(r)}</div></article>)}</div>}
        </section>
        <section className="panel reservation-timeline-panel"><div className="panel-head"><div><span className="data-table-eyebrow">LIVE ROOM INVENTORY</span><h2>Room availability timeline</h2><p>14-day view from the selected calendar date. Occupancy is calculated from saved reservation dates.</p></div><button type="button" className="secondary" onClick={()=>{setSelectedCalendarDate(today());setCalendarMonth(new Date(new Date().getFullYear(),new Date().getMonth(),1));}}>Start today</button></div>
          <div className="reservation-timeline-legend"><span><i className="timeline-key available"/> Available</span><span><i className="timeline-key booked"/> Booked / in-house</span><span><i className="timeline-key blocked"/> Not sellable</span><span><i className="timeline-key conflict"/> Conflict</span></div>
          <div className="reservation-timeline-scroll"><div className="reservation-timeline-grid"><div className="timeline-room-header">Room / Type</div>{timelineDates.map(d=><div className={"timeline-date-header "+(d===todayDate?"today":"")} key={d}><strong>{new Date(d+"T12:00:00").toLocaleDateString("en-ZM",{weekday:"short"})}</strong><span>{new Date(d+"T12:00:00").toLocaleDateString("en-ZM",{day:"numeric",month:"short"})}</span></div>)}
          {data.rooms.filter(r=>r.active).sort((a,b)=>String(a.room_number).localeCompare(String(b.room_number),undefined,{numeric:true})).map(room=>{const roomType=data.room_types.find(t=>t.id===room.room_type_id);const blocked=["maintenance","out_of_service","dirty","cleaning"].includes(String(room.status||"").toLowerCase());return <div className="timeline-room-row" key={room.id} style={{display:"contents"}}><div className="timeline-room-label"><strong>{room.room_number}</strong><small>{roomType?.name||"Room"} · {money(roomType?.base_rate,hotel?.currency_code||"USD")}</small></div>{timelineDates.map(iso=>{const booking=roomTimelineBooking(room.id,iso);const conflict=activeReservations.filter(r=>r.room_id===room.id&&String(r.check_in_date||"")<=iso&&String(r.check_out_date||"")>iso).length>1;const label=booking?(["checked_in","in_house"].includes(String(booking.status||"").toLowerCase())?"In-house":String(booking.status||"Booking")):blocked?String(room.status||"Blocked").replaceAll("_"," "):"Available";return <button type="button" key={iso} title={booking?guestName(booking.guest_id)+" · "+booking.check_in_date+" to "+booking.check_out_date:blocked?"Room status: "+room.status:"Click to start a booking"} className={"timeline-cell "+(conflict?"conflict":booking?"booked":blocked?"blocked":"available")} onClick={()=>booking?(setSelectedCalendarDate(iso),setCalendarMonth(new Date(iso.slice(0,4)+"-"+iso.slice(5,7)+"-01T12:00:00"))):!blocked?startReservationForRoom(room,iso):setNotice("Room "+room.room_number+" is marked "+String(room.status||"unavailable").replaceAll("_"," ")+". Update room status before booking.")}>{booking?<><span className="timeline-cell-dot"/><span>{guestName(booking.guest_id).split(" ")[0]}</span></>:<span>{conflict?"Conflict":blocked?"Blocked":"+"}</span>}</button>})}</div>})}</div></div>
          <p className="reservation-timeline-note">Select an available cell to prefill the new reservation form. Booked cells jump to that date in the calendar. The reservation service remains responsible for final conflict validation.</p>
        </section>
        <section className="panel reservation-book-panel"><div className="panel-head"><div><span className="data-table-eyebrow">BOOKING REGISTER</span><h2>Recent reservations</h2><p>Search bookings and manage check-ins, check-outs and cancellations.</p></div><button className="secondary" type="button" onClick={()=>exportCsv("sifobooks-reservations.csv",["Reference","Guest","Room","Check-in","Check-out","Status"],data.reservations.map(r=>[r.reservation_number,guestName(r.guest_id),roomName(r.room_id),r.check_in_date,r.check_out_date,r.status]))}><FileBarChart size={15}/> Export CSV</button></div>
          <div className="reservation-search"><label><Users size={16}/><input value={tableSearch} onChange={e=>setTableSearch(e.target.value)} placeholder="Search guest, room, reference, status or date…"/></label><span>{filteredReservations.length} booking(s)</span><button className="small" type="button" onClick={()=>setTableSearch("")}>Clear</button></div>
          <div className="table-scroll"><table className="reservation-table"><thead><tr><th>Reference</th><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Nights</th><th>Status</th><th>Actions</th></tr></thead><tbody>{filteredReservations.slice(0,100).map(r=>{const nights=Math.max(0,Math.round((new Date(String(r.check_out_date)+"T12:00:00").getTime()-new Date(String(r.check_in_date)+"T12:00:00").getTime())/86400000));const guest=data.guests.find(g=>g.id===r.guest_id);const room=roomForReservation(r);return <tr key={r.id}><td><strong>{r.reservation_number||String(r.id).slice(0,8).toUpperCase()}</strong></td><td><div className="reservation-table-guest"><span>{guest?((guest.first_name||"G").slice(0,1)+(guest.last_name||"").slice(0,1)):"G"}</span><div><strong>{guestName(r.guest_id)}</strong><small>{guest?.phone||guest?.email||"No contact details"}</small></div></div></td><td><strong>{roomName(r.room_id)}</strong><small className="reservation-muted-cell">{data.room_types.find(t=>t.id===room?.room_type_id)?.name||"Room"}</small></td><td>{r.check_in_date||"—"}</td><td>{r.check_out_date||"—"}</td><td>{nights}</td><td><span className={"reservation-status "+statusClass(r.status)}>{String(r.status||"unknown").replaceAll("_"," ")}</span></td><td>{reservationActions(r)}</td></tr>})}</tbody></table>{filteredReservations.length===0&&<div className="calendar-no-bookings">No reservations match your search.</div>}</div>
        </section>
        <section className="panel reservation-create-panel" id="reservation-create-form"><div className="panel-head"><div><span className="data-table-eyebrow">NEW BOOKING</span><h2>Create reservation</h2><p>Choose the guest, dates and room. Room conflicts are checked by the reservation service.</p></div><span className="reservation-create-badge"><Plus size={14}/> New stay</span></div>{data.guests.length===0||data.rooms.length===0?<p className="muted">Add at least one guest and one room before creating a reservation.</p>:submitForm(<>{select("guest_id","Guest",data.guests.map(g=>({value:g.id,label:`${g.first_name} ${g.last_name}${g.phone?" · "+g.phone:""}`})))}{select("room_id","Room",data.rooms.filter(r=>r.active&&!["maintenance","out_of_service"].includes(String(r.status||"").toLowerCase())).map(r=>({value:r.id,label:`${r.room_number} · ${data.room_types.find(t=>t.id===r.room_type_id)?.name??"Room"} · ${money(data.room_types.find(t=>t.id===r.room_type_id)?.base_rate,hotel?.currency_code||"USD")}`})))}{field("check_in_date","Check-in","date",true,{min:today(),defaultValue:today()})}{field("check_out_date","Check-out","date",true,{min:today()})}{field("adults","Adults","number",true,{min:1,defaultValue:"1"})}{field("children","Children","number",true,{min:0,defaultValue:"0"})}{field("nightly_rate",`Nightly rate (${hotel?.currency_code||"USD"}, blank uses room rate)`,"number",false,{min:0,step:"0.01"})}{submitButton("Confirm reservation")}</>)}</section>
      </div>;
      break;
    }
    case "housekeeping":
      content = <><div className="panel"><h2>Create housekeeping task</h2>{data.rooms.length === 0 ? <p className="muted">Add rooms first.</p> : submitForm(<>{select("room_id", "Room", data.rooms.map((r) => ({value:r.id,label:r.room_number})))}{select("task_type", "Task", [{value:"cleaning",label:"Cleaning"},{value:"inspection",label:"Inspection"},{value:"linen",label:"Linen"},{value:"deep_clean",label:"Deep clean"}])}{select("priority", "Priority", [{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"},{value:"urgent",label:"Urgent"}])}{field("notes", "Notes", "text", false)}{submitButton("Create task")}</>)}</div><section className="panel housekeeping-board-panel"><div className="panel-head"><div><span className="data-table-eyebrow">ROOM READINESS</span><h2>Housekeeping workboard</h2><p>Tasks grouped by operational status for quick shift handover.</p></div></div><div className="housekeeping-lanes">{[{key:'pending',label:'To do',cls:'todo'},{key:'in_progress',label:'In progress',cls:'progress'},{key:'completed',label:'Completed',cls:'done'}].map(lane=>{const tasks=data.housekeeping_tasks.filter(t=>lane.key==='completed'?['completed','verified'].includes(t.status):t.status===lane.key);return <div className="housekeeping-lane" key={lane.key}><div className="housekeeping-lane-head"><span className={'lane-dot '+lane.cls}/><strong>{lane.label}</strong><span>{tasks.length}</span></div>{tasks.length?tasks.map(t=><article className="housekeeping-task-card" key={t.id}><div className="housekeeping-task-title">Room {roomName(t.room_id)}</div><span className="housekeeping-task-kind">{String(t.task_type||'cleaning').replaceAll('_',' ')}</span><div className="housekeeping-task-meta"><span className={'priority-label '+String(t.priority||'normal')}>{t.priority||'normal'} priority</span></div>{t.notes&&<p>{t.notes}</p>}{!['completed','verified','cancelled'].includes(t.status)&&<button className="small" type="button" onClick={()=>completeTask(t)}>{t.status==='pending'?'Start task':'Complete task'}</button>}</article>):<div className="lane-empty">No tasks in this stage.</div>}</div>})}</div></section><div className="panel"><h2>Housekeeping queue</h2>{table(["Room", "Task", "Priority", "Status", "Action"], data.housekeeping_tasks.map((t) => [roomName(t.room_id), t.task_type, badge(t.priority), badge(t.status), ["completed","verified","cancelled"].includes(t.status) ? <button className="small danger" onClick={() => void deletePropertyRecord("housekeeping_tasks",t,"housekeeping task")}>Delete</button> : <div className="actions"><button className="small" onClick={() => completeTask(t)}>{t.status === "pending" ? "Start task" : "Complete task"}</button><button className="small danger" onClick={() => void deletePropertyRecord("housekeeping_tasks",t,"housekeeping task")}>Delete</button></div>]))}</div></>;
      break;
    case "folios":
      content = <><div className="panel"><h2>Add folio charge</h2>{data.folios.length === 0 ? <p className="muted">A folio is created automatically when you confirm a reservation.</p> : submitForm(<>{select("kind", "Action", [{value:"charge",label:"Add charge"}])}{select("folio_id", "Folio", data.folios.filter((f) => f.status === "open").map((f) => ({value:f.id,label:`${f.folio_number} · ${guestName(data.reservations.find((r) => r.id === f.reservation_id)?.guest_id ?? "")}`})))}{select("item_type", "Charge type", [{value:"room_charge",label:"Room charge"},{value:"food_beverage",label:"Food & beverage"},{value:"service",label:"Service"},{value:"tax",label:"Tax"},{value:"discount",label:"Discount"},{value:"other",label:"Other"}])}{field("description", "Description")}{field("quantity", "Quantity", "number", true, {min:0.001,step:"0.001",defaultValue:"1"})}{field("unit_price", "Unit price (ZMW)", "number", true, {step:"0.01"})}{field("service_date", "Service date", "date", true, {defaultValue:today()})}{submitButton("Add charge")}</>)}</div><div className="panel"><h2>Record payment</h2>{data.folios.length === 0 ? <p className="muted">Create a reservation first.</p> : submitForm(<>{select("kind", "Action", [{value:"payment",label:"Record payment"}])}{select("folio_id", "Folio", data.folios.filter((f) => f.status === "open").map((f) => ({value:f.id,label:f.folio_number})))}{select("method", "Method", [{value:"cash",label:"Cash"},{value:"card",label:"Card"},{value:"bank_transfer",label:"Bank transfer"},{value:"mobile_money",label:"Mobile money"},{value:"voucher",label:"Voucher"},{value:"other",label:"Other"}])}{field("amount", "Amount (ZMW)", "number", true, {min:0.01,step:"0.01"})}{field("reference", "Reference", "text", false)}{submitButton("Record receipt")}</>)}</div><div className="panel"><h2>Guest folios</h2>{table(["Folio", "Guest", "Reservation", "Charges", "Payments", "Balance", "Status"], data.folios.map((f) => [f.folio_number, guestName(data.reservations.find((r) => r.id === f.reservation_id)?.guest_id ?? ""), data.reservations.find((r) => r.id === f.reservation_id)?.reservation_number ?? "—", money(data.folio_items.filter((i) => i.folio_id === f.id).reduce((s, i) => s + Number(i.amount || 0), 0)), money(data.payments.filter((p) => p.folio_id === f.id && p.status === "posted").reduce((s, p) => s + Number(p.amount || 0), 0)), money(folioBalance(f)), badge(f.status)]))}</div><div className="panel"><h2>Receipt history</h2>{table(["Receipt", "Date", "Guest", "Method", "Amount", "Reference", "Print"], data.payments.filter((p) => p.status === "posted").map((p) => [p.payment_number, new Date(p.received_at).toLocaleDateString("en-ZM", { timeZone: "Africa/Lusaka" }), guestName(data.reservations.find((r) => r.id === (p.reservation_id || data.folios.find((f) => f.id === p.folio_id)?.reservation_id))?.guest_id ?? ""), p.method, money(p.amount), p.reference ?? "—", <button className="small" onClick={() => printReceipt(p)}>Print receipt</button>]))}</div></>;
      break;
    case "maintenance":
      content = <><div className="panel"><h2>Report maintenance issue</h2>{submitForm(<>{field("title", "Issue title")}{select("room_id", "Room (optional)", data.rooms.map((r) => ({value:r.id,label:r.room_number})), false)}{select("priority", "Priority", [{value:"low",label:"Low"},{value:"normal",label:"Normal"},{value:"high",label:"High"},{value:"urgent",label:"Urgent"}])}{select("blocks_room_sale", "Block room sales?", [{value:"true",label:"Yes — mark room unavailable"},{value:"false",label:"No"}])}{field("description", "Details", "text", false)}{submitButton("Create maintenance ticket")}</>)}</div>
      <div className="panel"><h2>Works completed & costs</h2><p className="muted">Record labour, parts, contractor and other costs against a maintenance issue or room.</p>{submitForm(<><input type="hidden" name="kind" value="maintenance_work"/>{field("work_title","Work completed / job title")}{select("maintenance_request_id","Related maintenance ticket",data.maintenance_requests.map(m=>({value:m.id,label:m.title+" · "+String(m.status||"open")})),false)}{select("room_id","Room",data.rooms.map(r=>({value:r.id,label:r.room_number})),false)}{field("work_date","Work date","date",true,{defaultValue:today()})}{select("work_status","Work status",[{value:"planned",label:"Planned"},{value:"in_progress",label:"In progress"},{value:"completed",label:"Completed"},{value:"cancelled",label:"Cancelled"}])}{field("performed_by","Technician / staff")}{field("vendor_name","Contractor / supplier", "text",false)}{field("labour_cost","Labour cost (ZMW)","number",true,{min:0,step:"0.01",defaultValue:"0"})}{field("parts_cost","Parts / materials cost (ZMW)","number",true,{min:0,step:"0.01",defaultValue:"0"})}{field("other_cost","Other cost (ZMW)","number",true,{min:0,step:"0.01",defaultValue:"0"})}{field("invoice_reference","Invoice / receipt reference","text",false)}{field("work_description","Work performed","text",false)}{field("work_notes","Notes","text",false)}{submitButton("Save work record & costs")}</>)}</div>
      <div className="panel"><h2>Maintenance tickets</h2>{table(["Issue","Room","Priority","Status","Reported"],data.maintenance_requests.map(m=>[m.title,roomName(m.room_id),badge(m.priority),<select className="inline-select" aria-label={"Update maintenance "+m.title} value={m.status||"open"} onChange={e=>void updatePropertyRecord("maintenance_requests",m,{status:e.target.value,...(["completed","resolved","closed"].includes(e.target.value)?{resolved_at:new Date().toISOString()}: {})},"Maintenance ticket")}><option value="open">Open</option><option value="in_progress">In progress</option><option value="completed">Completed</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>,<div className="actions"><span>{m.created_at?new Date(m.created_at).toLocaleDateString():"—"}</span><button className="small danger" onClick={()=>void deletePropertyRecord("maintenance_requests",m,"maintenance ticket")}>Delete</button></div>]))}</div>
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
      const inPeriod = (value: unknown) => { const d=String(value??"").slice(0,10); return (!reportFrom||d>=reportFrom)&&(!reportTo||d<=reportTo); };
      const reservations=data.reservations.filter(r=>inPeriod(r.created_at||r.check_in_date));
      const periodItems=data.folio_items.filter(i=>inPeriod(i.service_date||i.created_at));
      const periodPayments=data.payments.filter(p=>inPeriod(p.received_at||p.created_at)&&p.status==="posted");
      const roomRevenue=periodItems.filter(i=>i.item_type==="room_charge").reduce((n,i)=>n+Number(i.amount||0),0);
      const foodRevenue=periodItems.filter(i=>["food_beverage","service"].includes(i.item_type)).reduce((n,i)=>n+Number(i.amount||0),0);
      const otherRevenue=periodItems.filter(i=>!["room_charge","food_beverage","service","discount","tax"].includes(i.item_type)).reduce((n,i)=>n+Number(i.amount||0),0);
      const taxes=periodItems.filter(i=>i.item_type==="tax").reduce((n,i)=>n+Number(i.amount||0),0);
      const discounts=periodItems.filter(i=>i.item_type==="discount").reduce((n,i)=>n+Math.abs(Number(i.amount||0)),0);
      const gross=periodItems.filter(i=>i.item_type!=="discount").reduce((n,i)=>n+Number(i.amount||0),0);
      const net=gross-discounts;
      const receipts=periodPayments.filter(p=>p.payment_type!=="refund").reduce((n,p)=>n+Number(p.amount||0),0);
      const refunds=periodPayments.filter(p=>p.payment_type==="refund").reduce((n,p)=>n+Number(p.amount||0),0);
      const paymentByMethod=Array.from(new Set(periodPayments.map(p=>p.method))).sort().map(method=>{const rows=periodPayments.filter(p=>p.method===method);return [method.replaceAll("_"," "),String(rows.length),money(rows.reduce((n,p)=>n+(p.payment_type==="refund"?-Number(p.amount||0):Number(p.amount||0)),0))]});
      const statuses=["pending","confirmed","checked_in","checked_out","cancelled","no_show"].map(status=>{const rows=reservations.filter(r=>r.status===status);return [status.replaceAll("_"," "),String(rows.length),String(rows.filter(r=>r.status==="checked_in").length)]});
      const nights=reservations.filter(r=>!["cancelled","no_show"].includes(r.status)).reduce((n,r)=>n+Math.max(0,(new Date(r.check_out_date).getTime()-new Date(r.check_in_date).getTime())/86400000),0);
      const occupied=data.rooms.filter(r=>r.status==="occupied").length;const sellable=data.rooms.filter(r=>r.active!==false&&!["maintenance","out_of_service"].includes(r.status)).length;
      const exportRows=[["Report","Value"],["Period",reportFrom+" to "+reportTo],["Reservations",reservations.length],["Booked room nights",nights],["Current occupancy",sellable?Math.round(occupied/sellable*100)+"%":"0%"],["Room revenue",roomRevenue.toFixed(2)],["Food & beverage / service",foodRevenue.toFixed(2)],["Other revenue",otherRevenue.toFixed(2)],["Tax charges",taxes.toFixed(2)],["Discounts",discounts.toFixed(2)],["Net recorded charges",net.toFixed(2)],["Receipts",receipts.toFixed(2)],["Refunds",refunds.toFixed(2)],["Net receipts",(receipts-refunds).toFixed(2)]];
      content = <><div className="panel"><div className="panel-head"><div><h2>Hotel management reports</h2><p>Filter transactions by service/receipt date. Occupancy is the current snapshot; room nights and money totals use the selected period.</p></div><button className="secondary" onClick={()=>exportCsv("sifobooks-hotel-summary-"+reportFrom+"-to-"+reportTo+".csv",["Report","Value"],exportRows.slice(1))}>Export summary CSV</button></div><div className="form-grid"><label>From date<input type="date" value={reportFrom} max={reportTo||undefined} onChange={e=>setReportFrom(e.target.value)}/></label><label>To date<input type="date" value={reportTo} min={reportFrom||undefined} max={today()} onChange={e=>setReportTo(e.target.value)}/></label><button className="secondary" onClick={()=>{setReportFrom("");setReportTo(today())}}>Year-to-date / all available</button></div></div>
      <div className="metrics"><Metric title="Reservations in period" value={reservations.length} icon={<CalendarDays/>}/><Metric title="Booked room nights" value={nights} icon={<BedDouble/>}/><Metric title="Room revenue" value={money(roomRevenue)} icon={<Wallet/>}/><Metric title="Food & service" value={money(foodRevenue)} icon={<Utensils/>}/><Metric title="Net recorded charges" value={money(net)} icon={<CreditCard/>}/><Metric title="Net receipts" value={money(receipts-refunds)} icon={<Wallet/>}/><Metric title="Current occupancy" value={sellable?Math.round(occupied/sellable*100)+"%":"0%"} icon={<DoorOpen/>}/></div>
      <div className="panel"><div className="panel-head"><div><h2>Revenue & charges by category</h2><p>Based on folio items in the selected period.</p></div><button className="secondary" onClick={()=>exportCsv("sifobooks-charge-detail-"+reportFrom+"-to-"+reportTo+".csv",["Date","Folio","Type","Description","Quantity","Unit price","Amount"],periodItems.map(i=>[i.service_date||i.created_at,i.folio_id,i.item_type,i.description,i.quantity,i.unit_price,Number(i.amount||0).toFixed(2)]))}>Export charge detail</button></div>{table(["Category","Transactions","Total ZMW"],[["Room revenue",String(periodItems.filter(i=>i.item_type==="room_charge").length),money(roomRevenue)],["Food & beverage / service",String(periodItems.filter(i=>["food_beverage","service"].includes(i.item_type)).length),money(foodRevenue)],["Other charges",String(periodItems.filter(i=>!["room_charge","food_beverage","service","discount","tax"].includes(i.item_type)).length),money(otherRevenue)],["Tax charges",String(periodItems.filter(i=>i.item_type==="tax").length),money(taxes)],["Discounts",String(periodItems.filter(i=>i.item_type==="discount").length),money(discounts)],["Net recorded charges",String(periodItems.length),money(net)]])}</div>
      <div className="panel"><div className="panel-head"><h2>Payments by method</h2><button className="secondary" onClick={()=>exportCsv("sifobooks-payments-"+reportFrom+"-to-"+reportTo+".csv",["Payment number","Date","Type","Method","Status","Amount ZMW","Reference"],periodPayments.map(p=>[p.payment_number,p.received_at,p.payment_type,p.method,p.status,p.amount,p.reference]))}>Export payments CSV</button></div>{table(["Method","Transactions","Net amount ZMW"],paymentByMethod)}</div>
      <div className="panel"><div className="panel-head"><h2>Reservation status report</h2><button className="secondary" onClick={()=>exportCsv("sifobooks-reservations-"+reportFrom+"-to-"+reportTo+".csv",["Reservation","Guest","Room","Check in","Check out","Status","Nightly rate"],reservations.map(r=>[r.reservation_number,guestName(r.guest_id),roomName(r.room_id),r.check_in_date,r.check_out_date,r.status,r.nightly_rate]))}>Export reservations CSV</button></div>{table(["Status","Reservations","Checked-in count"],statuses)}</div>
      <div className="panel"><div className="panel-head"><h2>Daily audit history</h2><button className="secondary" onClick={()=>exportCsv("sifobooks-night-audits-"+reportFrom+"-to-"+reportTo+".csv",["Business date","Room revenue","Other revenue","Payments","Variance","Status"],data.night_audits.filter(a=>inPeriod(a.business_date)).map(a=>[a.business_date,a.room_revenue,a.other_revenue,a.payments_total,a.variance,a.status]))}>Export audit CSV</button></div>{table(["Business date","Room revenue","Other revenue","Payments","Cash variance","Status"],data.night_audits.filter(a=>inPeriod(a.business_date)).map(a=>[a.business_date,money(a.room_revenue),money(a.other_revenue),money(a.payments_total),money(a.variance),badge(a.status)]))}</div>
      <div className="alert">Reporting note: this is an operational revenue and receipt report, not a complete accounting Profit & Loss statement. Expenses, accruals and depreciation must be posted through the accounting ledger before net profit can be reported.</div></>;
      break;
    }
    case "staff":
      content = <><div className="panel"><h2>Add staff member</h2><p className="muted">Invite a new staff member by email or add an existing confirmed account. Access is limited to this hotel.</p>{submitForm(<>{field("staff_email", "Staff account email", "email")}{select("staff_role", "Role", [{value:"manager",label:"Manager"},{value:"receptionist",label:"Receptionist"},{value:"housekeeping",label:"Housekeeping"},{value:"laundry",label:"Laundry staff"},{value:"accountant",label:"Accountant"},{value:"pos_cashier",label:"POS Cashier"},{value:"bar_cashier",label:"Bar Cashier"},{value:"restaurant_cashier",label:"Restaurant Cashier"},{value:"maintenance",label:"Maintenance"},{value:"viewer",label:"Read-only viewer"}])}{submitButton("Grant hotel access")}</>)}</div><div className="panel"><h2>Staff access</h2>{table(["Email", "Role", "Access", "Action"], staff.map((m) => [m.email ?? m.user_id, m.role, badge(m.active ? "active" : "suspended"), m.role === "owner" ? "Property owner" : <button className={m.active ? "small danger" : "small"} onClick={() => toggleStaff(m)}>{m.active ? "Suspend access" : "Restore access"}</button>]))}</div></>;
      break;
    case "zra":
      content = <ZraPanel hotelId={hotel.id} role={membershipRole} />;
      break;
    case "documents":
      content = <DocumentsPanel hotel={hotel} guests={data.guests} reservations={data.reservations} rooms={data.rooms} roomTypes={data.room_types} folios={data.folios} folioItems={data.folio_items} payments={data.payments} />;
      break;
    case "daily_ops":
      content = <DailyOperationsPanel hotel={hotel} session={session} role={membershipRole} />;
      break;
    case "guest_portal":
      content = <GuestPortalAdmin hotel={hotel} />;
      break;
    case "inventory":
      content = <InventoryManagementPanel hotel={hotel} session={session} role={membershipRole} />;
      break;
    case "pos":
      content = <PosWorkspace hotel={hotel} session={session} role={membershipRole} />;
      break;
    case "printing_network":
      content = <PrintingNetworkPanel />;
      break;
    case "settings":
      content = <><div className="panel"><h2>Property settings</h2><p className="muted">Global defaults: configure your country, reporting currency, time zone and tax settings in Property Setup. Confirm local tax requirements before trading.</p>{submitForm(<>{field("name", "Hotel name", "text", true, {defaultValue:hotel.name})}{field("legal_name", "Registered legal name", "text", false, {defaultValue:hotel.legal_name ?? ""})}{field("email", "Business email", "email", false, {defaultValue:hotel.email ?? ""})}{field("phone", "Phone", "tel", false, {defaultValue:hotel.phone ?? ""})}{field("address", "Address", "text", false, {defaultValue:hotel.address ?? ""})}{field("city", "City", "text", false, {defaultValue:hotel.city ?? ""})}{field("tax_registration_number", "Tax registration number", "text", false, {defaultValue:hotel.tax_registration_number ?? ""})}{field("check_in_time", "Standard check-in time", "time", true, {defaultValue:hotel.check_in_time ?? "14:00"})}{field("check_out_time", "Standard check-out time", "time", true, {defaultValue:hotel.check_out_time ?? "10:00"})}{select("vat_enabled", "VAT enabled?", [{value:"false",label:"No"},{value:"true",label:"Yes"}], true)}{field("vat_rate", "VAT rate (%)", "number", true, {min:0,max:100,step:"0.01",defaultValue:String(hotel.vat_rate ?? 0)})}{submitButton("Save settings")}</>)}</div><div className="panel"><h2>Additional hotel locations</h2><p className="muted">Add branches in other towns under this hotel group. Each location is stored with its town, contact details and manager.</p>{submitForm(<><input type="hidden" name="kind" value="hotel_location"/>{field("location_name","Location / branch name")}{field("town","Town / city")}{field("location_address","Street address","text",false)}{field("location_phone","Location phone","tel",false)}{field("location_email","Location email","email",false)}{field("location_manager","Location manager","text",false)}{submitButton("Add location")}</>)}{table(["Branch","Town","Manager","Phone","Email","Status"],data.hotel_locations.map(l=>[l.location_name,l.town,l.manager_name||"—",l.phone||"—",l.email||"—",<select className="inline-select" aria-label={"Branch status "+l.location_name} value={l.active===false?"inactive":"active"} onChange={e=>void updatePropertyRecord("hotel_locations",l,{active:e.target.value==="active"},"Branch")}><option value="active">Active</option><option value="inactive">Inactive</option></select>,<button className="small danger" onClick={()=>void deletePropertyRecord("hotel_locations",l,"branch")}>Delete</button>]))}</div></>;
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
  return <div className="app-shell"><header className="app-header"><div className="app-brand-row"><div className="brand"><span className="brand-mark"><Hotel /></span><div><strong>SifoBooks</strong><small>Hotel Management</small></div></div><div className="app-header-right"><span className="property-chip">{hotel.name}</span><span className="user-chip">{session.user.email}</span><button className="secondary signout-button" onClick={() => requireSupabase().auth.signOut()}><LogOut size={16}/> Sign out</button></div></div><button type="button" className="mobile-menu-toggle" aria-expanded={mobileMenuOpen} aria-controls="hotel-module-menu" onClick={() => setMobileMenuOpen((open) => !open)}><span>{mobileMenuOpen ? "Close menu" : "Menu"}</span><span className="mobile-menu-count">{tabs.length} modules</span></button><nav id="hotel-module-menu" className={mobileMenuOpen ? "top-menu mobile-menu-open" : "top-menu"}>{tabs.filter((item) => { const allowed: Record<string, string[]> = { owner: tabs.map((t) => t.id), manager: tabs.filter((t) => t.id !== "staff").map((t) => t.id), pos_cashier: ["pos"], cashier: ["pos"], bar_cashier: ["pos"], restaurant_cashier: ["pos"], receptionist: ["overview","rooms","guests","reservations","folios"], housekeeping: ["overview","rooms","housekeeping","daily_ops"], laundry: ["overview","daily_ops"], accountant: ["overview","guests","reservations","folios","night_audit","reports","accounting","zra","daily_ops"], maintenance: ["overview","rooms","maintenance","daily_ops"], viewer: ["overview","reports","accounting"] }; const enabled = hotel.settings?.enabled_modules; const configurable = ["reservations","housekeeping","guest_portal","pos","inventory","accounting","maintenance","night_audit","daily_ops","printing_network","zra"]; return (allowed[membershipRole] ?? allowed.viewer).includes(item.id) && (item.id === "property_setup" || !Array.isArray(enabled) || !configurable.includes(item.id) || enabled.includes(item.id)); }).map((item) => <button key={item.id} title={item.label} className={tab === item.id ? "top-menu-item active" : "top-menu-item"} onClick={() => { setTab(item.id); setForm({}); setError(""); setNotice(""); setMobileMenuOpen(false); }}><item.icon size={17}/><span>{item.label}</span></button>)}</nav></header><main className="main"><header className="topbar"><div><span className="eyebrow">SIFOBOOKS HOTEL PMS</span><h1>{tabs.find((t) => t.id === tab)?.label}</h1><p>{hotel.city ? `${hotel.city}, ${hotel.country}` : hotel.country} · {hotel.currency_code} · {new Date().toLocaleDateString()}</p></div><button className="secondary" onClick={() => refresh()} disabled={loading}><RefreshCw size={16} className={loading ? "spin" : ""} />Refresh</button></header>{error && <div className="alert error">{error}<button onClick={() => setError("")}>×</button></div>}{notice && <div className="alert success">{notice}<button onClick={() => setNotice("")}>×</button></div>}{loading && <div className="loading-line">Syncing hotel records…</div>}{tab !== "overview" && <section className="page-intro"><div className="page-intro-mark">{(() => { const PageIcon = tabs.find((item) => item.id === tab)?.icon ?? Hotel; return <PageIcon size={23} />; })()}</div><div className="page-intro-copy"><div className="hero-kicker">PROPERTY WORKSPACE <span className="intro-dot">·</span> {today()}</div><h2>{tabs.find((item) => item.id === tab)?.label}</h2><p>{({rooms:"Manage room inventory, room types, rates and availability.",guests:"Keep guest contact details organised for a smooth arrival.",reservations:"Create bookings, manage the reservation book and process guest arrivals and departures.",housekeeping:"Coordinate room cleaning, inspections and task priorities.",folios:"Manage guest charges, balances, payments and printable receipts.",maintenance:"Track maintenance issues and protect rooms that cannot be sold.",night_audit:"Reconcile daily charges, receipts and cash before closing the business date.",reports:"Review property performance, revenue, room nights and daily audit history.",accounting:"Review double-entry postings, trial balance and profit-and-loss summaries.",staff:"Control staff access and assign permissions by hotel role.",settings:"Manage property details, operating times, currency, time zone and local tax settings.",property_setup:"Choose your property type, configure global settings and tailor your workspace modules.",printing_network:"Discover local Windows printers, check network details and send test text jobs to the Windows print spooler.",zra:"Configure hotel-specific ZRA Smart Invoice settings, connector pairing and submission history.",documents:"Print-ready hotel documents using the navy, gold and white SifoBooks design system.",inventory:"Manage suppliers, purchase orders, goods received, POS stock movements, stock counts, unit costs and inventory valuation.",daily_ops:"Update cleaning and laundry progress, record daily expenses, and manage opening and closing shift handovers.",guest_portal:"Download your hotel guest QR code, view incoming guest requests and manage messages."} as Record<string,string>)[tab]}</p></div><span className="intro-status"><span></span> HOTEL OPERATIONS</span></section>}{pageHighlights.length>0&&<section className="page-highlights">{pageHighlights.map((item)=><article className="page-highlight" key={item.label}><span>{item.label}</span><strong>{item.value}</strong><small>{item.note}</small></article>)}</section>}{content}<footer>Private hotel workspace · Row-level security enabled · {hotel.timezone}</footer></main></div>;
}

function Metric({ title, value, icon }: { title: string; value: ReactNode; icon: ReactNode }) {
  return <div className="metric"><span className="metric-icon">{icon}</span><span className="metric-label">{title}</span><strong>{value}</strong></div>;
}
