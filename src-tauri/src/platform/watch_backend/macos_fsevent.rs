//! macOS FSEvents 后端：递归订阅 + `FSEventStreamSetExclusionPaths` 物理排除 ignored 子树。
//!
//! **来源与许可**：本文件是 `notify 6.1.1`（CC0-1.0 公共领域奉献）`src/fsevent.rs` 的移植，保留其
//! flags → `notify::Event` 的翻译语义，只在 `run()` 中 `FSEventStreamStart` **之前**
//! 插入 `FSEventStreamSetExclusionPaths`（notify 未调用该 API）。移植而非重写是为了
//! 消除**事件语义漂移**风险：下游 `classify.rs` 依赖 `EventKind` 分类。
//!
//! 为什么需要自写后端：notify 6.1.1 把底层 `FSEventStreamRef` 私有化，且 `watch()` 每次都
//! stop + 重建流，无法注入 exclusion 集合。所需 FFI 绑定（`fsevent-sys 4.1.0`）已全部具备，
//! 不新增任何 FFI crate。
//!
//! **正确性不依赖本后端**：ignored 子树内部的事件即使被送达，W1 的结构事件收敛仍会丢弃；
//! 本后端只是让内核不再向本进程投递，省掉 OS 侧回调成本。
//!
//! **上游同步策略**：本文件与 `notify` 的版本绑定（`Cargo.toml` 中 `notify` 的版本）。
//! 升级 notify 时必须重新 diff 其 `src/fsevent.rs`，把 flags→`EventKind` 映射的变更
//! 合并进来（下游 `classify.rs` 依赖该映射）；`watch()` 的 stop/rebuild 语义与本次新增的
//! `update_exclusions()` 也应一并核对。若未来 notify 自行暴露 exclusion 配置项，
//! 优先回退到上游实现（减少 fork 面）。

use fsevent_sys as fs;
use fsevent_sys::core_foundation as cf;
use notify::event::{
    CreateKind, DataChange, Event, EventKind, Flag, MetadataKind, ModifyKind, RemoveKind,
    RenameMode,
};
use notify::{Config, Error, EventHandler, RecursiveMode, Result, Watcher, WatcherKind};
use std::collections::HashMap;
use std::ffi::CStr;
use std::fmt;
use std::os::raw;
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::{Arc, Mutex};
use std::thread;

/// `FSEventStreamSetExclusionPaths` 的硬上限（Apple 头文件："A maximum of 8 directories"）。
pub(super) const MAX_FSEVENT_EXCLUSIONS: usize = 8;

bitflags::bitflags! {
  #[repr(C)]
  #[derive(Debug)]
  struct StreamFlags: u32 {
    const NONE = fs::kFSEventStreamEventFlagNone;
    const MUST_SCAN_SUBDIRS = fs::kFSEventStreamEventFlagMustScanSubDirs;
    const USER_DROPPED = fs::kFSEventStreamEventFlagUserDropped;
    const KERNEL_DROPPED = fs::kFSEventStreamEventFlagKernelDropped;
    const IDS_WRAPPED = fs::kFSEventStreamEventFlagEventIdsWrapped;
    const HISTORY_DONE = fs::kFSEventStreamEventFlagHistoryDone;
    const ROOT_CHANGED = fs::kFSEventStreamEventFlagRootChanged;
    const MOUNT = fs::kFSEventStreamEventFlagMount;
    const UNMOUNT = fs::kFSEventStreamEventFlagUnmount;
    const ITEM_CREATED = fs::kFSEventStreamEventFlagItemCreated;
    const ITEM_REMOVED = fs::kFSEventStreamEventFlagItemRemoved;
    const INODE_META_MOD = fs::kFSEventStreamEventFlagItemInodeMetaMod;
    const ITEM_RENAMED = fs::kFSEventStreamEventFlagItemRenamed;
    const ITEM_MODIFIED = fs::kFSEventStreamEventFlagItemModified;
    const FINDER_INFO_MOD = fs::kFSEventStreamEventFlagItemFinderInfoMod;
    const ITEM_CHANGE_OWNER = fs::kFSEventStreamEventFlagItemChangeOwner;
    const ITEM_XATTR_MOD = fs::kFSEventStreamEventFlagItemXattrMod;
    const IS_FILE = fs::kFSEventStreamEventFlagItemIsFile;
    const IS_DIR = fs::kFSEventStreamEventFlagItemIsDir;
    const IS_SYMLINK = fs::kFSEventStreamEventFlagItemIsSymlink;
    const OWN_EVENT = fs::kFSEventStreamEventFlagOwnEvent;
    const IS_HARDLINK = fs::kFSEventStreamEventFlagItemIsHardlink;
    const IS_LAST_HARDLINK = fs::kFSEventStreamEventFlagItemIsLastHardlink;
    const ITEM_CLONED = fs::kFSEventStreamEventFlagItemCloned;
  }
}

