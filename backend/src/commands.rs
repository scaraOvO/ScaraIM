use super::*;
use std::{future::Future, pin::Pin};
#[allow(dead_code)]
pub struct Context {
    pub user_id: String,
    pub admin: bool,
    pub local: bool,
}
pub type CommandFuture = Pin<Box<dyn Future<Output = Result<Value>> + std::marker::Send>>;
pub trait CommandPlugin: std::marker::Send + Sync {
    fn name(&self) -> &str;
    fn admin_only(&self) -> bool {
        false
    }
    fn execute(&self, a: App, ctx: Context, args: Vec<String>) -> CommandFuture;
}
#[derive(Deserialize)]
struct Manifest {
    id: String,
    command: String,
    #[serde(default)]
    admin_only: bool,
    response: Value,
}
struct Declarative(Manifest);
impl CommandPlugin for Declarative {
    fn name(&self) -> &str {
        &self.0.command
    }
    fn admin_only(&self) -> bool {
        self.0.admin_only
    }
    fn execute(&self, _a: App, _ctx: Context, _args: Vec<String>) -> CommandFuture {
        let value = self.0.response.clone();
        Box::pin(async move { Ok(value) })
    }
}
pub fn load() -> Vec<Arc<dyn CommandPlugin>> {
    let mut list: Vec<Arc<dyn CommandPlugin>> = vec![];
    if let Ok(files) = std::fs::read_dir(config::data("plugins")) {
        for file in files.flatten() {
            if file.path().extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let result = (|| {
                if file.metadata().ok()?.len() > 65536 {
                    return None;
                }
                serde_json::from_slice::<Manifest>(&std::fs::read(file.path()).ok()?).ok()
            })();
            match result {
                Some(m)
                    if !m.command.is_empty()
                        && m.command.len() <= 32
                        && m.command
                            .bytes()
                            .all(|c| c.is_ascii_lowercase() || c == b'-')
                        && !reserved().contains(&m.command.as_str())
                        && !list.iter().any(|p| p.name() == m.command) =>
                {
                    telemetry::log(&format!("PLUGIN loaded {} /{}", m.id, m.command));
                    list.push(Arc::new(Declarative(m)));
                }
                _ => telemetry::log("PLUGIN rejected invalid or duplicate manifest"),
            }
        }
    }
    list
}
fn reserved() -> Vec<&'static str> {
    vec![
        "help",
        "ping",
        "sysinfo",
        "stats",
        "users",
        "ban",
        "unban",
        "grantadmin",
        "setadmin",
        "revoke-sessions",
    ]
}
pub async fn execute(a: &App, uid: &str, line: &str, local: bool) -> Result<Value> {
    if line.len() > 2048 {
        return Err(bad("Command too long"));
    }
    let mut parts = line.trim().trim_start_matches('/').split_whitespace();
    let name = parts.next().unwrap_or("");
    let args: Vec<String> = parts.map(str::to_owned).collect();
    let elevated = local || admin::is_admin(a, uid).await?;
    telemetry::log(&format!(
        "COMMAND actor={} /{name}",
        if local { "local" } else { uid }
    ));
    match name {
        "ping" => Ok(json!({"command":"ping","reply":"pong","server_time":now()})),
        "help" => {
            let mut names = vec!["ping".to_owned(), "sysinfo".to_owned(), "help".to_owned()];
            if elevated {
                names.extend(
                    ["stats", "users", "ban", "unban", "revoke-sessions"]
                        .iter()
                        .map(|s| s.to_string()),
                );
            }
            if local {
                names.extend(["grantadmin".into(), "setadmin".into()])
            }
            names.extend(
                a.plugins
                    .iter()
                    .filter(|p| !p.admin_only() || elevated)
                    .map(|p| p.name().to_owned()),
            );
            Ok(json!({"commands":names}))
        }
        "sysinfo" => telemetry::snapshot(a).await,
        "stats" if elevated => telemetry::stats(a).await,
        "users" if elevated => {
            let rows = sqlx::query("SELECT id,username FROM users ORDER BY username LIMIT 100")
                .fetch_all(&a.db)
                .await?;
            Ok(json!(rows.iter().map(|r|json!({"id":r.get::<String,_>("id"),"username":r.get::<String,_>("username")})).collect::<Vec<_>>()))
        }
        "grantadmin" | "setadmin" if local => {
            if args.len() != 1 {
                return Err(bad("Usage: /setadmin username"));
            }
            admin::grant(a, args.first().ok_or(bad("Usage: /grantadmin username"))?).await?;
            Ok(json!({"ok":true}))
        }
        "ban" | "unban" | "revoke-sessions" if elevated => {
            let target = args.first().ok_or(bad("User ID required"))?;
            user(a, target).await?;
            if name == "ban" && (target == uid || admin::is_admin(a, target).await?) {
                return Err(bad("Cannot ban yourself or an administrator from commands"));
            }
            if name != "revoke-sessions" {
                sqlx::query("INSERT INTO user_security(user_id,banned) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET banned=excluded.banned").bind(target).bind(name=="ban").execute(&a.db).await?;
            }
            if name != "unban" {
                sqlx::query("DELETE FROM sessions WHERE user_id=?")
                    .bind(target)
                    .execute(&a.db)
                    .await?;
            }
            admin::audit(a, if local { "local-console" } else { uid }, name, target).await?;
            realtime::changed(a, target).await;
            Ok(json!({"ok":true}))
        }
        _ => {
            if let Some(plugin) = a.plugins.iter().find(|p| p.name() == name) {
                if plugin.admin_only() && !elevated {
                    return Err(Error(
                        StatusCode::FORBIDDEN,
                        "Administrator access required".into(),
                    ));
                }
                return tokio::time::timeout(
                    std::time::Duration::from_secs(5),
                    plugin.execute(
                        a.clone(),
                        Context {
                            user_id: uid.into(),
                            admin: elevated,
                            local,
                        },
                        args,
                    ),
                )
                .await
                .map_err(|_| bad("Plugin timed out"))?;
            }
            Err(bad("Unknown or unauthorized command; use /help"))
        }
    }
}
pub async fn list(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    Ok(Json(execute(&a, &uid, "/help", false).await?))
}
