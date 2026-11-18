mod admin;
mod commands;
mod config;
mod console;
mod realtime;
mod telemetry;
use argon2::{
    password_hash::{PasswordHash, SaltString},
    Argon2, PasswordHasher, PasswordVerifier,
};
use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use rand_core::OsRng;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::{sqlite::SqlitePoolOptions, Row, SqlitePool};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

#[derive(Clone)]
struct App {
    db: SqlitePool,
    attempts: Arc<Mutex<HashMap<String, (i64, u32)>>>,
    events: tokio::sync::broadcast::Sender<realtime::Event>,
    connections: Arc<Mutex<HashMap<String, usize>>>,
    metrics: Arc<Mutex<Value>>,
    started: i64,
    plugins: Arc<Vec<Arc<dyn commands::CommandPlugin>>>,
}
struct Error(StatusCode, String);
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error":self.1}))).into_response()
    }
}
impl From<sqlx::Error> for Error {
    fn from(e: sqlx::Error) -> Self {
        eprintln!("Database: {e}");
        Self(StatusCode::INTERNAL_SERVER_ERROR, "数据库操作失败".into())
    }
}
type Result<T> = std::result::Result<T, Error>;
fn bad(s: &str) -> Error {
    Error(StatusCode::BAD_REQUEST, s.into())
}
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}
fn id() -> String {
    Uuid::new_v4().to_string()
}
fn token(h: &HeaderMap) -> Option<String> {
    h.get(header::COOKIE)?
        .to_str()
        .ok()?
        .split(';')
        .find_map(|v| v.trim().strip_prefix("im_session=").map(str::to_owned))
}
async fn auth(a: &App, h: &HeaderMap) -> Result<String> {
    let t = token(h).ok_or(Error(StatusCode::UNAUTHORIZED, "请先登录".into()))?;
    sqlx::query_scalar::<_, String>("SELECT sessions.user_id FROM sessions JOIN users ON users.id=sessions.user_id LEFT JOIN user_security ON user_security.user_id=users.id WHERE token=? AND expires>? AND COALESCE(banned,0)=0")
        .bind(t)
        .bind(now())
        .fetch_optional(&a.db)
        .await?
        .ok_or(Error(StatusCode::UNAUTHORIZED, "登录已过期".into()))
}
async fn user(a: &App, uid: &str) -> Result<Value> {
    let r = sqlx::query(
        "SELECT id,username,nickname,avatar,banner,status,last_seen,badges FROM users WHERE id=?",
    )
    .bind(uid)
    .fetch_optional(&a.db)
    .await?
    .ok_or(bad("用户不存在"))?;
    let status: String = r.get("status");
    let mut result = json!({"id":r.get::<String,_>("id"),"username":r.get::<String,_>("username"),"nickname":r.get::<String,_>("nickname"),"avatar":r.get::<String,_>("avatar"),"banner":r.get::<String,_>("banner"),"status":if !a.connections.lock().unwrap().contains_key(uid) {"offline"} else {&status},"preferred_status":status,"badges":serde_json::from_str::<Value>(&r.get::<String,_>("badges")).unwrap_or(json!([]))});
    result["role"] = json!(if admin::is_admin(a, uid).await? {
        "admin"
    } else {
        "user"
    });
    result["badge_details"]=json!(sqlx::query("SELECT b.id,b.name,b.image FROM badge_defs b JOIN user_badges ub ON ub.badge_id=b.id WHERE ub.user_id=? ORDER BY b.id").bind(uid).fetch_all(&a.db).await?.iter().map(|r|json!({"id":r.get::<String,_>("id"),"name":r.get::<String,_>("name"),"image":r.get::<String,_>("image")})).collect::<Vec<_>>());
    Ok(result)
}
#[derive(Deserialize)]
struct Credentials {
    username: String,
    password: String,
    nickname: Option<String>,
}
async fn register(State(a): State<App>, Json(c): Json<Credentials>) -> Result<Response> {
    let name = c.username.trim().to_lowercase();
    if !(3..=32).contains(&name.len())
        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
    {
        return Err(bad("用户名需为 3–32 位字母、数字或下划线"));
    }
    if !(8..=128).contains(&c.password.len()) {
        return Err(bad("密码需为 8–128 字节"));
    }
    let nick = c.nickname.unwrap_or(name.clone()).trim().to_string();
    if nick.is_empty() || nick.chars().count() > 32 {
        return Err(bad("昵称需为 1–32 字"));
    }
    let hash = tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(c.password.as_bytes(), &SaltString::generate(&mut OsRng))
            .map(|h| h.to_string())
    })
    .await
    .map_err(|_| bad("密码处理失败"))?
    .map_err(|_| bad("密码处理失败"))?;
    let uid = id();
    let insert = sqlx::query("INSERT INTO users(id,username,password,nickname) VALUES(?,?,?,?)")
        .bind(&uid)
        .bind(name)
        .bind(hash)
        .bind(nick)
        .execute(&a.db)
        .await;
    if let Err(e) = insert {
        if e.as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            return Err(bad("用户名已被使用"));
        }
        return Err(e.into());
    }
    session(&a, &uid).await
}
async fn session(a: &App, uid: &str) -> Result<Response> {
    let t = format!("{}{}", id(), id());
    sqlx::query("INSERT INTO sessions VALUES(?,?,?)")
        .bind(&t)
        .bind(uid)
        .bind(now() + 604800)
        .execute(&a.db)
        .await?;
    sqlx::query("UPDATE users SET last_seen=? WHERE id=?")
        .bind(now())
        .bind(uid)
        .execute(&a.db)
        .await?;
    let secure = if std::env::var("COOKIE_SECURE").as_deref() == Ok("1") {
        "; Secure"
    } else {
        ""
    };
    Ok((
        [(
            header::SET_COOKIE,
            format!("im_session={t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800{secure}"),
        )],
        Json(user(a, uid).await?),
    )
        .into_response())
}
async fn login(State(a): State<App>, Json(c): Json<Credentials>) -> Result<Response> {
    let name = c.username.trim().to_lowercase();
    {
        let mut attempts = a.attempts.lock().unwrap();
        attempts.retain(|_, v| now() - v.0 < 300);
        let v = attempts.entry(name.clone()).or_insert((now(), 0));
        if v.1 >= 10 {
            return Err(Error(
                StatusCode::TOO_MANY_REQUESTS,
                "尝试过多，请五分钟后再试".into(),
            ));
        }
        v.1 += 1;
    }
    let r = sqlx::query("SELECT id,password FROM users WHERE username=?")
        .bind(&name)
        .fetch_optional(&a.db)
        .await?
        .ok_or(bad("用户名或密码错误"))?;
    let hash: String = r.get("password");
    let valid = tokio::task::spawn_blocking(move || {
        PasswordHash::new(&hash)
            .map(|h| {
                Argon2::default()
                    .verify_password(c.password.as_bytes(), &h)
                    .is_ok()
            })
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false);
    if !valid {
        return Err(bad("用户名或密码错误"));
    }
    let banned: i64 =
        sqlx::query_scalar("SELECT COALESCE(MAX(banned),0) FROM user_security WHERE user_id=?")
            .bind(r.get::<String, _>("id"))
            .fetch_one(&a.db)
            .await?;
    if banned != 0 {
        return Err(Error(StatusCode::FORBIDDEN, "Account suspended".into()));
    }
    a.attempts.lock().unwrap().remove(&name);
    session(&a, &r.get::<String, _>("id")).await
}
async fn logout(State(a): State<App>, h: HeaderMap) -> Result<Response> {
    let uid = auth(&a, &h).await?;
    sqlx::query("DELETE FROM sessions WHERE token=?")
        .bind(token(&h))
        .execute(&a.db)
        .await?;
    sqlx::query("UPDATE users SET last_seen=0 WHERE id=?")
        .bind(uid)
        .execute(&a.db)
        .await?;
    Ok((
        [(
            header::SET_COOKIE,
            "im_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
        )],
        Json(json!({"ok":true})),
    )
        .into_response())
}
async fn me(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    sqlx::query("UPDATE users SET last_seen=? WHERE id=?")
        .bind(now())
        .bind(&uid)
        .execute(&a.db)
        .await?;
    Ok(Json(user(&a, &uid).await?))
}
#[derive(Deserialize)]
struct Profile {
    nickname: String,
    avatar: String,
    banner: String,
    status: String,
}
async fn profile(
    State(a): State<App>,
    h: HeaderMap,
    Json(p): Json<Profile>,
) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    if p.nickname.trim().is_empty()
        || p.nickname.chars().count() > 32
        || !["online", "away", "busy", "offline"].contains(&p.status.as_str())
    {
        return Err(bad("昵称或状态无效"));
    }
    for media in [&p.avatar, &p.banner] {
        if !media.is_empty() {
            let fid = media
                .strip_prefix("/api/files/")
                .ok_or(bad("请上传头像或横幅"))?;
            let valid: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM files WHERE id=? AND (owner=? OR EXISTS(SELECT 1 FROM users WHERE users.id=? AND (avatar='/api/files/'||files.id OR banner='/api/files/'||files.id))) AND mime LIKE 'image/%'",
            )
            .bind(fid)
            .bind(&uid)
            .bind(&uid)
            .fetch_one(&a.db)
            .await?;
            if valid == 0 {
                return Err(bad("图片无效"));
            }
        }
    }
    sqlx::query("UPDATE users SET nickname=?,avatar=?,banner=?,status=? WHERE id=?")
        .bind(p.nickname.trim())
        .bind(p.avatar)
        .bind(p.banner)
        .bind(p.status)
        .bind(&uid)
        .execute(&a.db)
        .await?;
    realtime::changed(&a, &uid).await;
    Ok(Json(user(&a, &uid).await?))
}
async fn search(
    State(a): State<App>,
    h: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    let term = q.get("q").map(|s| s.trim()).unwrap_or("");
    if term.is_empty() {
        return Ok(Json(json!([])));
    }
    let ids = sqlx::query_scalar::<_, String>(
        "SELECT id FROM users WHERE id<>? AND (id=? OR username=? OR nickname LIKE ?) LIMIT 30",
    )
    .bind(uid)
    .bind(term)
    .bind(term.to_lowercase())
    .bind(format!("%{term}%"))
    .fetch_all(&a.db)
    .await?;
    let mut list = vec![];
    for i in ids {
        list.push(user(&a, &i).await?);
    }
    Ok(Json(json!(list)))
}
async fn friends(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    let rows = sqlx::query("SELECT friend,remark FROM friends WHERE owner=?")
        .bind(&uid)
        .fetch_all(&a.db)
        .await?;
    let mut list = vec![];
    for r in rows {
        let fid: String = r.get("friend");
        let mut u = user(&a, &fid).await?;
        u["remark"] = json!(r.get::<String, _>("remark"));
        let last=sqlx::query("SELECT body,kind,created FROM messages WHERE (sender=? AND receiver=?) OR (sender=? AND receiver=?) ORDER BY created DESC,id DESC LIMIT 1").bind(&uid).bind(&fid).bind(&fid).bind(&uid).fetch_optional(&a.db).await?;
        if let Some(m) = last {
            u["last"] = json!({"body":m.get::<String,_>("body"),"kind":m.get::<String,_>("kind"),"created":m.get::<i64,_>("created")});
        }
        u["unread"] = json!(
            sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM messages WHERE sender=? AND receiver=? AND seen=0"
            )
            .bind(&fid)
            .bind(&uid)
            .fetch_one(&a.db)
            .await?
        );
        list.push(u);
    }
    Ok(Json(json!(list)))
}
async fn add_friend(
    State(a): State<App>,
    h: HeaderMap,
    Path(fid): Path<String>,
) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    if uid == fid {
        return Err(bad("不能添加自己"));
    }
    user(&a, &fid).await?;
    let mut tx = a.db.begin().await?;
    for (x, y) in [(&uid, &fid), (&fid, &uid)] {
        sqlx::query("INSERT OR IGNORE INTO friends(owner,friend) VALUES(?,?)")
            .bind(x)
            .bind(y)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    realtime::emit(
        &a,
        vec![uid.clone(), fid.clone()],
        json!({"type":"friends_changed"}),
    );
    Ok(Json(json!({"ok":true})))
}
async fn remove_friend(
    State(a): State<App>,
    h: HeaderMap,
    Path(fid): Path<String>,
) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    sqlx::query("DELETE FROM friends WHERE (owner=? AND friend=?) OR (owner=? AND friend=?)")
        .bind(&uid)
        .bind(&fid)
        .bind(&fid)
        .bind(&uid)
        .execute(&a.db)
        .await?;
    realtime::emit(
        &a,
        vec![uid.clone(), fid.clone()],
        json!({"type":"friends_changed"}),
    );
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct Remark {
    remark: String,
}
async fn remark(
    State(a): State<App>,
    h: HeaderMap,
    Path(fid): Path<String>,
    Json(r): Json<Remark>,
) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    if r.remark.chars().count() > 64 {
        return Err(bad("备注最多64字"));
    }
    sqlx::query("UPDATE friends SET remark=? WHERE owner=? AND friend=?")
        .bind(r.remark)
        .bind(&uid)
        .bind(&fid)
        .execute(&a.db)
        .await?;
    realtime::emit(&a, vec![uid], json!({"type":"friends_changed"}));
    Ok(Json(json!({"ok":true})))
}
fn message(r: &sqlx::sqlite::SqliteRow) -> Value {
    json!({"id":r.get::<i64,_>("id"),"sender":r.get::<String,_>("sender"),"receiver":r.get::<String,_>("receiver"),"kind":r.get::<String,_>("kind"),"body":r.get::<String,_>("body"),"file_id":r.get::<Option<String>,_>("file_id"),"forwarded":r.get::<i64,_>("forwarded")==1,"created":r.get::<i64,_>("created"),"seen":r.get::<i64,_>("seen")==1})
}
async fn history(
    State(a): State<App>,
    h: HeaderMap,
    Path(fid): Path<String>,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    let before = q
        .get("before")
        .and_then(|x| x.parse::<i64>().ok())
        .unwrap_or(i64::MAX);
    let rows=sqlx::query("SELECT * FROM messages WHERE ((sender=? AND receiver=?) OR (sender=? AND receiver=?)) AND id<? ORDER BY id DESC LIMIT 100").bind(&uid).bind(&fid).bind(&fid).bind(&uid).bind(before).fetch_all(&a.db).await?;
    Ok(Json(json!(rows
        .iter()
        .rev()
        .map(message)
        .collect::<Vec<_>>())))
}
async fn read_messages(
    State(a): State<App>,
    h: HeaderMap,
    Path(fid): Path<String>,
) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    sqlx::query("UPDATE messages SET seen=1 WHERE sender=? AND receiver=?")
        .bind(&fid)
        .bind(&uid)
        .execute(&a.db)
        .await?;
    realtime::emit(
        &a,
        vec![uid.clone(), fid.clone()],
        json!({"type":"read","reader":uid,"peer":fid}),
    );
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
struct Send {
    body: Option<String>,
    file_id: Option<String>,
    forward_id: Option<i64>,
}
async fn send(
    State(a): State<App>,
    h: HeaderMap,
    Path(fid): Path<String>,
    Json(p): Json<Send>,
) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    let exists: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM friends WHERE owner=? AND friend=?")
        .bind(&uid)
        .bind(&fid)
        .fetch_one(&a.db)
        .await?;
    if exists == 0 {
        return Err(bad("请先添加好友"));
    }
    let (body, kind, file, forwarded) = if let Some(mid) = p.forward_id {
        let r = sqlx::query("SELECT * FROM messages WHERE id=? AND (sender=? OR receiver=?)")
            .bind(mid)
            .bind(&uid)
            .bind(&uid)
            .fetch_optional(&a.db)
            .await?
            .ok_or(bad("无法转发该消息"))?;
        (
            r.get::<String, _>("body"),
            r.get::<String, _>("kind"),
            r.get::<Option<String>, _>("file_id"),
            1,
        )
    } else if let Some(file) = p.file_id {
        let r = sqlx::query("SELECT name,mime FROM files WHERE id=? AND owner=?")
            .bind(&file)
            .bind(&uid)
            .fetch_optional(&a.db)
            .await?
            .ok_or(bad("附件无效"))?;
        (
            r.get::<String, _>("name"),
            if r.get::<String, _>("mime").starts_with("image/") {
                "image"
            } else {
                "file"
            }
            .into(),
            Some(file),
            0,
        )
    } else {
        let body = p.body.unwrap_or_default().trim().to_string();
        if body.is_empty() || body.len() > 16000 {
            return Err(bad("消息不能为空或超过16000字节"));
        }
        (body, "text".into(), None, 0)
    };
    let result=sqlx::query("INSERT INTO messages(sender,receiver,body,kind,file_id,forwarded,created) VALUES(?,?,?,?,?,?,?)").bind(&uid).bind(&fid).bind(body).bind(kind).bind(file).bind(forwarded).bind(now()).execute(&a.db).await?;
    let data = message(
        &sqlx::query("SELECT * FROM messages WHERE id=?")
            .bind(result.last_insert_rowid())
            .fetch_one(&a.db)
            .await?,
    );
    realtime::emit(&a, vec![uid, fid], json!({"type":"message","message":data}));
    Ok(Json(data))
}
async fn upload(State(a): State<App>, h: HeaderMap, mut form: Multipart) -> Result<Json<Value>> {
    let uid = auth(&a, &h).await?;
    let field = form
        .next_field()
        .await
        .map_err(|_| bad("上传失败，最大20MB"))?
        .ok_or(bad("请选择文件"))?;
    let name = field
        .file_name()
        .unwrap_or("file")
        .chars()
        .filter(|c| !c.is_control() && *c != '/' && *c != '\\')
        .take(180)
        .collect::<String>();
    let bytes = field.bytes().await.map_err(|_| bad("上传失败，最大20MB"))?;
    if bytes.len() > 20 * 1024 * 1024 {
        return Err(bad("文件不能超过20MB"));
    }
    let mime = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        "image/jpeg"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        "image/webp"
    } else {
        "application/octet-stream"
    };
    let fid = id();
    tokio::fs::write(config::data("uploads").join(&fid), &bytes)
        .await
        .map_err(|_| bad("文件保存失败"))?;
    sqlx::query("INSERT INTO files VALUES(?,?,?,?,?)")
        .bind(&fid)
        .bind(uid)
        .bind(name)
        .bind(mime)
        .bind(bytes.len() as i64)
        .execute(&a.db)
        .await?;
    Ok(Json(
        json!({"id":fid,"url":format!("/api/files/{fid}"),"mime":mime}),
    ))
}
async fn download(State(a): State<App>, h: HeaderMap, Path(fid): Path<String>) -> Result<Response> {
    let uid = auth(&a, &h).await?;
    let r=sqlx::query("SELECT * FROM files WHERE id=? AND (owner=? OR EXISTS(SELECT 1 FROM messages WHERE file_id=files.id AND (sender=? OR receiver=?)) OR EXISTS(SELECT 1 FROM users WHERE avatar=? OR banner=?) OR EXISTS(SELECT 1 FROM badge_defs WHERE image='/api/files/'||files.id))").bind(&fid).bind(&uid).bind(&uid).bind(&uid).bind(format!("/api/files/{fid}")).bind(format!("/api/files/{fid}")).fetch_optional(&a.db).await?.ok_or(Error(StatusCode::NOT_FOUND,"文件不存在或无权访问".into()))?;
    let bytes = tokio::fs::read(config::data("uploads").join(&fid))
        .await
        .map_err(|_| bad("文件丢失"))?;
    let mime: String = r.get("mime");
    let disposition = if mime.starts_with("image/") {
        "inline"
    } else {
        "attachment"
    };
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CONTENT_DISPOSITION, disposition.into()),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".into()),
            (header::CACHE_CONTROL, "private, no-store".into()),
        ],
        bytes,
    )
        .into_response())
}
#[tokio::main]
async fn main() {
    let config = match config::Config::read() {
        Ok(Some(c)) => c,
        Ok(None) => return,
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2);
        }
    };
    tokio::fs::create_dir_all(config::data("uploads"))
        .await
        .expect("Cannot create data directory");
    let db = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(
            sqlx::sqlite::SqliteConnectOptions::new()
                .filename(config::data("im.db"))
                .create_if_missing(true)
                .busy_timeout(std::time::Duration::from_secs(10)),
        )
        .await
        .unwrap();
    sqlx::raw_sql(include_str!("schema.sql"))
        .execute(&db)
        .await
        .unwrap();
    let state = App {
        db,
        attempts: Default::default(),
        events: tokio::sync::broadcast::channel(1024).0,
        connections: Default::default(),
        metrics: Arc::new(Mutex::new(json!({}))),
        started: now(),
        plugins: Arc::new(commands::load()),
    };
    if let Some(username) = &config.admin {
        match admin::grant(&state, username).await {
            Ok(()) => println!("Administrator granted: {username}"),
            Err(e) => {
                eprintln!("{}", e.1);
                std::process::exit(1)
            }
        }
        return;
    }
    telemetry::start(state.clone());
    if let Some(command) = &config.command {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        match commands::execute(&state, "local-console", command, true).await {
            Ok(v) => println!("{v}"),
            Err(e) => {
                eprintln!("{}", e.1);
                std::process::exit(1)
            }
        }
        return;
    }
    let app = Router::new()
        .merge(admin::routes())
        .route("/api/commands", get(commands::list))
        .route("/api/ws", get(realtime::upgrade))
        .route("/api/register", post(register))
        .route("/api/login", post(login))
        .route("/api/logout", post(logout))
        .route("/api/me", get(me).patch(profile))
        .route("/api/users", get(search))
        .route("/api/friends", get(friends))
        .route(
            "/api/friends/{id}",
            post(add_friend).delete(remove_friend).patch(remark),
        )
        .route("/api/messages/{id}", get(history).post(send))
        .route("/api/messages/{id}/read", post(read_messages))
        .route("/api/upload", post(upload))
        .route("/api/files/{id}", get(download))
        .layer(DefaultBodyLimit::max(21 * 1024 * 1024))
        .with_state(state.clone())
        .layer(axum::middleware::from_fn(telemetry::request_log))
        .fallback_service({
            let dir = &config.frontend;
            ServeDir::new(dir).not_found_service(ServeFile::new(dir.join("index.html")))
        });
    let addr = config.bind;
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    telemetry::log(&format!("ScaraIM: http://{addr}"));
    if config.tui
        && std::io::IsTerminal::is_terminal(&std::io::stdin())
        && std::io::IsTerminal::is_terminal(&std::io::stdout())
    {
        let handle = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            if let Err(e) = console::run(state, handle) {
                telemetry::log(&format!("TUI error: {e}"))
            }
        });
    }
    axum::serve(listener, app)
        .with_graceful_shutdown(async {
            #[cfg(unix)]
            {
                let mut term =
                    tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                        .expect("SIGTERM handler");
                tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = term.recv() => {} }
            }
            #[cfg(not(unix))]
            let _ = tokio::signal::ctrl_c().await;
            console::STOP.store(true, std::sync::atomic::Ordering::Relaxed);
            telemetry::log("Server stopping");
        })
        .await
        .unwrap();
}