/// 基于 FSEvents 的 `Watcher` 实现（递归 + 可配置子树排除）。
pub struct MacFseventWatcher {
    paths: cf::CFMutableArrayRef,
    /// 物理排除集合（在 `FSEventStreamStart` 之前设置；硬上限见 [`MAX_FSEVENT_EXCLUSIONS`]）。
    exclusion_paths: Vec<PathBuf>,
    since_when: fs::FSEventStreamEventId,
    latency: cf::CFTimeInterval,
    flags: fs::FSEventStreamCreateFlags,
    event_handler: Arc<Mutex<dyn EventHandler>>,
    runloop: Option<(cf::CFRunLoopRef, thread::JoinHandle<()>)>,
    recursive_info: HashMap<PathBuf, bool>,
}

impl fmt::Debug for MacFseventWatcher {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.debug_struct("MacFseventWatcher")
            .field("paths", &self.paths)
            .field("since_when", &self.since_when)
            .field("latency", &self.latency)
            .field("flags", &self.flags)
            .field("event_handler", &Arc::as_ptr(&self.event_handler))
            .field("runloop", &self.runloop)
            .field("recursive_info", &self.recursive_info)
            .finish()
    }
}

// CFMutableArrayRef 是 `*mut c_void`，因此本类型默认非 Send/Sync。
// Send：指针只在拥有者的线程中使用（runloop 线程只持 stream，不碰 paths）。
unsafe impl Send for MacFseventWatcher {}
// Sync：所有修改可变状态的方法都取 `&mut self`。
unsafe impl Sync for MacFseventWatcher {}

