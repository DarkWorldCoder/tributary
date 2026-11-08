use shared_child::SharedChild;
use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::Duration;

struct Runtime {
    child: SharedChild,
    stopping: AtomicBool,
}

impl Runtime {
    fn stop(self: &Arc<Self>, force: bool) {
        let first = !self.stopping.swap(true, Ordering::SeqCst);
        if force {
            let _ = self.child.kill();
        } else if first {
            #[cfg(unix)]
            {
                use shared_child::unix::SharedChildExt;
                let _ = self.child.send_signal(libc::SIGTERM);
            }
            #[cfg(windows)]
            let _ = self.child.kill();
        }
        if first {
            let runtime = Arc::clone(self);
            // Only one deadline thread per runtime. SharedChild synchronizes
            // signal delivery and reap, so an exited PID cannot be reused here.
            if worker("stop-deadline", move || {
                thread::sleep(Duration::from_secs(1));
                let _ = runtime.child.kill();
            }).is_err() {
                let _ = self.child.kill();
            }
        }
    }
}

fn worker<T: Send + 'static>(name: &str, action: impl FnOnce() -> T + Send + 'static) -> io::Result<thread::JoinHandle<T>> {
    thread::Builder::new().name(name.into()).stack_size(64 * 1024).spawn(action)
}

fn stdout_file() -> io::Result<fs::File> {
    #[cfg(unix)]
    {
        use std::os::fd::AsFd;
        Ok(fs::File::from(io::stdout().as_fd().try_clone_to_owned()?))
    }
    #[cfg(windows)]
    {
        use std::os::windows::io::AsHandle;
        Ok(fs::File::from(io::stdout().as_handle().try_clone_to_owned()?))
    }
}

fn forward(input: &mut impl Read, output: &mut impl Write) -> io::Result<()> {
    // Explicit bounded userspace copying avoids Linux kernel-offloaded copy
    // holding the input pipe while the owner stops reading the output pipe.
    let mut bytes = [0; 8192];
    loop {
        match input.read(&mut bytes) {
            Ok(0) => return Ok(()),
            Ok(length) => output.write_all(&bytes[..length])?,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
}

struct Owner {
    runtime: Arc<Runtime>,
}

impl Drop for Owner {
    fn drop(&mut self) {
        let _ = self.runtime.child.kill();
        let _ = self.runtime.child.wait();
    }
}

struct PrivateDirectory(Option<PathBuf>);

impl Drop for PrivateDirectory {
    fn drop(&mut self) {
        // Only the manager's explicit ephemeral-key directory is owned. A
        // caller's workspace must never be removed based on its name alone.
        let Some(directory) = &self.0 else { return; };
        if directory.file_name().is_some_and(|name| name.to_string_lossy().starts_with("local-engine-")) {
            if let Some(parent) = directory.parent() {
                if std::env::set_current_dir(parent).is_ok() {
                    let _ = fs::remove_dir_all(directory);
                }
            }
        }
    }
}

pub fn run(args: impl Iterator<Item = std::ffi::OsString>) -> io::Result<i32> {
    let mut args = args.peekable();
    let cleanup = args.peek().is_some_and(|arg| arg == "--cleanup-owned-cwd");
    if cleanup { args.next(); }
    if args.peek().is_some_and(|arg| arg == "--") { args.next(); }
    let _directory = PrivateDirectory(if cleanup { Some(std::env::current_dir()?) } else { None });
    let executable = args.next().ok_or_else(|| io::Error::other("choose a runtime executable"))?;
    let mut owner_output = stdout_file()?;
    #[cfg(unix)]
    let mut signals = signal_hook::iterator::Signals::new([libc::SIGTERM, libc::SIGINT])?;
    let mut command = Command::new(executable);
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW, like windowsHide.
    }
    let runtime = Arc::new(Runtime { child: SharedChild::spawn(&mut command)?, stopping: AtomicBool::new(false) });
    // The child owns its process/stdio handles. Its launch configuration does
    // not need to stay allocated for the lifetime of a loaded local model.
    drop(command);
    let owner = Owner { runtime: Arc::clone(&runtime) };
    let mut output = runtime.child.take_stdout().ok_or_else(|| io::Error::other("missing runtime stdout"))?;

    // One bounded metadata line precedes all runtime stdout. Runtime stderr
    // directly inherits the owner's pipe; neither stream accumulates history.
    writeln!(io::stdout().lock(), "{{\"runtimePid\":{}}}", runtime.child.id())?;
    io::stdout().flush()?;
    let control_runtime = Arc::clone(&runtime);
    worker("owner-pipe", move || {
        let mut byte = [0];
        loop {
            match io::stdin().read(&mut byte) {
                Ok(1) => control_runtime.stop(byte[0] == b'K'),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                _ => { control_runtime.stop(false); return; }
            }
        }
    })?;
    #[cfg(unix)]
    {
        let signal_runtime = Arc::clone(&runtime);
        worker("owner-signals", move || {
            for _ in signals.forever() { signal_runtime.stop(false); }
        })?;
    }

    let (sender, drained) = mpsc::sync_channel(1);
    let output_runtime = Arc::clone(&runtime);
    worker("runtime-stdout", move || {
        // This private owned descriptor also avoids holding Rust's global
        // stdout mutex across a blocked write during process-exit cleanup.
        let result = forward(&mut output, &mut owner_output);
        if result.is_err() { output_runtime.stop(true); }
        let _ = sender.send(());
    })?;
    let status = match runtime.child.wait() {
        Ok(status) => status,
        Err(error) => { runtime.stop(true); return Err(error); }
    };
    // Preserve complete output on a natural exit, but a paused/broken owner
    // pipe must not prevent shutdown and private-key cleanup indefinitely.
    while !runtime.stopping.load(Ordering::SeqCst) {
        match drained.recv_timeout(Duration::from_millis(50)) {
            Ok(()) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
        }
    }
    let code = if runtime.stopping.load(Ordering::SeqCst) { 0 } else { status.code().filter(|code| *code != 0).unwrap_or(1) };
    drop(owner);
    Ok(code)
}
