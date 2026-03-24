use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, DebounceEventResult};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex},
    thread,
    time::Duration,
};
use tauri::{AppHandle, Emitter};

struct WatcherHandle {
    debouncer: notify_debouncer_mini::Debouncer<notify_debouncer_mini::notify::RecommendedWatcher>,
    stop_signal: Arc<AtomicBool>,
}

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

                // 非递归监听根目录，只需过滤掉 .git 目录内部的变化
                let relevant = events.iter().any(|e| !e.path.starts_with(&git_dir));

                if relevant {
                    let _ = app.emit("git-changed", &pid);
                }
            },
        );

        let debouncer = match debouncer {
            Ok(d) => d,
            Err(e) => {
                eprintln!("[Watcher] debouncer error for {}: {}", path.display(), e);
                return;
            }
        };

        // 非递归监听：只监听项目根目录的直接子条目变化
        // 避免监控 node_modules、target 等大型目录树导致性能问题
        if let Err(e) = debouncer
            .watcher()
            .watch(&path, RecursiveMode::NonRecursive)
        {
            eprintln!("[Watcher] watch error for {}: {}", path.display(), e);
            return;
        }

        // 轮询线程：每 10 秒检查一次 git 状态，补检深层文件变化
        let stop = Arc::new(AtomicBool::new(false));
        let stop_clone = stop.clone();
        let app_poll = app_handle.clone();
        let pid_poll = project_id.clone();
        thread::spawn(move || {
            while !stop_clone.load(Ordering::Relaxed) {
                thread::sleep(Duration::from_secs(10));
                if !stop_clone.load(Ordering::Relaxed) {
                    let _ = app_poll.emit("git-changed", &pid_poll);
                }
            }
        });

        self.watchers.lock().unwrap().insert(
            project_id,
            WatcherHandle {
                debouncer,
                stop_signal: stop,
            },
        );
    }

    pub fn unwatch(&self, project_id: &str) {
        // 移除时 stop_signal 被 drop，轮询线程下次检查时退出
        self.watchers.lock().unwrap().remove(project_id);
    }
}
