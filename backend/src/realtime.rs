use super::*;
use axum::extract::ws::{Message as Frame, WebSocket, WebSocketUpgrade};
use tokio::time::{Duration, Instant};

#[derive(Clone)]
pub struct Event {
    pub targets: Vec<String>,
    pub data: Value,
}
pub fn emit(a: &App, targets: Vec<String>, data: Value) {
    let _ = a.events.send(Event { targets, data });
}
pub async fn changed(a: &App, uid: &str) {
    let mut targets = sqlx::query_scalar::<_, String>("SELECT friend FROM friends WHERE owner=?")
        .bind(uid)
        .fetch_all(&a.db)
        .await
        .unwrap_or_default();
    targets.push(uid.to_owned());
    emit(a, targets, json!({"type":"friends_changed"}));
}
pub async fn upgrade(State(a): State<App>, h: HeaderMap, ws: WebSocketUpgrade) -> Result<Response> {
    let uid = auth(&a, &h).await?;
    // Browser connections must originate from this host; reverse proxies preserve Host.
    let host = h
        .get(header::HOST)
        .and_then(|x| x.to_str().ok())
        .unwrap_or("");
    let origin = h
        .get(header::ORIGIN)
        .and_then(|x| x.to_str().ok())
        .unwrap_or("");
    if origin != format!("http://{host}") && origin != format!("https://{host}") {
        return Err(Error(StatusCode::FORBIDDEN, "连接来源不合法".into()));
    }
    Ok(ws
        .max_message_size(64 * 1024)
        .max_frame_size(64 * 1024)
        .on_upgrade(move |socket| run(socket, a, h, uid)))
}
async fn write(socket: &mut WebSocket, data: Value) -> bool {
    matches!(
        tokio::time::timeout(
            Duration::from_secs(5),
            socket.send(Frame::Text(data.to_string().into()))
        )
        .await,
        Ok(Ok(()))
    )
}
async fn run(mut socket: WebSocket, a: App, h: HeaderMap, uid: String) {
    let mut events = a.events.subscribe();
    {
        *a.connections
            .lock()
            .unwrap()
            .entry(uid.clone())
            .or_default() += 1;
    }
    telemetry::log(&format!("WS connection change {uid}"));
    changed(&a, &uid).await;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    let mut last_pong = Instant::now();
    if write(&mut socket, json!({"type":"ready"})).await {
        loop {
            tokio::select! {
                _ = heartbeat.tick() => {
                    if last_pong.elapsed() > Duration::from_secs(45) || auth(&a,&h).await.is_err() { break; }
                    if !write(&mut socket,json!({"type":"ping"})).await { break; }
                }
                event = events.recv() => {
                    match event {
                        Ok(e) if e.targets.contains(&uid) => {
                            if auth(&a,&h).await.is_err() || !write(&mut socket,e.data).await { break; }
                        }
                        Ok(_) => {},
                        // A slow client reconnects and retrieves a fresh HTTP snapshot.
                        Err(_) => break,
                    }
                }
                incoming = socket.recv() => {
                    let Some(Ok(frame)) = incoming else { break; };
                    let Frame::Text(text) = frame else { if matches!(frame, Frame::Close(_)) { break; } continue; };
                    if auth(&a,&h).await.is_err() { break; }
                    let v = match serde_json::from_str::<Value>(&text) { Ok(v) => v, Err(_) => { if !write(&mut socket,json!({"type":"error","error":"消息格式无效"})).await { break; } continue; } };
                    if v["type"] == "pong" { last_pong=Instant::now(); continue; }
                    let request_id=v["request_id"].as_str().unwrap_or("");
                    let target=v["target"].as_str().unwrap_or("").to_owned();
                    let result = match v["type"].as_str() {
                        Some("send") => match serde_json::from_value::<Send>(v["payload"].clone()) {
                            Ok(p) => send(State(a.clone()),h.clone(),Path(target),Json(p)).await,
                            Err(_) => Err(bad("消息格式无效")),
                        },
                        Some("command") => commands::execute(&a,&uid,v["payload"]["line"].as_str().unwrap_or(""),false).await.map(Json),
                        Some("read") => read_messages(State(a.clone()),h.clone(),Path(target)).await,
                        _ => Err(bad("未知消息类型")),
                    };
                    let reply=match result { Ok(Json(data)) => json!({"type":"ack","request_id":request_id,"data":data}), Err(e) => json!({"type":"error","request_id":request_id,"error":e.1,"status":e.0.as_u16()}) };
                    if !write(&mut socket,reply).await { break; }
                }
            }
        }
    }
    {
        let mut map = a.connections.lock().unwrap();
        if let Some(n) = map.get_mut(&uid) {
            *n -= 1;
            if *n == 0 {
                map.remove(&uid);
            }
        }
    }
    telemetry::log(&format!("WS connection change {uid}"));
    changed(&a, &uid).await;
    let _ = tokio::time::timeout(Duration::from_secs(2), socket.send(Frame::Close(None))).await;
}
