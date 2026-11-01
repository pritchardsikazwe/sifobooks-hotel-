use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::{fs, path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use uuid::Uuid;
struct LocalStore(Mutex<Connection>);
#[derive(Serialize)]
struct LocalCompany { id:String,name:String,business_type:String,country:String,currency_code:String,timezone:String,created_at:String }
#[derive(Serialize)]
struct LocalStatus { mode:&'static str,database:&'static str,company_count:i64,sync_mode:&'static str }
fn database_path(app:&tauri::AppHandle)->Result<PathBuf,String>{let mut dir=app.path().app_data_dir().map_err(|e|e.to_string())?;fs::create_dir_all(&dir).map_err(|e|e.to_string())?;dir.push("sifobooks-hotel.sqlite3");Ok(dir)}
fn initialise(conn:&Connection)->Result<(),String>{
 conn.pragma_update(None,"journal_mode","WAL").map_err(|e|e.to_string())?;
 conn.pragma_update(None,"foreign_keys","ON").map_err(|e|e.to_string())?;
 conn.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e|e.to_string())?;
 conn.execute_batch("CREATE TABLE IF NOT EXISTS local_schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS local_companies(id TEXT PRIMARY KEY,name TEXT NOT NULL,business_type TEXT NOT NULL,country TEXT NOT NULL,currency_code TEXT NOT NULL,timezone TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS local_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS local_records(collection TEXT NOT NULL,id TEXT NOT NULL,company_id TEXT NOT NULL,payload_json TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT,PRIMARY KEY(collection,id));
 CREATE INDEX IF NOT EXISTS idx_local_records_company ON local_records(company_id,collection,updated_at);
 CREATE TABLE IF NOT EXISTS sync_outbox(id TEXT PRIMARY KEY,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,operation TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,synced_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT);
 CREATE INDEX IF NOT EXISTS idx_sync_outbox_pending ON sync_outbox(synced_at,created_at);
 INSERT OR IGNORE INTO local_schema_migrations(version,applied_at) VALUES(1,datetime('now'));").map_err(|e|e.to_string())
}
#[tauri::command]
fn local_runtime_status(store:State<'_,LocalStore>)->Result<LocalStatus,String>{let c=store.0.lock().map_err(|_|"Local database lock failed".to_string())?;let n=c.query_row("SELECT COUNT(*) FROM local_companies",[],|r|r.get(0)).map_err(|e|e.to_string())?;Ok(LocalStatus{mode:"standalone-local",database:"sqlite-wal",company_count:n,sync_mode:"optional-cloud-pending"})}
#[tauri::command]
fn local_list_companies(store:State<'_,LocalStore>)->Result<Vec<LocalCompany>,String>{let c=store.0.lock().map_err(|_|"Local database lock failed".to_string())?;let mut s=c.prepare("SELECT id,name,business_type,country,currency_code,timezone,created_at FROM local_companies ORDER BY created_at").map_err(|e|e.to_string())?;let rows=s.query_map([],|r|Ok(LocalCompany{id:r.get(0)?,name:r.get(1)?,business_type:r.get(2)?,country:r.get(3)?,currency_code:r.get(4)?,timezone:r.get(5)?,created_at:r.get(6)?})).map_err(|e|e.to_string())?;rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())}
#[tauri::command]
fn local_create_company(name:String,business_type:String,country:String,currency_code:String,timezone:String,store:State<'_,LocalStore>)->Result<LocalCompany,String>{
 let name=name.trim().to_string();let business_type=business_type.trim().to_string();let country=country.trim().to_string();let currency_code=currency_code.trim().to_uppercase();let timezone=timezone.trim().to_string();
 if name.is_empty()||name.len()>160{return Err("Enter a company name between 1 and 160 characters.".into())}
 if !["hotel","lodge","guest_house","resort","serviced_apartment","boutique_stay"].contains(&business_type.as_str()){return Err("Select a supported hotel business type.".into())}
 if country.is_empty()||country.len()>80{return Err("Enter a valid country.".into())}
 if currency_code.len()!=3||!currency_code.chars().all(|c|c.is_ascii_uppercase()){return Err("Currency must be a three-letter ISO code.".into())}
 if timezone.is_empty()||timezone.len()>80{return Err("Enter a valid IANA time zone.".into())}
 let id=Uuid::new_v4().to_string();let created_at=Utc::now().to_rfc3339();let mut c=store.0.lock().map_err(|_|"Local database lock failed".to_string())?;let tx=c.transaction().map_err(|e|e.to_string())?;
 let exists:Option<String>=tx.query_row("SELECT id FROM local_companies WHERE lower(name)=lower(?1) LIMIT 1",params![name],|r|r.get(0)).optional().map_err(|e|e.to_string())?;if exists.is_some(){return Err("A company with this name already exists on this installation.".into())}
 tx.execute("INSERT INTO local_companies VALUES(?1,?2,?3,?4,?5,?6,?7)",params![id,name,business_type,country,currency_code,timezone,created_at]).map_err(|e|e.to_string())?;
 let company=LocalCompany{id:id.clone(),name,business_type,country,currency_code,timezone,created_at:created_at.clone()};let payload=serde_json::to_string(&company).map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO sync_outbox(id,entity_type,entity_id,operation,payload_json,created_at) VALUES(?1,'company',?2,'upsert',?3,?4)",params![Uuid::new_v4().to_string(),id,payload,created_at]).map_err(|e|e.to_string())?;tx.commit().map_err(|e|e.to_string())?;Ok(company)
}

fn valid_collection(value:&str)->bool {
 ["room_types","rooms","guests","reservations","folios","folio_items","payments","housekeeping_tasks","maintenance_requests","night_audits","hotel_maintenance_work_logs","hotel_locations","hotel_daily_expenses","hotel_pos_sales","hotel_pos_sale_items","hotel_pos_inventory","hotel_cash_declarations","hotel_event_bookings","hotel_staff","hotel_settings","accounting_journals","accounting_journal_lines","inventory_items","suppliers","purchase_orders"].contains(&value)
}
#[tauri::command]
fn local_list_records(collection:String,company_id:String,store:State<'_,LocalStore>)->Result<Vec<serde_json::Value>,String>{
 if !valid_collection(&collection){return Err("Unsupported local collection.".into())}
 if company_id.trim().is_empty(){return Err("A company ID is required.".into())}
 let c=store.0.lock().map_err(|_|"Local database lock failed".to_string())?;
 let mut s=c.prepare("SELECT payload_json FROM local_records WHERE collection=?1 AND company_id=?2 AND deleted_at IS NULL ORDER BY updated_at DESC").map_err(|e|e.to_string())?;
 let rows=s.query_map(params![collection,company_id],|r|r.get::<_,String>(0)).map_err(|e|e.to_string())?;
 let mut result=Vec::new();for row in rows{let raw=row.map_err(|e|e.to_string())?;result.push(serde_json::from_str(&raw).map_err(|e|e.to_string())?);}Ok(result)
}
#[tauri::command]
fn local_upsert_record(collection:String,company_id:String,record:serde_json::Value,store:State<'_,LocalStore>)->Result<serde_json::Value,String>{
 if !valid_collection(&collection){return Err("Unsupported local collection.".into())}
 if company_id.trim().is_empty(){return Err("A company ID is required.".into())}
 let id=record.get("id").and_then(|v|v.as_str()).filter(|v|!v.trim().is_empty()).map(str::to_owned).unwrap_or_else(||Uuid::new_v4().to_string());
 let mut value=record;if let Some(object)=value.as_object_mut(){object.insert("id".into(),id.clone().into());object.insert("company_id".into(),company_id.clone().into());}
 let now=Utc::now().to_rfc3339();let payload=serde_json::to_string(&value).map_err(|e|e.to_string())?;
 let mut c=store.0.lock().map_err(|_|"Local database lock failed".to_string())?;let tx=c.transaction().map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO local_records(collection,id,company_id,payload_json,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,NULL) ON CONFLICT(collection,id) DO UPDATE SET company_id=excluded.company_id,payload_json=excluded.payload_json,updated_at=excluded.updated_at,deleted_at=NULL",params![collection,id,company_id,payload,now]).map_err(|e|e.to_string())?;
 tx.execute("INSERT INTO sync_outbox(id,entity_type,entity_id,operation,payload_json,created_at) VALUES(?1,?2,?3,'upsert',?4,?5)",params![Uuid::new_v4().to_string(),collection,id,serde_json::to_string(&value).map_err(|e|e.to_string())?,now]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())?;Ok(value)
}
#[tauri::command]
fn local_delete_record(collection:String,company_id:String,record_id:String,store:State<'_,LocalStore>)->Result<(),String>{
 if !valid_collection(&collection){return Err("Unsupported local collection.".into())}
 let now=Utc::now().to_rfc3339();let mut c=store.0.lock().map_err(|_|"Local database lock failed".to_string())?;let tx=c.transaction().map_err(|e|e.to_string())?;
 let changed=tx.execute("UPDATE local_records SET deleted_at=?1,updated_at=?1 WHERE collection=?2 AND company_id=?3 AND id=?4 AND deleted_at IS NULL",params![now,collection,company_id,record_id]).map_err(|e|e.to_string())?;
 if changed==0{return Err("Record not found in this company.".into())}
 let event=serde_json::json!({"id":record_id,"company_id":company_id});
 tx.execute("INSERT INTO sync_outbox(id,entity_type,entity_id,operation,payload_json,created_at) VALUES(?1,?2,?3,'delete',?4,?5)",params![Uuid::new_v4().to_string(),collection,record_id,event.to_string(),now]).map_err(|e|e.to_string())?;
 tx.commit().map_err(|e|e.to_string())?;Ok(())
}

pub fn run(){tauri::Builder::default().setup(|app|{let path=database_path(&app.handle()).map_err(std::io::Error::other)?;let conn=Connection::open(path).map_err(std::io::Error::other)?;initialise(&conn).map_err(std::io::Error::other)?;app.manage(LocalStore(Mutex::new(conn)));Ok(())}).invoke_handler(tauri::generate_handler![local_runtime_status,local_list_companies,local_create_company,local_list_records,local_upsert_record,local_delete_record]).run(tauri::generate_context!()).expect("error while running SifoBooks Hotel");}
