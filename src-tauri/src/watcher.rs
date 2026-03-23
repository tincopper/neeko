use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use std::{collections::HashMap, path::PathBuf, sync::Mutex, time::Duration};
use tauri::{AppHandle, Emitter};

type WatcherHandle =
    notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>;

pub struct WatcherManager {
    watchers: Mutex<HashMap<String, WatcherHandle>>,
}

impl WatcherManager {
    pub fn new() -> Self {
        Self {
            watchers: Mutex::new(HashMap::new()),
        }
    }

    pub fn watch(&self, project_id: String, path: PathBuf, app_handle: AppHandle) {
        let pid = project_id.clone();
        let app = app_handle.clone();
        let git_dir = path.join(".git");

        // 800ms 去抖，保存时往往触发多次写事件
        let debouncer = new_debouncer(
            Duration::from_millis(800),
            move |res: DebounceEventResult| {
                let events = match res {
                    Ok(evts) => evts,
                    Err(_) => return,
                };

                // DebouncedEventKind 只有 Any/AnyContinuous，无法区分事件类型
                // 只需过滤掉 .git 目录内部的变化（lock 文件、ORIG_HEAD 等噪音）
                let relevant = events.iter().any(|e| !e.path.starts_with(&git_dir));

                if relevant {
                    let _ = app.emit("git-changed", &pid);
                }
            },
        );

        match debouncer {
            Ok(mut d) => {
                if let Err(e) = d.watcher().watch(&path, RecursiveMode::Recursive) {
                    eprintln!("[Watcher] watch error for {}: {}", path.display(), e);
                    return;
                }
                self.watchers.lock().unwrap().insert(project_id, d);
            }
            Err(e) => {
                eprintln!("[Watcher] debouncer error for {}: {}", path.display(), e);
            }
        }
    }

    pub fn unwatch(&self, project_id: &str) {
        self.watchers.lock().unwrap().remove(project_id);
    }
}
