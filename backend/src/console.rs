use super::*;
use crossterm::{
    cursor,
    event::{self, Event, KeyCode, KeyEventKind, KeyModifiers},
    execute, queue,
    style::Print,
    terminal::{self, Clear, ClearType, EnterAlternateScreen, LeaveAlternateScreen},
};
use std::io::{self, Write};
pub static STOP: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
struct Restore;
impl Drop for Restore {
    fn drop(&mut self) {
        let _ = terminal::disable_raw_mode();
        let _ = execute!(io::stdout(), LeaveAlternateScreen, cursor::Show);
        telemetry::TUI.store(false, std::sync::atomic::Ordering::Relaxed);
    }
}
pub fn run(a: App, handle: tokio::runtime::Handle) -> io::Result<()> {
    terminal::enable_raw_mode()?;
    let _restore = Restore;
    execute!(io::stdout(), EnterAlternateScreen, cursor::Hide)?;
    telemetry::TUI.store(true, std::sync::atomic::Ordering::Relaxed);
    let mut input = String::new();
    let mut history: Vec<String> = vec![];
    let mut history_index = 0;
    let mut scroll = 0usize;
    while !STOP.load(std::sync::atomic::Ordering::Relaxed) {
        let (width, height) = terminal::size()?;
        if height < 6 || width < 25 {
            if event::poll(std::time::Duration::from_millis(200))? {
                if let Event::Key(key) = event::read()? {
                    if key.code == KeyCode::Esc
                        || (key.code == KeyCode::Char('c')
                            && key.modifiers.contains(KeyModifiers::CONTROL))
                    {
                        break;
                    }
                }
            }
            continue;
        }
        let metrics = a.metrics.lock().unwrap().clone();
        let lines = telemetry::lines();
        let mut out = io::stdout();
        queue!(
            out,
            cursor::MoveTo(0, 0),
            Clear(ClearType::All),
            Print(format!(
                "ScaraIM | CPU {:.1}% | RAM {} MiB | WS {}",
                metrics["cpu_usage"].as_f64().unwrap_or(0.0),
                metrics["memory_used"].as_u64().unwrap_or(0) / 1048576,
                a.connections.lock().unwrap().values().sum::<usize>()
            ))
        )?;
        queue!(
            out,
            cursor::MoveTo(0, 1),
            Print("/help | PgUp/PgDn logs | Up/Down history | Esc exits TUI")
        )?;
        let end = lines.len().saturating_sub(scroll);
        let count = (height - 5) as usize;
        for (i, line) in lines[..end]
            .iter()
            .rev()
            .take(count)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .enumerate()
        {
            let text: String = line.chars().take((width - 1) as usize).collect();
            queue!(out, cursor::MoveTo(0, i as u16 + 3), Print(text))?;
        }
        let shown: String = input
            .chars()
            .rev()
            .take((width - 4) as usize)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        queue!(
            out,
            cursor::MoveTo(0, height - 1),
            Print(format!("> {shown}"))
        )?;
        out.flush()?;
        if event::poll(std::time::Duration::from_millis(200))? {
            if let Event::Key(key) = event::read()? {
                if key.kind != KeyEventKind::Press {
                    continue;
                }
                match key.code {
                    KeyCode::Esc => break,
                    KeyCode::Char('c') if key.modifiers.contains(KeyModifiers::CONTROL) => break,
                    KeyCode::Enter => {
                        if !input.trim().is_empty() {
                            let line = std::mem::take(&mut input);
                            history.push(line.clone());
                            history_index = history.len();
                            scroll = 0;
                            match handle.block_on(commands::execute(
                                &a,
                                "local-console",
                                &line,
                                true,
                            )) {
                                Ok(v) => telemetry::log(&format!("RESULT {v}")),
                                Err(e) => telemetry::log(&format!("ERROR {}", e.1)),
                            }
                        }
                    }
                    KeyCode::Backspace => {
                        input.pop();
                    }
                    KeyCode::Char(c) if input.len() < 2048 => input.push(c),
                    KeyCode::Up => {
                        history_index = history_index.saturating_sub(1);
                        input = history.get(history_index).cloned().unwrap_or_default()
                    }
                    KeyCode::Down => {
                        history_index = (history_index + 1).min(history.len());
                        input = history.get(history_index).cloned().unwrap_or_default()
                    }
                    KeyCode::PageUp => scroll = (scroll + 10).min(lines.len()),
                    KeyCode::PageDown => scroll = scroll.saturating_sub(10),
                    _ => {}
                }
            }
        }
    }
    Ok(())
}
