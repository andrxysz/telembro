mod model;
mod sound;
mod store;

use model::{now_ms, Draft, Note};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use store::Store;
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};

type Shared = Arc<Mutex<Store>>;

fn access(window: &WebviewWindow, id: Option<&str>) -> Result<(), String> {
    if window.label() == "main"
        || id
            .map(|id| window.label() == format!("sticker-{id}"))
            .unwrap_or(false)
    {
        Ok(())
    } else {
        Err("Esta janela não pode alterar este lembrete.".into())
    }
}

fn broadcast(app: &AppHandle, notes: &[Note]) {
    let _ = app.emit("notes-changed", notes);
}

fn broadcast_current(app: &AppHandle, state: &Shared) {
    if let Ok(store) = state.lock() {
        broadcast(app, &store.saved.notes);
    }
}

fn show_manager(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open_sticker(app: &AppHandle, note: &Note) -> Result<(), String> {
    let label = format!("sticker-{}", note.id);
    let builder = WebviewWindowBuilder::new(
        app,
        &label,
        WebviewUrl::App(format!("index.html?sticker={}", note.id).into()),
    )
    .title("Telembro · lembrete")
    .inner_size(292.0, 122.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(!note.locked)
    .visible(false);
    let window = match app.get_webview_window(&label) {
        Some(window) => window,
        None => builder
            .build()
            .map_err(|e| format!("Não foi possível abrir o sticker: {e}"))?,
    };
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let width = size.width as i32;
    let height = size.height as i32;
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    // Coordinates are physical pixels, so negative monitor origins and DPI work.
    let valid_position = note.x.zip(note.y).filter(|(x, y)| {
        monitors.iter().any(|monitor| {
            let area = monitor.work_area();
            *x >= area.position.x
                && *y >= area.position.y
                && *x + width <= area.position.x + area.size.width as i32
                && *y + height <= area.position.y + area.size.height as i32
        })
    });
    if let Some((x, y)) = valid_position {
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    } else if let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next())
    {
        let area = monitor.work_area();
        let count = app
            .webview_windows()
            .keys()
            .filter(|label| label.starts_with("sticker-"))
            .count();
        let offset = (count.saturating_sub(1) % 5) as i32 * 26;
        let x =
            (area.position.x + area.size.width as i32 - width - 24 - offset).max(area.position.x);
        let y = (area.position.y + 40 + offset)
            .min((area.position.y + area.size.height as i32 - height).max(area.position.y));
        window
            .set_position(tauri::PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?;
    }
    window.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn list_notes(state: State<Shared>) -> Result<Vec<Note>, String> {
    Ok(state.lock().map_err(|e| e.to_string())?.saved.notes.clone())
}

#[tauri::command]
fn hide_manager(window: WebviewWindow) -> Result<(), String> {
    access(&window, None)?;
    window.hide().map_err(|e| e.to_string())
}

#[tauri::command]
fn fit_sticker(window: WebviewWindow, width: u32, height: u32) -> Result<(), String> {
    if !window.label().starts_with("sticker-")
        || !(242..=292).contains(&width)
        || !(80..=350).contains(&height)
    {
        return Err("Dimensões de sticker inválidas.".into());
    }
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let current = window.inner_size().map_err(|e| e.to_string())?;
    if (f64::from(current.width) / scale - f64::from(width)).abs() > 0.5
        || (f64::from(current.height) / scale - f64::from(height)).abs() > 0.5
    {
        window
            .set_size(tauri::LogicalSize::new(width, height))
            .map_err(|e| e.to_string())?;
    }
    // Growing a longer note must not put its bottom edge outside the work area.
    if let Some(monitor) = window.current_monitor().map_err(|e| e.to_string())? {
        let area = monitor.work_area();
        let pos = window.outer_position().map_err(|e| e.to_string())?;
        let size = window.outer_size().map_err(|e| e.to_string())?;
        let x = pos
            .x
            .min(area.position.x + area.size.width as i32 - size.width as i32)
            .max(area.position.x);
        let y = pos
            .y
            .min(area.position.y + area.size.height as i32 - size.height as i32)
            .max(area.position.y);
        if x != pos.x || y != pos.y {
            window
                .set_position(tauri::PhysicalPosition::new(x, y))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// Asynchronous commands keep WebView2 creation off its synchronous IPC callback.
#[tauri::command]
async fn create_note(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Shared>,
    draft: Draft,
) -> Result<(), String> {
    access(&window, None)?;
    draft.validate()?;
    let note = Note::new(draft, now_ms());
    state.lock().map_err(|e| e.to_string())?.transact(|notes| {
        if notes
            .iter()
            .filter(|note| note.completed_at.is_none())
            .count()
            >= 12
        {
            return Err("Você já tem 12 stickers. Conclua um para abrir espaço.".into());
        }
        notes.insert(0, note.clone());
        Ok(())
    })?;
    if let Err(error) = open_sticker(&app, &note) {
        state.lock().map_err(|e| e.to_string())?.transact(|notes| {
            notes.retain(|item| item.id != note.id);
            Ok(())
        })?;
        return Err(error);
    }
    broadcast_current(&app, &state);
    Ok(())
}

#[tauri::command]
async fn note_action(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, Shared>,
    action: String,
    id: String,
) -> Result<(), String> {
    access(&window, Some(&id))?;
    if window.label() != "main" && !["lock", "unlock", "complete"].contains(&action.as_str()) {
        return Err("Esta ação está disponível na interface principal.".into());
    }
    let label = format!("sticker-{id}");
    let position = app
        .get_webview_window(&label)
        .and_then(|window| window.outer_position().ok());
    let previous = state.lock().map_err(|e| e.to_string())?.saved.clone();
    let notes = state.lock().map_err(|e| e.to_string())?.transact(|notes| {
        if action == "restore"
            && notes
                .iter()
                .filter(|note| note.completed_at.is_none())
                .count()
                >= 12
        {
            return Err("Você já tem 12 stickers. Conclua um para abrir espaço.".into());
        }
        let note = notes
            .iter_mut()
            .find(|note| note.id == id)
            .ok_or("Lembrete não encontrado.")?;
        match action.as_str() {
            "lock" => {
                note.locked = true;
                if let Some(pos) = position {
                    note.x = Some(pos.x);
                    note.y = Some(pos.y);
                }
            }
            "unlock" | "focus" => note.locked = false,
            "complete" => {
                note.completed_at = Some(now_ms());
                note.alert_until = 0;
            }
            "restore" => {
                note.completed_at = None;
                note.locked = false;
                note.alert_until = 0;
                note.next_alert_at = now_ms() + u64::from(note.draft.interval_minutes) * 60_000;
            }
            "test" => {
                if note.completed_at.is_none() {
                    note.alert_until = now_ms() + u64::from(note.draft.duration_seconds) * 1000;
                }
            }
            "delete" => {
                notes.retain(|note| note.id != id);
            }
            _ => return Err("Ação desconhecida.".into()),
        }
        Ok(())
    })?;
    if action == "complete" || action == "delete" {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.destroy();
        }
    } else if action == "restore" || action == "focus" {
        if let Some(note) = notes.iter().find(|note| note.id == id) {
            if let Err(error) = open_sticker(&app, note) {
                // Only restore this note: another concurrent action may have saved others.
                state.lock().map_err(|e| e.to_string())?.transact(|notes| {
                    if let Some(old) = previous.notes.iter().find(|note| note.id == id) {
                        if let Some(current) = notes.iter_mut().find(|note| note.id == id) {
                            *current = old.clone();
                        }
                    }
                    Ok(())
                })?;
                return Err(error);
            }
        }
    }
    if let Some(note) = notes.iter().find(|note| note.id == id) {
        if let Some(sticker) = app.get_webview_window(&label) {
            let _ = sticker.set_focusable(!note.locked);
        }
    }
    broadcast_current(&app, &state);
    Ok(())
}

fn schedule(app: AppHandle, state: Shared) {
    std::thread::spawn(move || {
        let mut playing = false;
        let mut last_storage_error = 0;
        loop {
            std::thread::sleep(Duration::from_millis(250));
            let now = now_ms();
            let Ok(mut store) = state.lock() else { break };
            let previous = store.saved.clone();
            let mut changed = false;
            for note in &mut store.saved.notes {
                changed |= note.tick(now);
            }
            if changed {
                if let Err(error) = store.persist() {
                    store.saved = previous;
                    if now.saturating_sub(last_storage_error) > 10_000 {
                        let _ = app.emit_to("main", "storage-error", error);
                        last_storage_error = now;
                    }
                } else {
                    broadcast(&app, &store.saved.notes);
                }
            }
            let sounding = store.saved.notes.iter().any(|note| {
                note.completed_at.is_none() && note.draft.sound && note.alert_until > now
            });
            drop(store);
            if sounding != playing {
                sound::set_playing(sounding);
                playing = sounding;
            }
        }
        sound::set_playing(false);
    });
}

pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            show_manager(app)
        }))
        .invoke_handler(tauri::generate_handler![
            fit_sticker,
            list_notes,
            create_note,
            note_action,
            hide_manager
        ])
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let path = data_dir.join("reminders.json");
            let store = Store::load(path).map_err(std::io::Error::other)?;
            let initial = store.saved.notes.clone();
            let state = Arc::new(Mutex::new(store));
            app.manage(state.clone());
            let show = MenuItem::with_id(app, "show", "Abrir Telembro", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Sair do Telembro", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Telembro · Eu te lembro com carinho")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_manager(app),
                    "quit" => {
                        sound::set_playing(false);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_manager(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            // Setup runs on the UI thread; creation is deferred to the async runtime.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                for note in initial.iter().filter(|note| note.completed_at.is_none()) {
                    if let Err(error) = open_sticker(&handle, note) {
                        let _ = handle.emit_to("main", "storage-error", error);
                    }
                }
                schedule(handle, state);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!());
    if let Err(error) = result {
        let message = format!("Não foi possível iniciar o Telembro.\n\n{error}\n\nSeus lembretes salvos foram preservados.");
        #[cfg(target_os = "windows")]
        {
            #[link(name = "user32")]
            extern "system" {
                fn MessageBoxW(
                    window: *mut std::ffi::c_void,
                    text: *const u16,
                    title: *const u16,
                    flags: u32,
                ) -> i32;
            }
            let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
            let title: Vec<u16> = "Telembro".encode_utf16().chain(Some(0)).collect();
            unsafe {
                MessageBoxW(std::ptr::null_mut(), text.as_ptr(), title.as_ptr(), 0x10);
            }
        }
        eprintln!("{message}");
    }
}
