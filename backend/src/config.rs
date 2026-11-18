use std::{path::PathBuf, sync::OnceLock};

static DATA: OnceLock<PathBuf> = OnceLock::new();
pub fn data(name: &str) -> PathBuf {
    DATA.get().expect("configuration initialized").join(name)
}
pub struct Config {
    pub frontend: PathBuf,
    pub bind: String,
    pub tui: bool,
    pub admin: Option<String>,
    pub command: Option<String>,
}
impl Config {
    pub fn read() -> Result<Option<Self>, String> {
        let mut args = std::env::args_os().skip(1);
        let mut dir = std::env::var_os("SCARAIM_DATA_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| "data".into());
        let mut c = Self {
            frontend: std::env::var_os("FRONTEND_DIR")
                .map(PathBuf::from)
                .unwrap_or_else(|| "../frontend/dist".into()),
            bind: std::env::var("BIND_ADDR").unwrap_or_else(|_| "127.0.0.1:3001".into()),
            tui: false,
            admin: None,
            command: None,
        };
        while let Some(arg) = args.next() {
            let flag = arg.to_str().ok_or("Invalid option")?;
            match flag {
                "--help" | "-h" => {
                    println!("ScaraIM\n  --set-admin USERNAME   Grant an existing user administrator access\n  --grant-admin USERNAME Legacy alias\n  --command COMMAND     Execute a local console command and exit\n  --data-dir PATH       Database, uploads, logs and plugins (default: ./data)\n  --frontend-dir PATH   Built frontend (default: ../frontend/dist)\n  --bind ADDRESS        Listen address (default: 127.0.0.1:3001)\n  --tui                 Interactive terminal console\n  --version             Show version\nEnvironment: SCARAIM_DATA_DIR, FRONTEND_DIR, BIND_ADDR\nRelative paths are resolved from the current working directory.");
                    return Ok(None);
                }
                "--version" | "-V" => {
                    println!("ScaraIM {}", env!("CARGO_PKG_VERSION"));
                    return Ok(None);
                }
                "--tui" => c.tui = true,
                "--data-dir" | "--frontend-dir" | "--bind" | "--set-admin" | "--grant-admin"
                | "--command" => {
                    let value = args
                        .next()
                        .ok_or_else(|| format!("{flag} requires a value"))?;
                    match flag {
                        "--data-dir" => dir = value.into(),
                        "--frontend-dir" => c.frontend = value.into(),
                        _ => {
                            let value = value
                                .into_string()
                                .map_err(|_| format!("Invalid value for {flag}"))?;
                            if value.trim().is_empty() || value.starts_with("--") {
                                return Err(format!("{flag} requires a value"));
                            }
                            match flag {
                                "--bind" => c.bind = value,
                                "--command" => c.command = Some(value),
                                _ => c.admin = Some(value),
                            }
                        }
                    }
                }
                _ => return Err(format!("Unknown option: {flag}; use --help")),
            }
        }
        if c.admin.is_some() && c.command.is_some() {
            return Err("Use either --set-admin or --command".into());
        }
        let cwd = std::env::current_dir().map_err(|e| e.to_string())?;
        DATA.set(cwd.join(dir))
            .map_err(|_| "Configuration already initialized")?;
        c.frontend = cwd.join(c.frontend);
        Ok(Some(c))
    }
}
