use super::*;
use std::{collections::VecDeque, io::Write, sync::OnceLock};
static LOGS: OnceLock<Mutex<VecDeque<String>>> = OnceLock::new();
pub static TUI: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn log(text: &str) {
    let clean: String = text
        .chars()
        .filter(|c| !c.is_control())
        .take(2000)
        .collect();
    let line = format!("{} {clean}", now());
    let mut logs = LOGS
        .get_or_init(|| Mutex::new(VecDeque::new()))
        .lock()
        .unwrap();
    if logs.len() >= 500 {
        logs.pop_front();
    }
    logs.push_back(line.clone());
    if let Ok(m) = std::fs::metadata(config::data("server.log")) {
        if m.len() > 10 * 1024 * 1024 {
            let _ = std::fs::remove_file(config::data("server.previous.log"));
            let _ = std::fs::rename(
                config::data("server.log"),
                config::data("server.previous.log"),
            );
        }
    }
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(config::data("server.log"))
    {
        let _ = writeln!(f, "{line}");
    }
    if !TUI.load(std::sync::atomic::Ordering::Relaxed) {
        println!("{line}")
    }
}
pub fn lines() -> Vec<String> {
    LOGS.get_or_init(|| Mutex::new(VecDeque::new()))
        .lock()
        .unwrap()
        .iter()
        .cloned()
        .collect()
}
pub async fn snapshot(a: &App) -> Result<Value> {
    for _ in 0..100 {
        let value = a.metrics.lock().unwrap().clone();
        if value.get("arch").is_some() {
            return Ok(value);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err(bad("System metrics are still initializing"))
}
pub fn start(a: App) {
    tokio::spawn(async move {
        let mut s = sysinfo::System::new();
        loop {
            s.refresh_memory();
            s.refresh_cpu_all();
            let value = json!({"os":sysinfo::System::long_os_version().unwrap_or_default(),"arch":std::env::consts::ARCH,"cpu":s.cpus().first().map(|c|c.brand()).unwrap_or("Unknown"),"cpu_threads":s.cpus().len(),"cpu_usage":s.global_cpu_usage(),"memory_total":s.total_memory(),"memory_used":s.used_memory(),"system_uptime":sysinfo::System::uptime(),"service_uptime":now()-a.started,"version":env!("CARGO_PKG_VERSION")});
            *a.metrics.lock().unwrap() = value;
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }
    });
}
fn size(path: impl AsRef<std::path::Path>) -> u64 {
    std::fs::metadata(path).map(|m| m.len()).unwrap_or(0)
}
pub async fn stats(a: &App) -> Result<Value> {
    let mut value = a.metrics.lock().unwrap().clone();
    if !value.is_object() {
        value = json!({})
    }
    for (key, sql) in [
        ("users", "SELECT COUNT(*) FROM users"),
        ("messages", "SELECT COUNT(*) FROM messages"),
        (
            "message_text_bytes",
            "SELECT COALESCE(SUM(length(CAST(body AS BLOB))),0) FROM messages",
        ),
        ("upload_bytes", "SELECT COALESCE(SUM(size),0) FROM files"),
        ("files", "SELECT COUNT(*) FROM files"),
        (
            "banned_users",
            "SELECT COUNT(*) FROM user_security WHERE banned=1",
        ),
    ] {
        value[key] = json!(sqlx::query_scalar::<_, i64>(sql).fetch_one(&a.db).await?);
    }
    value["database_bytes"] = json!(size(config::data("im.db")));
    value["wal_bytes"] = json!(size(config::data("im.db-wal")));
    let actual = std::fs::read_dir(config::data("uploads"))
        .map(|list| {
            list.filter_map(|x| x.ok())
                .filter_map(|x| x.metadata().ok())
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .sum::<u64>()
        })
        .unwrap_or(0);
    value["upload_disk_bytes"] = json!(actual);
    value["storage_bytes"] =
        json!(size(config::data("im.db")) + size(config::data("im.db-wal")) + actual);
    let connections = a.connections.lock().unwrap();
    value["online_users"] = json!(connections.len());
    value["connections"] = json!(connections.values().sum::<usize>());
    Ok(value)
}
pub async fn request_log(req: axum::extract::Request, next: axum::middleware::Next) -> Response {
    let method = req.method().to_string();
    let path = req.uri().path().to_owned();
    let start = std::time::Instant::now();
    let response = next.run(req).await;
    if path.starts_with("/api/") {
        log(&format!(
            "HTTP {method} {path} {} {}ms",
            response.status().as_u16(),
            start.elapsed().as_millis()
        ));
    }
    response
}
