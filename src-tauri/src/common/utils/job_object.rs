/// Windows Job Object helper for process-tree termination.
///
/// When a PTY child process is spawned we immediately create a Job Object and
/// assign the child to it.  The Job is configured with
/// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` so that dropping the `JobHandle`
/// (which closes the underlying HANDLE) automatically terminates every process
/// in the job — including grandchildren such as the `node` process that
/// `cmd /c npm run dev` creates.
///
/// ## Compatibility
/// Job Objects have been available since Windows XP.  Windows 8+ supports
/// nested jobs; on Windows 7 `AssignProcessToJobObject` will fail when the
/// process is already in an incompatible job (e.g. some CI environments).
/// We treat failures as non-fatal and fall back to the existing single-process
/// `TerminateProcess` behaviour.
#[cfg(windows)]
mod inner {
    use std::io;
    use std::os::windows::io::RawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_BASIC_LIMIT_INFORMATION,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };
    use windows_sys::Win32::System::Threading::IO_COUNTERS;

    /// Owned wrapper around a Windows Job Object HANDLE.
    ///
    /// When this value is dropped the HANDLE is closed, which — thanks to
    /// `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` — kills every process still
    /// assigned to the job.
    pub struct JobHandle(HANDLE);

    // HANDLE is just a pointer-sized integer; it is safe to send across
    // threads because we never share it (single-owner).
    /// # Safety
    /// `JobHandle` wraps a raw Windows HANDLE in a single-owner pattern.
    /// The HANDLE is never shared or aliased across threads. The `Drop`
    /// implementation ensures the handle is closed exactly once.
    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    impl Drop for JobHandle {
        fn drop(&mut self) {
            if self.0 != 0 && self.0 != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(self.0) };
            }
        }
    }

    impl std::fmt::Debug for JobHandle {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            write!(f, "JobHandle({:?})", self.0 as *const ())
        }
    }

    /// Create a Job Object and assign `proc_handle` to it.
    ///
    /// Returns `Ok(JobHandle)` on success.  The caller must keep the returned
    /// value alive for as long as the child process should be tracked; dropping
    /// it kills the entire process tree.
    ///
    /// Returns `Err` if Job Object creation or assignment fails.  Callers
    /// should treat this as non-fatal and fall back to single-process kill.
    pub fn create_job_for_process(proc_handle: RawHandle) -> io::Result<JobHandle> {
        unsafe {
            // 1. Create an anonymous job object.
            let job = CreateJobObjectW(
                std::ptr::null::<SECURITY_ATTRIBUTES>() as _,
                std::ptr::null(), // anonymous
            );
            if job == 0 || job == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }

            // 2. Configure: kill all processes when the last job handle is closed.
            // IO_COUNTERS does not implement Default, so we zero-initialise via
            // a zeroed() transmute-safe approach.
            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
                BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                    LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                    PerProcessUserTimeLimit: 0,
                    PerJobUserTimeLimit: 0,
                    MinimumWorkingSetSize: 0,
                    MaximumWorkingSetSize: 0,
                    ActiveProcessLimit: 0,
                    Affinity: 0,
                    PriorityClass: 0,
                    SchedulingClass: 0,
                },
                IoInfo: IO_COUNTERS {
                    ReadOperationCount: 0,
                    WriteOperationCount: 0,
                    OtherOperationCount: 0,
                    ReadTransferCount: 0,
                    WriteTransferCount: 0,
                    OtherTransferCount: 0,
                },
                ProcessMemoryLimit: 0,
                JobMemoryLimit: 0,
                PeakProcessMemoryUsed: 0,
                PeakJobMemoryUsed: 0,
            };

            let ok = SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &mut info as *mut _ as *mut _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            if ok == FALSE {
                let err = io::Error::last_os_error();
                CloseHandle(job);
                return Err(err);
            }

            // 3. Assign the spawned process to the job.
            let ok = AssignProcessToJobObject(job, proc_handle as HANDLE);
            if ok == FALSE {
                let err = io::Error::last_os_error();
                CloseHandle(job);
                return Err(err);
            }

            Ok(JobHandle(job))
        }
    }
}

#[cfg(windows)]
pub use inner::{create_job_for_process, JobHandle};
