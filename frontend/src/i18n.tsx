import { errors } from "./errors-i18n";
import { useSyncExternalStore } from "react";
export type Locale = "zh-CN" | "zh-TW" | "en-US" | "ja-JP";
const locales: Locale[] = ["zh-CN", "zh-TW", "en-US", "ja-JP"];
let current: Locale = locales.includes(
  localStorage.getItem("scaraim.locale") as Locale,
)
  ? (localStorage.getItem("scaraim.locale") as Locale)
  : "zh-CN";
const listeners = new Set<() => void>();
document.documentElement.lang = current;
export function useLocale() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => current,
  );
}
const words: Record<string, [string, string, string]> = {
  在线: ["線上", "Online", "オンライン"],
  离开: ["離開", "Away", "離席中"],
  忙碌: ["忙碌", "Busy", "取り込み中"],
  离线: ["離線", "Offline", "オフライン"],
  "服务暂时不可用，请检查后端是否启动": [
    "服務暫時無法使用",
    "Server unavailable",
    "サーバーに接続できません",
  ],
  关闭: ["關閉", "Close", "閉じる"],
  操作失败: ["操作失敗", "Operation failed", "操作に失敗しました"],
  文件不能超过20MB: [
    "檔案不能超過20MB",
    "Maximum file size: 20 MB",
    "最大ファイルサイズ：20 MB",
  ],
  "请使用 PNG、JPEG、GIF 或 WebP 图片": [
    "請使用 PNG、JPEG、GIF 或 WebP 圖片",
    "Use PNG, JPEG, GIF or WebP",
    "PNG、JPEG、GIF、WebP を使用してください",
  ],
  "正在连接 ScaraIM…": [
    "正在連線 ScaraIM…",
    "Connecting to ScaraIM…",
    "ScaraIM に接続中…",
  ],
  关闭提示: ["關閉提示", "Dismiss", "通知を閉じる"],
  即刻相连: ["即刻相連", "Connect", "つながる"],
  "让每一句，": ["讓每一句，", "Every word,", "あなたの言葉に、"],
  "都有回应。": ["都有回應。", "a connection.", "返事を。"],
  "聊日常，分享灵感。": [
    "聊日常，分享靈感。",
    "Share your day.",
    "日常を共有。",
  ],
  "和在意的人，在这里保持联系。": [
    "和在意的人，在這裡保持聯繫。",
    "Stay close.",
    "大切な人とつながる。",
  ],
  "有个新想法，想和你分享 ✨": [
    "有個新想法，想和你分享 ✨",
    "An idea to share ✨",
    "アイデアを共有 ✨",
  ],
  "我在，慢慢说。": ["我在，慢慢說。", "I am here.", "ここにいるよ。"],
  "你的朋友，你的空间。": [
    "你的朋友，你的空間。",
    "Your space.",
    "あなたの場所。",
  ],
  开始新的连接: ["開始新的連線", "Create account", "アカウント作成"],
  欢迎回来: ["歡迎回來", "Welcome back", "おかえりなさい"],
  "创建账号，和朋友打个招呼。": [
    "建立帳號，和朋友打個招呼。",
    "Join ScaraIM",
    "ScaraIM に参加",
  ],
  "登录 ScaraIM，接上还没聊完的话题。": [
    "登入 ScaraIM，繼續聊天。",
    "Sign in to ScaraIM",
    "ScaraIM にログイン",
  ],
  用户名: ["使用者名稱", "Username", "ユーザー名"],
  "字母、数字或下划线": [
    "字母、數字或底線",
    "Letters, numbers, underscores",
    "英数字・アンダースコア",
  ],
  昵称: ["暱稱", "Display name", "表示名"],
  希望朋友如何称呼你: ["希望朋友如何稱呼你", "Display name", "表示名"],
  密码: ["密碼", "Password", "パスワード"],
  "至少 8 位密码": ["至少 8 位密碼", "At least 8 characters", "8文字以上"],
  "请稍候…": ["請稍候…", "Please wait…", "お待ちください…"],
  创建账号: ["建立帳號", "Create account", "作成"],
  登录: ["登入", "Sign in", "ログイン"],
  "已经有账号？": [
    "已有帳號？",
    "Already a member?",
    "アカウントをお持ちですか？",
  ],
  "第一次来到这里？": ["第一次來到這裡？", "New here?", "初めてですか？"],
  去登录: ["前往登入", "Sign in", "ログイン"],
  注册账号: ["註冊帳號", "Sign up", "新規登録"],
  消息: ["訊息", "Messages", "メッセージ"],
  好友: ["好友", "Friends", "フレンド"],
  个人设置: ["個人設定", "Settings", "設定"],
  退出登录: ["登出", "Sign out", "ログアウト"],
  我的资料: ["我的個人資料", "My profile", "プロフィール"],
  添加好友: ["新增好友", "Add friend", "フレンドを追加"],
  搜索好友或会话: ["搜尋好友或對話", "Search", "検索"],
  全部会话: ["全部對話", "All chats", "すべてのチャット"],
  我的好友: ["我的好友", "My friends", "フレンド"],
  "[图片]": ["[圖片]", "[Image]", "[画像]"],
  "[文件] ": ["[檔案] ", "[File] ", "[ファイル] "],
  "打个招呼，开始聊天吧": [
    "打個招呼，開始聊天吧",
    "Say hello",
    "話しかけてみましょう",
  ],
  没有找到匹配的好友: ["找不到符合的好友", "No matches", "見つかりません"],
  "你的下一段对话，从这里开始": [
    "你的下一段對話，從這裡開始",
    "No conversations yet",
    "会話はまだありません",
  ],
  添加一位好友: ["新增一位好友", "Add friend", "フレンドを追加"],
  "已连接 · WebSocket 实时": [
    "已連線 · WebSocket 即時",
    "Connected · Real-time",
    "接続済み・リアルタイム",
  ],
  "连接中断，正在重试…": ["連線中斷，正在重試…", "Reconnecting…", "再接続中…"],
  返回列表: ["返回清單", "Back", "戻る"],
  私人聊天: ["私人聊天", "Private chat", "プライベートチャット"],
  好友资料: ["好友資料", "Friend profile", "フレンド情報"],
  加载更早消息: ["載入更早訊息", "Earlier messages", "以前のメッセージ"],
  "这是你们的私人对话，打个招呼吧。": [
    "這是你們的私人對話。",
    "Start a conversation",
    "会話を始めましょう",
  ],
  转发的消息: ["轉傳的訊息", "Forwarded", "転送メッセージ"],
  点击下载文件: ["點擊下載檔案", "Download", "ダウンロード"],
  已读: ["已讀", "Read", "既読"],
  已发送: ["已傳送", "Sent", "送信済み"],
  转发消息: ["轉傳訊息", "Forward", "転送"],
  发送图片: ["傳送圖片", "Send image", "画像を送信"],
  发送文件: ["傳送檔案", "Send file", "ファイルを送信"],
  分享一点今天的新鲜事: [
    "分享一點今天的新鮮事",
    "Share something",
    "何かを共有",
  ],
  消息内容: ["訊息內容", "Message", "メッセージ"],
  "Enter 发送 · Shift + Enter 换行": [
    "Enter 傳送 · Shift + Enter 換行",
    "Enter to send · Shift + Enter for newline",
    "Enter で送信 · Shift + Enter で改行",
  ],
  发送: ["傳送", "Send", "送信"],
  "好久不见，": ["好久不見，", "Hello, ", "こんにちは、"],
  "选一位朋友，开始今天的第一句问候。": [
    "選一位好友，開始聊天。",
    "Select a friend",
    "フレンドを選択",
  ],
  "文字、照片，或是想分享的一切。": [
    "文字、照片，或想分享的一切。",
    "Messages, images and files",
    "メッセージ・画像・ファイル",
  ],
  "每一次连接，都从一句「你好」开始": [
    "每一次連線，都從一句「你好」開始",
    "Start with hello",
    "挨拶から始めましょう",
  ],
  发现新朋友: ["尋找新朋友", "Find friends", "フレンドを探す"],
  "输入用户名、用户 ID 或昵称查找朋友。": [
    "輸入名稱、ID 或暱稱搜尋。",
    "Search by username, ID or name",
    "ユーザー名・ID・表示名で検索",
  ],
  查找用户: ["搜尋使用者", "Find user", "ユーザー検索"],
  "用户名 / ID / 昵称": [
    "使用者名稱 / ID / 暱稱",
    "Username / ID / Name",
    "ユーザー名 / ID / 表示名",
  ],
  查找: ["搜尋", "Search", "検索"],
  已添加: ["已新增", "Added", "追加済み"],
  添加: ["新增", "Add", "追加"],
  搜索结果会显示在这里: [
    "搜尋結果會顯示在這裡",
    "No search results",
    "検索結果なし",
  ],
  更换横幅: ["更換橫幅", "Change banner", "バナー変更"],
  更换头像: ["更換頭像", "Change avatar", "アイコン変更"],
  "用户 ID": ["使用者 ID", "User ID", "ユーザーID"],
  在线状态: ["線上狀態", "Status", "ステータス"],
  保存资料: ["儲存資料", "Save profile", "保存"],
  好友备注: ["好友備註", "Friend alias", "フレンドの別名"],
  给朋友起个专属名字: ["給好友取個專屬名字", "Private alias", "自分だけの別名"],
  保存备注: ["儲存備註", "Save alias", "別名を保存"],
  "确定删除这位好友？双方好友关系会解除，历史消息仍会保留。": [
    "確定刪除好友？雙方關係會解除，歷史訊息保留。",
    "Remove this friend from both lists? History will be kept.",
    "双方のフレンド関係を解除しますか？履歴は残ります。",
  ],
  删除好友: ["刪除好友", "Remove friend", "フレンド解除"],
  转发给好友: ["轉傳給好友", "Forward to", "転送先"],
  图片: ["圖片", "Image", "画像"],
  文件: ["檔案", "File", "ファイル"],
  管理后台: ["管理後台", "Administration", "管理画面"],
  系统概览: ["系統概覽", "Overview", "システム概要"],
  用户管理: ["使用者管理", "Users", "ユーザー管理"],
  徽章管理: ["徽章管理", "Badges", "バッジ管理"],
  日志与审计: ["日誌與稽核", "Logs & audit", "ログ・監査"],
  命令: ["指令", "Commands", "コマンド"],
  执行: ["執行", "Run", "実行"],
  仅自己可见: ["僅自己可見", "Only visible to you", "自分にのみ表示"],
  刷新: ["重新整理", "Refresh", "更新"],
  保存: ["儲存", "Save", "保存"],
  取消: ["取消", "Cancel", "キャンセル"],
  删除: ["刪除", "Delete", "削除"],
  导出消息: ["匯出訊息", "Export messages", "メッセージを出力"],
  撤销会话: ["撤銷工作階段", "Revoke sessions", "セッション失効"],
  封禁: ["停權", "Banned", "利用停止"],
  封禁原因: ["停權原因", "Ban reason", "停止理由"],
  角色: ["角色", "Role", "権限"],
  普通用户: ["一般使用者", "User", "ユーザー"],
  管理员: ["管理員", "Administrator", "管理者"],
  "新密码（留空不修改）": [
    "新密碼（留空不變）",
    "New password (blank to keep)",
    "新しいパスワード（空欄で維持）",
  ],
  "确认永久删除用户及其全部聊天记录？": [
    "確定永久刪除使用者與全部聊天紀錄？",
    "Permanently delete this user and all their chat messages?",
    "ユーザーと関連する全メッセージを完全に削除しますか？",
  ],
  "徽章 ID": ["徽章 ID", "Badge ID", "バッジID"],
  名称: ["名稱", "Name", "名前"],
  图案: ["圖案", "Image", "画像"],
  发放: ["發放", "Award", "付与"],
  收回: ["收回", "Revoke", "取り消し"],
  上传: ["上傳", "Upload", "アップロード"],
  创建用户: ["建立使用者", "Create user", "ユーザー作成"],
  操作完成: ["操作完成", "Done", "完了"],
  上一页: ["上一頁", "Previous", "前へ"],
  下一页: ["下一頁", "Next", "次へ"],
  无数据: ["無資料", "No data", "データなし"],
  "确认删除徽章并收回所有授予？": [
    "確認刪除徽章並收回所有授予？",
    "Delete this badge and revoke all awards?",
    "バッジとすべての付与を削除しますか？",
  ],
  头像: ["頭像", "Avatar", "アイコン"],
  横幅: ["橫幅", "Banner", "バナー"],
  清除: ["清除", "Clear", "消去"],
  连接不可用: ["連線無法使用", "Connection unavailable", "接続できません"],
  os: ["作業系統", "Operating system", "OS"],
  arch: ["架構", "Architecture", "アーキテクチャ"],
  cpu: ["處理器", "CPU", "CPU"],
  cpu_threads: ["邏輯核心", "CPU threads", "論理コア"],
  cpu_usage: ["CPU 使用率", "CPU usage", "CPU使用率"],
  memory_total: ["記憶體總量", "Total memory", "合計メモリ"],
  memory_used: ["已用記憶體", "Used memory", "使用メモリ"],
  service_uptime: ["服務執行時間", "Service uptime", "稼働時間"],
  system_uptime: ["系統執行時間", "System uptime", "システム稼働時間"],
  version: ["版本", "Version", "バージョン"],
  users: ["使用者數", "Users", "ユーザー数"],
  messages: ["訊息數", "Messages", "メッセージ数"],
  online_users: ["線上使用者", "Online users", "オンライン数"],
  connections: ["即時連線", "Connections", "接続数"],
  banned_users: ["停權使用者", "Banned users", "停止ユーザー"],
  database_bytes: ["資料庫大小", "Database size", "DBサイズ"],
  wal_bytes: ["WAL 大小", "WAL size", "WALサイズ"],
  upload_disk_bytes: ["附件磁碟用量", "Files on disk", "添付容量"],
  upload_bytes: ["附件登錄大小", "Recorded file bytes", "添付登録サイズ"],
  message_text_bytes: [
    "訊息正文大小",
    "Message payload bytes",
    "メッセージ本文サイズ",
  ],
  storage_bytes: ["儲存總用量", "Total storage", "総保存容量"],
  files: ["檔案數", "Files", "ファイル数"],
  时间: ["時間", "Time", "時刻"],
  操作: ["操作", "Action", "操作"],
  目标: ["目標", "Target", "対象"],
  操作者: ["操作者", "Actor", "実行者"],
  "Account suspended": [
    "帳號已停權",
    "Account suspended",
    "アカウントが停止されています",
  ],
  "Administrator access required": [
    "需要管理員權限",
    "Administrator access required",
    "管理者権限が必要です",
  ],
};
const zhLabels: Record<string, string> = {
  os: "操作系统",
  arch: "架构",
  cpu: "CPU",
  cpu_threads: "逻辑核心",
  cpu_usage: "CPU 使用率",
  memory_total: "内存总量",
  memory_used: "已用内存",
  service_uptime: "服务运行时间",
  system_uptime: "系统运行时间",
  version: "版本",
  users: "用户数",
  messages: "消息数",
  online_users: "在线用户",
  connections: "实时连接",
  banned_users: "封禁用户",
  database_bytes: "数据库大小",
  wal_bytes: "WAL 大小",
  upload_disk_bytes: "附件磁盘用量",
  upload_bytes: "附件登记大小",
  message_text_bytes: "消息正文大小",
  storage_bytes: "存储总用量",
  files: "文件数",
  "Account suspended": "账号已封禁",
  "Administrator access required": "需要管理员权限",
};
export function t(key: string) {
  if (errors[key]) return errors[key][locales.indexOf(current)];
  if (current === "zh-CN") return zhLabels[key] || key;
  return (
    words[key]?.[current === "zh-TW" ? 0 : current === "en-US" ? 1 : 2] || key
  );
}
export function locale() {
  return current;
}
export function setLocale(next: Locale) {
  current = next;
  localStorage.setItem("scaraim.locale", next);
  document.documentElement.lang = next;
  listeners.forEach((fn) => fn());
}
function Flag({ country }: { country: Locale }) {
  return (
    <svg viewBox="0 0 30 20" width="27" height="18" aria-hidden="true">
      <rect
        width="30"
        height="20"
        fill={
          country === "ja-JP"
            ? "#fff"
            : country === "en-US"
              ? "#fff"
              : "#de2910"
        }
      />
      {country === "zh-CN" ? (
        <>
          <path
            fill="#ffde00"
            d="m6 3 1.1 3.3h3.5L7.8 8.4l1.1 3.3L6 9.6l-2.8 2.1 1-3.3-2.8-2.1h3.5z"
          />
          {[
            [12, 3],
            [15, 6],
            [15, 10],
            [12, 13],
          ].map(([x, y]) => (
            <path
              key={x + "," + y}
              transform={"translate(" + x + " " + y + ") scale(.32)"}
              d="M0 -3 1 -1 3 -1 1.5 .5 2 3 0 1.5 -2 3 -1.5 .5 -3 -1 -1 -1z"
              fill="#ffde00"
            />
          ))}
        </>
      ) : country === "zh-TW" ? (
        <>
          <rect width="15" height="10" fill="#000095" />
          <g fill="white" transform="translate(7.5 5)">
            {Array.from({ length: 12 }, (_, i) => (
              <path
                key={i}
                d="M-.6 -2 0 -4 .6 -2z"
                transform={"rotate(" + i * 30 + ")"}
              />
            ))}
            <circle r="2" />
          </g>
        </>
      ) : country === "en-US" ? (
        <>
          {Array.from({ length: 7 }, (_, i) => (
            <rect
              key={i}
              y={(i * 20) / 6.5}
              width="30"
              height={20 / 13}
              fill="#b22234"
            />
          ))}
          <rect width="13" height="11" fill="#3c3b6e" />
          {Array.from({ length: 20 }, (_, i) => (
            <circle
              key={i}
              cx={1.5 + (i % 5) * 2.5}
              cy={1.5 + Math.floor(i / 5) * 2.5}
              r=".55"
              fill="white"
            />
          ))}
        </>
      ) : (
        <circle cx="15" cy="10" r="6" fill="#bc002d" />
      )}
    </svg>
  );
}
export function LanguagePicker() {
  useLocale();
  return (
    <div className="language-picker" aria-label="Language">
      {locales.map((l, i) => (
        <button
          key={l}
          type="button"
          className={l === current ? "chosen" : ""}
          aria-label={["简体中文", "繁體中文", "English", "日本語"][i]}
          title={["简体中文", "繁體中文", "English", "日本語"][i]}
          onClick={() => setLocale(l)}
        >
          <Flag country={l} />
        </button>
      ))}
    </div>
  );
}