fn translate_flags(flags: StreamFlags, precise: bool) -> Vec<Event> {
    let mut evs = Vec::new();

    // «Denotes a sentinel event sent to mark the end of the "historical" events …»
    // 历史事件结束哨兵：忽略之，不产生任何 Event。
    if flags.contains(StreamFlags::HISTORY_DONE) {
        return evs;
    }

    if flags.contains(StreamFlags::MUST_SCAN_SUBDIRS) {
        let e = Event::new(EventKind::Other).set_flag(Flag::Rescan);
        evs.push(if flags.contains(StreamFlags::USER_DROPPED) {
            e.set_info("rescan: user dropped")
        } else if flags.contains(StreamFlags::KERNEL_DROPPED) {
            e.set_info("rescan: kernel dropped")
        } else {
            e
        });
    }

    // 非精确模式：除上述特殊事件外不解析具体类型。
    if !precise {
        evs.push(Event::new(EventKind::Any));
        return evs;
    }

    if flags.contains(StreamFlags::ROOT_CHANGED) {
        evs.push(
            Event::new(EventKind::Modify(ModifyKind::Name(RenameMode::From)))
                .set_info("root changed"),
        );
    }

    if flags.contains(StreamFlags::MOUNT) {
        evs.push(Event::new(EventKind::Create(CreateKind::Other)).set_info("mount"));
    }

    if flags.contains(StreamFlags::UNMOUNT) {
        evs.push(Event::new(EventKind::Remove(RemoveKind::Other)).set_info("mount"));
    }

    if flags.contains(StreamFlags::ITEM_CREATED) {
        evs.push(if flags.contains(StreamFlags::IS_DIR) {
            Event::new(EventKind::Create(CreateKind::Folder))
        } else if flags.contains(StreamFlags::IS_FILE) {
            Event::new(EventKind::Create(CreateKind::File))
        } else {
            let e = Event::new(EventKind::Create(CreateKind::Other));
            if flags.contains(StreamFlags::IS_SYMLINK) {
                e.set_info("is: symlink")
            } else if flags.contains(StreamFlags::IS_HARDLINK) {
                e.set_info("is: hardlink")
            } else if flags.contains(StreamFlags::ITEM_CLONED) {
                e.set_info("is: clone")
            } else {
                Event::new(EventKind::Create(CreateKind::Any))
            }
        });
    }

    if flags.contains(StreamFlags::ITEM_REMOVED) {
        evs.push(if flags.contains(StreamFlags::IS_DIR) {
            Event::new(EventKind::Remove(RemoveKind::Folder))
        } else if flags.contains(StreamFlags::IS_FILE) {
            Event::new(EventKind::Remove(RemoveKind::File))
        } else {
            let e = Event::new(EventKind::Remove(RemoveKind::Other));
            if flags.contains(StreamFlags::IS_SYMLINK) {
                e.set_info("is: symlink")
            } else if flags.contains(StreamFlags::IS_HARDLINK) {
                e.set_info("is: hardlink")
            } else if flags.contains(StreamFlags::ITEM_CLONED) {
                e.set_info("is: clone")
            } else {
                Event::new(EventKind::Remove(RemoveKind::Any))
            }
        });
    }

    // FSEvents 不提供 rename 两侧的关联信息。
    if flags.contains(StreamFlags::ITEM_RENAMED) {
        evs.push(Event::new(EventKind::Modify(ModifyKind::Name(
            RenameMode::Any,
        ))));
    }

    if flags.contains(StreamFlags::INODE_META_MOD) {
        evs.push(Event::new(EventKind::Modify(ModifyKind::Metadata(
            MetadataKind::Any,
        ))));
    }

    if flags.contains(StreamFlags::FINDER_INFO_MOD) {
        evs.push(
            Event::new(EventKind::Modify(ModifyKind::Metadata(MetadataKind::Other)))
                .set_info("meta: finder info"),
        );
    }

    if flags.contains(StreamFlags::ITEM_CHANGE_OWNER) {
        evs.push(Event::new(EventKind::Modify(ModifyKind::Metadata(
            MetadataKind::Ownership,
        ))));
    }

    if flags.contains(StreamFlags::ITEM_XATTR_MOD) {
        evs.push(Event::new(EventKind::Modify(ModifyKind::Metadata(
            MetadataKind::Extended,
        ))));
    }

    if flags.contains(StreamFlags::ITEM_MODIFIED) {
        evs.push(Event::new(EventKind::Modify(ModifyKind::Data(
            DataChange::Content,
        ))));
    }

    if flags.contains(StreamFlags::OWN_EVENT) {
        for ev in &mut evs {
            *ev = std::mem::take(ev).set_process_id(std::process::id());
        }
    }

    evs
}

struct StreamContextInfo {
    event_handler: Arc<Mutex<dyn EventHandler>>,
    recursive_info: HashMap<PathBuf, bool>,
}

// FSEventStreamContext 的 release 回调：流释放时回收 context。
extern "C" fn release_context(info: *const libc::c_void) {
    // Safety: `release` 只在流 dealloc 时被调用一次，`info` 必然来自本文件的 `Box::into_raw`。
    unsafe {
        drop(Box::from_raw(
            info as *const StreamContextInfo as *mut StreamContextInfo,
        ));
    }
}

extern "C" {
    /// 运行循环是否处于等待状态（fsevent-sys 未暴露，notify 亦自声明）。
    fn CFRunLoopIsWaiting(runloop: cf::CFRunLoopRef) -> cf::Boolean;
}

