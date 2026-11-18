use super::*;

pub async fn require(a: &App, h: &HeaderMap) -> Result<String> {
    let uid = auth(a, h).await?;
    if !is_admin(a, &uid).await? {
        return Err(Error(
            StatusCode::FORBIDDEN,
            "Administrator access required".into(),
        ));
    }
    Ok(uid)
}
pub async fn is_admin(a: &App, uid: &str) -> Result<bool> {
    Ok(sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM user_security WHERE user_id=? AND role='admin' AND banned=0",
    )
    .bind(uid)
    .fetch_one(&a.db)
    .await?
        > 0)
}
pub async fn audit(a: &App, actor: &str, action: &str, target: &str) -> Result<()> {
    sqlx::query("INSERT INTO audit(actor,action,target,created) VALUES(?,?,?,?)")
        .bind(actor)
        .bind(action)
        .bind(target)
        .bind(now())
        .execute(&a.db)
        .await?;
    telemetry::log(&format!("ADMIN {actor} {action} {target}"));
    Ok(())
}
pub async fn grant(a: &App, username: &str) -> Result<()> {
    let uid = sqlx::query_scalar::<_, String>("SELECT id FROM users WHERE username=?")
        .bind(username.trim().to_lowercase())
        .fetch_optional(&a.db)
        .await?
        .ok_or(bad("User not found"))?;
    sqlx::query("INSERT INTO user_security(user_id,role) VALUES(?,'admin') ON CONFLICT(user_id) DO UPDATE SET role='admin',banned=0").bind(&uid).execute(&a.db).await?;
    audit(a, "local-console", "grant-admin", &uid).await
}
pub async fn stats(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    require(&a, &h).await?;
    Ok(Json(telemetry::stats(&a).await?))
}
pub async fn logs(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    require(&a, &h).await?;
    let rows = sqlx::query("SELECT * FROM audit ORDER BY id DESC LIMIT 200")
        .fetch_all(&a.db)
        .await?;
    Ok(Json(
        json!({"logs":telemetry::lines(),"audit":rows.iter().map(|r|json!({"id":r.get::<i64,_>("id"),"actor":r.get::<String,_>("actor"),"action":r.get::<String,_>("action"),"target":r.get::<String,_>("target"),"created":r.get::<i64,_>("created")})).collect::<Vec<_>>()}),
    ))
}
pub async fn users(
    State(a): State<App>,
    h: HeaderMap,
    Query(q): Query<HashMap<String, String>>,
) -> Result<Json<Value>> {
    require(&a, &h).await?;
    let term = q.get("q").cloned().unwrap_or_default();
    let page = q
        .get("page")
        .and_then(|x| x.parse::<i64>().ok())
        .unwrap_or(0)
        .clamp(0, 1000000);
    let pattern = format!("%{term}%");
    let ids=sqlx::query_scalar::<_,String>("SELECT id FROM users WHERE id LIKE ? OR username LIKE ? OR nickname LIKE ? ORDER BY username LIMIT 50 OFFSET ?").bind(&pattern).bind(&pattern).bind(&pattern).bind(page*50).fetch_all(&a.db).await?;
    let total: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM users WHERE id LIKE ? OR username LIKE ? OR nickname LIKE ?",
    )
    .bind(&pattern)
    .bind(&pattern)
    .bind(&pattern)
    .fetch_one(&a.db)
    .await?;
    let mut list = vec![];
    for uid in ids {
        let mut u = user(&a, &uid).await?;
        let r = sqlx::query("SELECT role,banned,reason FROM user_security WHERE user_id=?")
            .bind(&uid)
            .fetch_optional(&a.db)
            .await?;
        if let Some(r) = r {
            u["role"] = json!(r.get::<String, _>("role"));
            u["banned"] = json!(r.get::<i64, _>("banned") == 1);
            u["reason"] = json!(r.get::<String, _>("reason"));
        }
        list.push(u)
    }
    Ok(Json(json!({"users":list,"total":total})))
}
pub async fn create(
    State(a): State<App>,
    h: HeaderMap,
    Json(c): Json<Credentials>,
) -> Result<Json<Value>> {
    let actor = require(&a, &h).await?;
    let username = c.username.trim().to_lowercase();
    // Reuse the validated registration path, discarding its session cookie.
    register(State(a.clone()), Json(c)).await?;
    let uid: String = sqlx::query_scalar("SELECT id FROM users WHERE username=?")
        .bind(username)
        .fetch_one(&a.db)
        .await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=?")
        .bind(&uid)
        .execute(&a.db)
        .await?;
    audit(&a, &actor, "create-user", &uid).await?;
    Ok(Json(user(&a, &uid).await?))
}
#[derive(Deserialize)]
pub struct Edit {
    username: String,
    nickname: String,
    avatar: String,
    banner: String,
    status: String,
    role: String,
    banned: bool,
    #[serde(default)]
    reason: String,
    password: Option<String>,
}
pub async fn edit(
    State(a): State<App>,
    h: HeaderMap,
    Path(uid): Path<String>,
    Json(p): Json<Edit>,
) -> Result<Json<Value>> {
    let actor = require(&a, &h).await?;
    let name = p.username.trim().to_lowercase();
    if !(3..=32).contains(&name.len())
        || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        || p.nickname.trim().is_empty()
        || p.nickname.chars().count() > 32
        || !["admin", "user"].contains(&p.role.as_str())
        || !["online", "away", "busy", "offline"].contains(&p.status.as_str())
        || p.reason.len() > 1000
    {
        return Err(bad("Invalid user fields"));
    }
    if uid == actor && (p.banned || p.role != "admin") {
        return Err(bad("Cannot ban or demote yourself"));
    }
    user(&a, &uid).await?;
    for media in [&p.avatar, &p.banner] {
        if !media.is_empty() {
            let valid: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM files WHERE '/api/files/'||id=? AND mime LIKE 'image/%'",
            )
            .bind(media)
            .fetch_one(&a.db)
            .await?;
            if valid == 0 {
                return Err(bad("Invalid image"));
            }
        }
    }
    let hash = if let Some(password) = p.password.filter(|s| !s.is_empty()) {
        if !(8..=128).contains(&password.len()) {
            return Err(bad("Password must be 8–128 bytes"));
        }
        Some(
            tokio::task::spawn_blocking(move || {
                Argon2::default()
                    .hash_password(password.as_bytes(), &SaltString::generate(&mut OsRng))
                    .map(|h| h.to_string())
            })
            .await
            .map_err(|_| bad("Password error"))?
            .map_err(|_| bad("Password error"))?,
        )
    } else {
        None
    };
    let mut tx = a.db.begin().await?;
    let result =
        sqlx::query("UPDATE users SET username=?,nickname=?,avatar=?,banner=?,status=? WHERE id=?")
            .bind(name)
            .bind(p.nickname.trim())
            .bind(p.avatar)
            .bind(p.banner)
            .bind(p.status)
            .bind(&uid)
            .execute(&mut *tx)
            .await;
    if let Err(e) = result {
        if e.as_database_error()
            .is_some_and(|e| e.is_unique_violation())
        {
            return Err(bad("Username already exists"));
        }
        return Err(e.into());
    }
    sqlx::query("INSERT INTO user_security(user_id,role,banned,reason) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET role=excluded.role,banned=excluded.banned,reason=excluded.reason").bind(&uid).bind(p.role).bind(p.banned).bind(p.reason).execute(&mut *tx).await?;
    if let Some(ref hash) = hash {
        sqlx::query("UPDATE users SET password=? WHERE id=?")
            .bind(hash)
            .bind(&uid)
            .execute(&mut *tx)
            .await?;
    }
    if p.banned || hash.is_some() {
        sqlx::query("DELETE FROM sessions WHERE user_id=?")
            .bind(&uid)
            .execute(&mut *tx)
            .await?;
    }
    tx.commit().await?;
    audit(&a, &actor, "edit-user", &uid).await?;
    realtime::changed(&a, &uid).await;
    Ok(Json(user(&a, &uid).await?))
}
pub async fn delete(
    State(a): State<App>,
    h: HeaderMap,
    Path(uid): Path<String>,
) -> Result<Json<Value>> {
    let actor = require(&a, &h).await?;
    if actor == uid {
        return Err(bad("Cannot delete yourself"));
    }
    user(&a, &uid).await?;
    let peers = sqlx::query_scalar::<_, String>("SELECT friend FROM friends WHERE owner=?")
        .bind(&uid)
        .fetch_all(&a.db)
        .await?;
    let mut tx = a.db.begin().await?;
    for table in ["sessions", "user_security", "user_badges"] {
        sqlx::query(&format!("DELETE FROM {table} WHERE user_id=?"))
            .bind(&uid)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("DELETE FROM friends WHERE owner=? OR friend=?")
        .bind(&uid)
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM messages WHERE sender=? OR receiver=?")
        .bind(&uid)
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM users WHERE id=?")
        .bind(&uid)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    audit(&a, &actor, "delete-user", &uid).await?;
    realtime::emit(
        &a,
        [peers, vec![uid]].concat(),
        json!({"type":"friends_changed"}),
    );
    Ok(Json(json!({"ok":true})))
}
pub async fn revoke(
    State(a): State<App>,
    h: HeaderMap,
    Path(uid): Path<String>,
) -> Result<Json<Value>> {
    let actor = require(&a, &h).await?;
    sqlx::query("DELETE FROM sessions WHERE user_id=?")
        .bind(&uid)
        .execute(&a.db)
        .await?;
    audit(&a, &actor, "revoke-sessions", &uid).await?;
    realtime::changed(&a, &uid).await;
    Ok(Json(json!({"ok":true})))
}
pub async fn export(
    State(a): State<App>,
    h: HeaderMap,
    Path(uid): Path<String>,
) -> Result<Response> {
    let actor = require(&a, &h).await?;
    let u = user(&a, &uid).await?;
    let high: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(id),0) FROM messages")
        .fetch_one(&a.db)
        .await?;
    audit(&a, &actor, "export-messages", &uid).await?;
    let mut prefix = serde_json::to_string(
        &json!({"format":"ScaraIM.messages.v1","exported_at":now(),"user":u}),
    )
    .unwrap();
    prefix.pop();
    prefix.push_str(",\"messages\":[");
    let file_uid = uid.clone();
    let stream: std::pin::Pin<
        Box<
            dyn futures_core::Stream<Item = std::result::Result<axum::body::Bytes, std::io::Error>>
                + std::marker::Send,
        >,
    > = Box::pin(async_stream::try_stream! {
        yield axum::body::Bytes::from(prefix);
        let mut cursor=0i64;let mut first=true;
        loop{
            let rows=sqlx::query("SELECT * FROM messages WHERE id>? AND id<=? AND (sender=? OR receiver=?) ORDER BY id LIMIT 500").bind(cursor).bind(high).bind(&uid).bind(&uid).fetch_all(&a.db).await.map_err(std::io::Error::other)?;
            if rows.is_empty(){break}
            for row in rows{cursor=row.get("id");let text=serde_json::to_string(&message(&row)).map_err(std::io::Error::other)?;yield axum::body::Bytes::from(format!("{}{text}",if first{""}else{","}));first=false;}
        }
        yield axum::body::Bytes::from_static(b"]}");

    });
    Ok((
        [
            (
                header::CONTENT_TYPE,
                "application/json; charset=utf-8".to_owned(),
            ),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"scaraim-{file_uid}.json\""),
            ),
            (header::CACHE_CONTROL, "no-store".into()),
        ],
        axum::body::Body::from_stream(stream),
    )
        .into_response())
}
pub async fn badges(State(a): State<App>, h: HeaderMap) -> Result<Json<Value>> {
    require(&a, &h).await?;
    Ok(Json(json!(catalog(&a).await?)))
}
pub async fn catalog(a: &App) -> Result<Vec<Value>> {
    Ok(sqlx::query("SELECT * FROM badge_defs ORDER BY id").fetch_all(&a.db).await?.iter().map(|r|json!({"id":r.get::<String,_>("id"),"name":r.get::<String,_>("name"),"image":r.get::<String,_>("image")})).collect())
}
#[derive(Deserialize)]
pub struct Badge {
    id: String,
    name: String,
    image: String,
}
pub async fn save_badge(
    State(a): State<App>,
    h: HeaderMap,
    Json(b): Json<Badge>,
) -> Result<Json<Value>> {
    let actor = require(&a, &h).await?;
    if b.id.is_empty()
        || b.id.len() > 64
        || !b
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        || b.name.trim().is_empty()
        || b.name.chars().count() > 64
    {
        return Err(bad("Invalid badge ID or name"));
    }
    let valid: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM files WHERE '/api/files/'||id=? AND mime LIKE 'image/%'",
    )
    .bind(&b.image)
    .fetch_one(&a.db)
    .await?;
    if valid == 0 {
        return Err(bad("Upload a PNG, JPEG, GIF or WebP badge image"));
    }
    sqlx::query("INSERT INTO badge_defs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,image=excluded.image").bind(&b.id).bind(b.name).bind(b.image).execute(&a.db).await?;
    audit(&a, &actor, "save-badge", &b.id).await?;
    notify_badge(&a, &b.id).await?;
    Ok(Json(json!({"ok":true})))
}
async fn notify_badge(a: &App, bid: &str) -> Result<()> {
    for uid in sqlx::query_scalar::<_, String>("SELECT user_id FROM user_badges WHERE badge_id=?")
        .bind(bid)
        .fetch_all(&a.db)
        .await?
    {
        realtime::changed(a, &uid).await
    }
    Ok(())
}
pub async fn delete_badge(
    State(a): State<App>,
    h: HeaderMap,
    Path(bid): Path<String>,
) -> Result<Json<Value>> {
    let actor = require(&a, &h).await?;
    let mut tx = a.db.begin().await?;
    let users = sqlx::query_scalar::<_, String>("SELECT user_id FROM user_badges WHERE badge_id=?")
        .bind(&bid)
        .fetch_all(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM user_badges WHERE badge_id=?")
        .bind(&bid)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM badge_defs WHERE id=?")
        .bind(&bid)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    for uid in users {
        realtime::changed(&a, &uid).await
    }
    audit(&a, &actor, "delete-badge", &bid).await?;
    Ok(Json(json!({"ok":true})))
}
#[derive(Deserialize)]
pub struct Award {
    badge_id: String,
    award: bool,
}
pub async fn award(
    State(a): State<App>,
    h: HeaderMap,
    Path(uid): Path<String>,
    Json(p): Json<Award>,
) -> Result<Json<Value>> {
    let actor = require(&a, &h).await?;
    user(&a, &uid).await?;
    let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM badge_defs WHERE id=?")
        .bind(&p.badge_id)
        .fetch_one(&a.db)
        .await?;
    if n == 0 {
        return Err(bad("Badge not found"));
    }
    let q = if p.award {
        "INSERT OR IGNORE INTO user_badges(user_id,badge_id) VALUES(?,?)"
    } else {
        "DELETE FROM user_badges WHERE user_id=? AND badge_id=?"
    };
    sqlx::query(q)
        .bind(&uid)
        .bind(&p.badge_id)
        .execute(&a.db)
        .await?;
    audit(
        &a,
        &actor,
        if p.award {
            "award-badge"
        } else {
            "revoke-badge"
        },
        &format!("{uid}:{}", p.badge_id),
    )
    .await?;
    realtime::changed(&a, &uid).await;
    Ok(Json(json!({"ok":true})))
}
pub fn routes() -> Router<App> {
    Router::new()
        .route("/api/admin/stats", get(stats))
        .route("/api/admin/logs", get(logs))
        .route("/api/admin/users", get(users).post(create))
        .route(
            "/api/admin/users/{id}",
            axum::routing::patch(edit).delete(delete),
        )
        .route(
            "/api/admin/users/{id}/sessions",
            axum::routing::delete(revoke),
        )
        .route("/api/admin/users/{id}/export", get(export))
        .route("/api/admin/users/{id}/badges", post(award))
        .route("/api/admin/badges", get(badges).post(save_badge))
        .route(
            "/api/admin/badges/{id}",
            axum::routing::delete(delete_badge),
        )
}
