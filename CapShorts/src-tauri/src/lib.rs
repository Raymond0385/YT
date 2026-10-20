use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

struct BackendProcess(Mutex<Option<Child>>);

/// Windows: a job object that kills the engine (and everything it started, like FFmpeg) when Kadr exits
/// for any reason: closed, crashed, killed or restarted by the updater. The handle is never closed by us;
/// Windows closes it when this process ends, which ends the job.
#[cfg(target_os = "windows")]
mod engine_job {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_BREAKAWAY_OK, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
    };

    pub struct Job(HANDLE);
    unsafe impl Send for Job {}
    unsafe impl Sync for Job {}

    impl Job {
        pub fn kill_on_close() -> Option<Job> {
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if handle.is_null() {
                    return None;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                // BREAKAWAY_OK: the engine may start a process that must outlive Kadr (the update installer)
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_BREAKAWAY_OK;
                let ok = SetInformationJobObject(
                    handle,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    CloseHandle(handle);
                    return None;
                }
                Some(Job(handle))
            }
        }

        pub fn assign(&self, child: &std::process::Child) -> bool {
            unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) != 0 }
        }
    }
}

#[cfg(target_os = "windows")]
struct EngineJob(Mutex<Option<engine_job::Job>>);

/// Stops the engine and every process it started, and waits until that is done.
fn stop_engine(child: &mut Child) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &child.id().to_string()])
            .creation_flags(CREATE_NO_WINDOW)
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! Kadr AI engine is ready.", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![greet])
        .setup(|app| {
            println!("[tauri] Kadr Desktop App launching...");

            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                // An engine left over from an older version (which did not stop with the app) would keep
                // the port and answer instead of the new one.
                let _ = Command::new("taskkill")
                    .args(["/F", "/T", "/IM", "backend-engine.exe"])
                    .creation_flags(CREATE_NO_WINDOW)
                    .status();
                app.manage(EngineJob(Mutex::new(engine_job::Job::kill_on_close())));
            }

            // Find backend-engine executable next to the app or in resources
            if let Ok(resource_dir) = app.path().resource_dir() {
                let candidate_paths = [
                    resource_dir.join("backend-engine.exe"),
                    resource_dir.join("backend-engine"),
                    resource_dir.join("binaries").join("backend-engine.exe"),
                    resource_dir.join("binaries").join("backend-engine"),
                    resource_dir.join("Kadr").join("backend-engine.exe"),
                    std::env::current_exe()
                        .ok()
                        .and_then(|p| p.parent().map(|d| d.join("binaries").join("backend-engine.exe")))
                        .unwrap_or_default(),
                    std::env::current_exe()
                        .ok()
                        .and_then(|p| p.parent().map(|d| d.join("binaries").join("backend-engine")))
                        .unwrap_or_default(),
                    std::env::current_exe()
                        .ok()
                        .and_then(|p| p.parent().map(|d| d.join("backend-engine.exe")))
                        .unwrap_or_default(),
                    std::env::current_exe()
                        .ok()
                        .and_then(|p| p.parent().map(|d| d.join("backend-engine")))
                        .unwrap_or_default(),
                ];

                for engine_path in &candidate_paths {
                    if engine_path.exists() {
                        println!("[tauri] Spawning AI Backend: {:?}", engine_path);
                        
                        #[cfg(target_os = "windows")]
                        {
                            use std::os::windows::process::CommandExt;
                            const CREATE_NO_WINDOW: u32 = 0x08000000;

                            if let Ok(child) = Command::new(engine_path)
                                .env("KADR_PARENT_PID", std::process::id().to_string())
                                .creation_flags(CREATE_NO_WINDOW)
                                .spawn()
                            {
                                if let Some(job) = app.try_state::<EngineJob>() {
                                    if let Some(job) = job.0.lock().unwrap().as_ref() {
                                        if !job.assign(&child) {
                                            println!("[tauri] could not tie the engine to the app; it will stop by itself");
                                        }
                                    }
                                }
                                if let Some(state) = app.try_state::<BackendProcess>() {
                                    *state.0.lock().unwrap() = Some(child);
                                }
                                println!("[tauri] Windows backend daemon running in background.");
                                break;
                            }
                        }

                        #[cfg(not(target_os = "windows"))]
                        {
                            use std::process::Stdio;
                            if let Ok(child) = Command::new(engine_path)
                                .env("KADR_PARENT_PID", std::process::id().to_string())
                                .stdout(Stdio::null())
                                .stderr(Stdio::null())
                                .spawn()
                            {
                                if let Some(state) = app.try_state::<BackendProcess>() {
                                    *state.0.lock().unwrap() = Some(child);
                                }
                                println!("[tauri] macOS/Unix backend daemon running in background.");
                                break;
                            }
                        }
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { .. } | tauri::WindowEvent::Destroyed => {
                    // Ensure backend engine and all child processes are killed when window closes
                    if let Some(state) = window.try_state::<BackendProcess>() {
                        if let Ok(mut lock) = state.0.lock() {
                            if let Some(mut child) = lock.take() {
                                stop_engine(&mut child);
                                println!("[tauri] Background AI Engine terminated.");
                            }
                        }
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Kadr application");
}