impl MacFseventWatcher {
    /// 构造带物理排除集合的后端；唯一可失败的步骤是 CFArray 分配，失败时把 handler 原样
    /// 交还调用方以便回退到 `RecommendedWatcher`。
    pub(super) fn with_exclusions<F: EventHandler>(
        event_handler: F,
        exclusions: &[PathBuf],
    ) -> std::result::Result<Self, F> {
        let paths = unsafe {
            cf::CFArrayCreateMutable(cf::kCFAllocatorDefault, 0, &cf::kCFTypeArrayCallBacks)
        };
        if paths.is_null() {
            return Err(event_handler);
        }
        // 硬上限：超过 8 个会令 `FSEventStreamSetExclusionPaths` 失败（Apple 头文件）。
        // 截断只损失成本收益，正确性由 W1 回调过滤兜底。
        if exclusions.len() > MAX_FSEVENT_EXCLUSIONS {
            log::warn!(
                "[WatchBackend] {} exclusion roots exceed FSEvents max {}; only first {} applied \
                 (callback filter still enforces the boundary)",
                exclusions.len(),
                MAX_FSEVENT_EXCLUSIONS,
                MAX_FSEVENT_EXCLUSIONS
            );
        }
        let exclusion_paths = exclusions
            .iter()
            .take(MAX_FSEVENT_EXCLUSIONS)
            .cloned()
            .collect();
        Ok(MacFseventWatcher {
            paths,
            exclusion_paths,
            since_when: fs::kFSEventStreamEventIdSinceNow,
            latency: 0.0,
            flags: fs::kFSEventStreamCreateFlagFileEvents | fs::kFSEventStreamCreateFlagNoDefer,
            event_handler: Arc::new(Mutex::new(event_handler)),
            runloop: None,
            recursive_info: HashMap::new(),
        })
    }

    fn watch_inner(&mut self, path: &Path, recursive_mode: RecursiveMode) -> Result<()> {
        self.stop();
        let result = self.append_path(path, recursive_mode);
        // 空 path 列表不算错：忽略 run() 的错误，与 notify 一致。
        let _ = self.run();
        result
    }

    fn unwatch_inner(&mut self, path: &Path) -> Result<()> {
        self.stop();
        let result = self.remove_path(path);
        let _ = self.run();
        result
    }

    /// 重建物理排除集合：集合变化时在运行中重启流。
    ///
    /// `FSEventStreamSetExclusionPaths` 只在 `FSEventStreamStart` 之前可设置，故必须
    /// `stop` → 更新集合 → `run`（与 `watch_inner` 同构）。集合未变则 no-op，避免无谓重建。
    pub(super) fn update_exclusions(&mut self, exclusions: &[PathBuf]) {
        let next: Vec<PathBuf> = exclusions
            .iter()
            .take(MAX_FSEVENT_EXCLUSIONS)
            .cloned()
            .collect();
        if next == self.exclusion_paths {
            return;
        }
        self.exclusion_paths = next;
        if self.is_running() {
            self.stop();
            let _ = self.run();
        }
    }

    #[inline]
    const fn is_running(&self) -> bool {
        self.runloop.is_some()
    }

    fn stop(&mut self) {
        if !self.is_running() {
            return;
        }

        if let Some((runloop, thread_handle)) = self.runloop.take() {
            unsafe {
                let runloop = runloop as *mut raw::c_void;

                while CFRunLoopIsWaiting(runloop) == 0 {
                    thread::yield_now();
                }

                cf::CFRunLoopStop(runloop);
            }

            let _ = thread_handle.join();
        }
    }

    fn remove_path(&mut self, path: &Path) -> Result<()> {
        let Some(str_path) = path.to_str() else {
            return Err(Error::generic("non-UTF-8 path cannot be watched"));
        };
        unsafe {
            let mut err: cf::CFErrorRef = ptr::null_mut();
            let cf_path = cf::str_path_to_cfstring_ref(str_path, &mut err);
            if cf_path.is_null() {
                if !err.is_null() {
                    cf::CFRelease(err as cf::CFRef);
                }
                return Err(Error::watch_not_found().add_path(path.into()));
            }

            let mut to_remove = Vec::new();
            for idx in 0..cf::CFArrayGetCount(self.paths) {
                let item = cf::CFArrayGetValueAtIndex(self.paths, idx);
                if cf::CFStringCompare(item, cf_path, cf::kCFCompareCaseInsensitive)
                    == cf::kCFCompareEqualTo
                {
                    to_remove.push(idx);
                }
            }

            cf::CFRelease(cf_path);

            for idx in to_remove.iter().rev() {
                cf::CFArrayRemoveValueAtIndex(self.paths, *idx);
            }
        }
        let p = if let Ok(canonicalized_path) = path.canonicalize() {
            canonicalized_path
        } else {
            path.to_owned()
        };
        match self.recursive_info.remove(&p) {
            Some(_) => Ok(()),
            None => Err(Error::watch_not_found()),
        }
    }

    // https://github.com/thibaudgg/rb-fsevent/blob/master/ext/fsevent_watch/main.c
    fn append_path(&mut self, path: &Path, recursive_mode: RecursiveMode) -> Result<()> {
        if !path.exists() {
            return Err(Error::path_not_found().add_path(path.into()));
        }
        let canonical_path = path.to_path_buf().canonicalize()?;
        let Some(str_path) = path.to_str() else {
            return Err(Error::generic("non-UTF-8 path cannot be watched"));
        };
        unsafe {
            let mut err: cf::CFErrorRef = ptr::null_mut();
            let cf_path = cf::str_path_to_cfstring_ref(str_path, &mut err);
            if cf_path.is_null() {
                if !err.is_null() {
                    cf::CFRelease(err as cf::CFRef);
                }
                return Err(Error::path_not_found().add_path(path.into()));
            }
            cf::CFArrayAppendValue(self.paths, cf_path);
            cf::CFRelease(cf_path);
        }
        self.recursive_info
            .insert(canonical_path, recursive_mode == RecursiveMode::Recursive);
        Ok(())
    }

    /// W2 核心：在 `FSEventStreamStart` **之前**为流设置物理排除集合。
    fn apply_exclusion_paths(stream: fs::FSEventStreamRef, exclusions: &[PathBuf]) {
        if exclusions.is_empty() || stream.is_null() {
            return;
        }
        unsafe {
            let array =
                cf::CFArrayCreateMutable(cf::kCFAllocatorDefault, 0, &cf::kCFTypeArrayCallBacks);
            if array.is_null() {
                log::warn!(
                    "[WatchBackend] failed to allocate exclusion CFArray; \
                     ignored subtrees will be filtered in callback instead"
                );
                return;
            }
            for path in exclusions {
                let Some(s) = path.to_str() else {
                    continue;
                };
                let mut err: cf::CFErrorRef = ptr::null_mut();
                let cf_str = cf::str_path_to_cfstring_ref(s, &mut err);
                if cf_str.is_null() {
                    if !err.is_null() {
                        cf::CFRelease(err as cf::CFRef);
                    }
                    log::debug!(
                        "[WatchBackend] exclusion path not resolvable: {}",
                        path.display()
                    );
                    continue;
                }
                cf::CFArrayAppendValue(array, cf_str);
                cf::CFRelease(cf_str);
            }
            if cf::CFArrayGetCount(array) > 0 {
                let ok = fs::FSEventStreamSetExclusionPaths(stream, array);
                if ok == 0 {
                    log::warn!(
                        "[WatchBackend] FSEventStreamSetExclusionPaths failed; \
                         ignored subtrees will be filtered in callback instead"
                    );
                }
            }
            cf::CFRelease(array);
        }
    }

    fn run(&mut self) -> Result<()> {
        if unsafe { cf::CFArrayGetCount(self.paths) } == 0 {
            return Err(Error::path_not_found());
        }

        // context 由 stream 持有，流释放时经 release_context 回收。
        let context = Box::into_raw(Box::new(StreamContextInfo {
            event_handler: self.event_handler.clone(),
            recursive_info: self.recursive_info.clone(),
        }));

        let stream_context = fs::FSEventStreamContext {
            version: 0,
            info: context as *mut libc::c_void,
            retain: None,
            release: Some(release_context),
            copy_description: None,
        };

        let stream = unsafe {
            fs::FSEventStreamCreate(
                cf::kCFAllocatorDefault,
                callback,
                &stream_context,
                self.paths,
                self.since_when,
                self.latency,
                self.flags,
            )
        };

        if stream.is_null() {
            // 流创建失败 ⇒ context 不会被 retain/release，需手工回收。
            unsafe { drop(Box::from_raw(context)) };
            return Err(Error::generic("FSEventStreamCreate failed"));
        }

        // 关键顺序：排除集合必须在 FSEventStreamStart 之前设置。
        Self::apply_exclusion_paths(stream, &self.exclusion_paths);

        // CFRef 可跨线程移动（Apple 线程安全约定）。
        struct CfSendWrapper(cf::CFRef);
        unsafe impl Send for CfSendWrapper {}

        let raw_stream = stream;
        let stream = CfSendWrapper(stream);
        let (rl_tx, rl_rx) = std::sync::mpsc::channel::<CfSendWrapper>();

        let thread_handle = thread::Builder::new()
            .name("neeko-fsevents-loop".to_string())
            .spawn(move || {
                // 强制捕获整个 wrapper：Rust 2021 精确捕获会把 `stream.0` 拆成
                // 裸 `*mut c_void` 字段（!Send），这行让捕获的是 `CfSendWrapper`（Send）。
                let _ = &stream;
                let stream = stream.0;

                unsafe {
                    let cur_runloop = cf::CFRunLoopGetCurrent();

                    fs::FSEventStreamScheduleWithRunLoop(
                        stream,
                        cur_runloop,
                        cf::kCFRunLoopDefaultMode,
                    );
                    if fs::FSEventStreamStart(stream) == 0 {
                        log::warn!("[WatchBackend] FSEventStreamStart returned false");
                    }

                    let _ = rl_tx.send(CfSendWrapper(cur_runloop));

                    cf::CFRunLoopRun();
                    fs::FSEventStreamStop(stream);
                    fs::FSEventStreamInvalidate(stream);
                    fs::FSEventStreamRelease(stream);
                }
            });

        let thread_handle = match thread_handle {
            Ok(handle) => handle,
            Err(e) => {
                // spawn 失败：流尚未 schedule/start，直接回收（context 由 release_context 回收）。
                unsafe {
                    fs::FSEventStreamInvalidate(raw_stream);
                    fs::FSEventStreamRelease(raw_stream);
                }
                return Err(Error::io(e));
            }
        };

        // 阻塞直到 runloop 被回传。
        match rl_rx.recv() {
            Ok(runloop) => {
                self.runloop = Some((runloop.0, thread_handle));
                Ok(())
            }
            Err(_) => {
                let _ = thread_handle.join();
                Err(Error::generic("fsevents runloop thread terminated early"))
            }
        }
    }
}

extern "C" fn callback(
    stream_ref: fs::FSEventStreamRef,
    info: *mut libc::c_void,
    num_events: libc::size_t,
    event_paths: *mut libc::c_void,
    event_flags: *const fs::FSEventStreamEventFlags,
    event_ids: *const fs::FSEventStreamEventId,
) {
    unsafe {
        callback_impl(
            stream_ref,
            info,
            num_events,
            event_paths,
            event_flags,
            event_ids,
        );
    }
}

unsafe fn callback_impl(
    _stream_ref: fs::FSEventStreamRef,
    info: *mut libc::c_void,
    num_events: libc::size_t,
    event_paths: *mut libc::c_void,
    event_flags: *const fs::FSEventStreamEventFlags,
    _event_ids: *const fs::FSEventStreamEventId,
) {
    let event_paths = event_paths as *const *const libc::c_char;
    let info = info as *const StreamContextInfo;
    let event_handler = &(*info).event_handler;

    for p in 0..num_events {
        let Ok(path) = CStr::from_ptr(*event_paths.add(p)).to_str() else {
            continue;
        };
        let path = PathBuf::from(path);

        let flag = *event_flags.add(p);
        let flag = StreamFlags::from_bits_truncate(flag);

        let mut handle_event = false;
        for (watched, recursive) in &(*info).recursive_info {
            if path.starts_with(watched) {
                if *recursive || &path == watched {
                    handle_event = true;
                    break;
                } else if let Some(parent_path) = path.parent() {
                    if parent_path == watched {
                        handle_event = true;
                        break;
                    }
                }
            }
        }

        if !handle_event {
            continue;
        }

        for ev in translate_flags(flag, true) {
            let ev = ev.add_path(path.clone());
            let mut event_handler = match event_handler.lock() {
                Ok(guard) => guard,
                Err(poisoned) => poisoned.into_inner(),
            };
            event_handler.handle_event(Ok(ev));
        }
    }
}

impl Watcher for MacFseventWatcher {
    /// 无排除集合的默认构造（需要排除时请用 [`Self::with_exclusions`]）。
    fn new<F: EventHandler>(event_handler: F, _config: Config) -> Result<Self> {
        Self::with_exclusions(event_handler, &[])
            .map_err(|_| Error::generic("failed to allocate FSEvents path array"))
    }

    fn watch(&mut self, path: &Path, recursive_mode: RecursiveMode) -> Result<()> {
        self.watch_inner(path, recursive_mode)
    }

    fn unwatch(&mut self, path: &Path) -> Result<()> {
        self.unwatch_inner(path)
    }

    /// FSEvents 本就忽略 notify 的 `Config`（与上游一致，恒返回 `false`）。
    fn configure(&mut self, _config: Config) -> Result<bool> {
        Ok(false)
    }

    fn kind() -> WatcherKind {
        WatcherKind::Fsevent
    }
}

impl Drop for MacFseventWatcher {
    fn drop(&mut self) {
        self.stop();
        unsafe {
            if !self.paths.is_null() {
                cf::CFRelease(self.paths);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::{Duration, Instant};

    /// 静默窗口必须大于 notify/debounce 的 max_wait（1.5s），确保「没有事件」是真结论。
    const QUIET_WINDOW: Duration = Duration::from_millis(2000);
    const FIRST_EVENT_TIMEOUT: Duration = Duration::from_secs(8);

    /// 纯函数：截断到 FSEvents 硬上限，且保留前 N 个（顺序稳定）。
    #[test]
    fn exclusion_cap_is_applied_at_construction() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let many: Vec<PathBuf> = (0..12).map(|i| root.join(format!("ignored-{i}"))).collect();
        let (tx, _rx) = mpsc::channel::<notify::Result<Event>>();
        let watcher = MacFseventWatcher::with_exclusions(tx, &many).unwrap();
        assert_eq!(watcher.exclusion_paths.len(), MAX_FSEVENT_EXCLUSIONS);
        assert_eq!(watcher.exclusion_paths, many[..MAX_FSEVENT_EXCLUSIONS]);
    }

    /// 纯状态：重建排除集合替换为新集合，并保留硬上限截断。
    #[test]
    fn update_exclusions_replaces_set_and_truncates() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let first = root.join("first");
        let many: Vec<PathBuf> = (0..12).map(|i| root.join(format!("ignored-{i}"))).collect();
        let (tx, _rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher =
            MacFseventWatcher::with_exclusions(tx, std::slice::from_ref(&first)).unwrap();

        // 未运行：只更新集合，不触发流重建。
        watcher.update_exclusions(&many);
        assert_eq!(watcher.exclusion_paths.len(), MAX_FSEVENT_EXCLUSIONS);
        assert_eq!(watcher.exclusion_paths, many[..MAX_FSEVENT_EXCLUSIONS]);

        // 相同集合：no-op（不改变既有状态）。
        watcher.update_exclusions(&many);
        assert_eq!(watcher.exclusion_paths, many[..MAX_FSEVENT_EXCLUSIONS]);
    }

    /// 真实 FSEvents：撤销排除后，原本被物理排除的子树必须恢复事件投递。
    ///
    /// 对应 `.gitignore` 撤销忽略后的 §14 下界：物理排除集合是 ignore 规则的派生值，
    /// 规则变化必须重组流，否则新可见子树无界陈旧。
    #[test]
    fn updated_exclusions_resume_delivery_for_newly_visible_subtree() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let heavy = root.join("heavy");
        std::fs::create_dir_all(&heavy).unwrap();

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher =
            MacFseventWatcher::with_exclusions(tx, std::slice::from_ref(&heavy)).unwrap();
        watcher.watch(&root, RecursiveMode::Recursive).unwrap();

        std::thread::sleep(Duration::from_millis(500));
        drain(&rx);

        // 撤销排除：规则变化后维护线程会重建流。
        watcher.update_exclusions(&[]);

        let heavy_canonical = heavy.canonicalize().unwrap();
        let deadline = Instant::now() + FIRST_EVENT_TIMEOUT;
        let file = heavy.join("x.o");
        let mut arrived = false;
        while Instant::now() < deadline && !arrived {
            std::fs::write(&file, b"churn").unwrap();
            std::thread::sleep(Duration::from_millis(200));
            while let Ok(event) = rx.try_recv() {
                if let Ok(event) = event {
                    if event.paths.iter().any(|p| p.starts_with(&heavy_canonical)) {
                        arrived = true;
                        break;
                    }
                }
            }
        }
        drop(watcher);
        assert!(arrived, "撤销排除后新可见子树的事件必须恢复投递");
    }

    /// 真实 FSEvents 差分用例（macOS only）：
    /// 1) 在**排除**子树内写入 → 静默窗口后事件数回到基线（delta == 0）；
    /// 2) 在**可见**子树写入 → 事件单向可达（`≥`，不做精确集合断言）。
    #[test]
    fn excluded_subtree_delivers_zero_events_visible_subtree_still_arrives() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        let excluded = root.join("heavy");
        let visible = root.join("visible");
        std::fs::create_dir_all(&excluded).unwrap();
        std::fs::create_dir_all(&visible).unwrap();

        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        let mut watcher =
            MacFseventWatcher::with_exclusions(tx, &[excluded.clone()]).expect("construct watcher");
        watcher
            .watch(root, RecursiveMode::Recursive)
            .expect("watch root");

        // 让 FSEvents 流稳定后再取基线（历史事件 / 启动噪声）。
        std::thread::sleep(Duration::from_millis(500));
        drain(&rx);
        let baseline = count(&rx); // 取基线后仍可能有迟到事件，故用差分式 + 静默窗口

        std::fs::write(excluded.join("build.o"), b"churn").unwrap();
        std::thread::sleep(QUIET_WINDOW);
        let after_excluded = count(&rx);
        assert_eq!(
            after_excluded, baseline,
            "排除子树内写入必须零投递（基线差分为 0）"
        );

        // 正向：可见子树写入必须至少到达一次（单向可达，不做精确集合断言）。
        // FSEvents 投递的是 canonical 路径（tempdir 在 macOS 上位于 `/var → /private/var`
        // 符号链接下），比较前先归一，否则路径前缀永远不匹配。
        let visible_canonical = visible.canonicalize().unwrap();
        let deadline = Instant::now() + FIRST_EVENT_TIMEOUT;
        let visible_file = visible.join("main.rs");
        let mut arrived = false;
        while Instant::now() < deadline && !arrived {
            std::fs::write(&visible_file, b"fn main() {}").unwrap();
            std::thread::sleep(Duration::from_millis(200));
            while let Ok(event) = rx.try_recv() {
                if let Ok(event) = event {
                    if event
                        .paths
                        .iter()
                        .any(|p| p.starts_with(&visible_canonical))
                    {
                        arrived = true;
                        break;
                    }
                }
            }
        }
        drop(watcher);
        assert!(arrived, "可见子树写入必须在超时内到达回调");
    }

    /// AC2：被排除（ignored）目录**自身**的创建/删除仍被投递 —— exclusion 只过滤其**内部**
    /// 变化，边界事件由父目录监听捕获（灰节点更新）。
    #[test]
    fn excluded_root_boundary_event_still_arrives() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().canonicalize().unwrap();
        let excluded = root.join("target");
        let (tx, rx) = mpsc::channel::<notify::Result<Event>>();
        // 排除路径在构造期尚不存在：`str_path_to_cfstring_ref` 仍能正确解析。
        let mut watcher =
            MacFseventWatcher::with_exclusions(tx, std::slice::from_ref(&excluded)).unwrap();
        watcher.watch(&root, RecursiveMode::Recursive).unwrap();

        std::thread::sleep(Duration::from_millis(500));
        drain(&rx);

        // 正向可达（≥）：创建被排除根必须至少到达一次边界事件。
        let deadline = Instant::now() + FIRST_EVENT_TIMEOUT;
        let mut arrived = false;
        while Instant::now() < deadline && !arrived {
            std::fs::create_dir_all(&excluded).unwrap();
            std::thread::sleep(Duration::from_millis(200));
            while let Ok(event) = rx.try_recv() {
                if let Ok(event) = event {
                    if event.paths.iter().any(|p| p == &excluded) {
                        arrived = true;
                        break;
                    }
                }
            }
        }
        drop(watcher);
        assert!(arrived, "被排除根自身的边界事件必须仍被投递（灰节点更新）");
    }

    /// 排空通道（不计数）。
    fn drain(rx: &mpsc::Receiver<notify::Result<Event>>) {
        while rx.try_recv().is_ok() {}
    }

    /// 排空并计数（测试内的非确定性域：只用于差分，不做绝对零断言）。
    fn count(rx: &mpsc::Receiver<notify::Result<Event>>) -> usize {
        let mut n = 0;
        while let Ok(_event) = rx.try_recv() {
            n += 1;
        }
        n
    }
}
