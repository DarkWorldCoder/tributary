use std::collections::BinaryHeap;
use std::fs;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

// This process owns its directory handles and a bounded lexical result prefix.
// It emits nothing until traversal succeeds; unsupported names use the JS path.
struct Scan<'a> {
    base: PathBuf,
    needle: &'a str,
    show_hidden: bool,
    limit: usize,
    files: BinaryHeap<String>,
    scratch: String,
    total: u64,
    visited: u64,
    unreadable: u64,
}

fn skipped(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | ".venv" | "venv" | "target" | "dist" | "build" | ".next")
}

fn append_relative(output: &mut String, rel: &str, name: &str) {
    if !rel.is_empty() {
        output.push_str(rel);
        output.push('/');
    }
    output.push_str(name);
}

fn relative_name(rel: &str, name: &str) -> String {
    let mut output = String::with_capacity(rel.len() + usize::from(!rel.is_empty()) + name.len());
    append_relative(&mut output, rel, name);
    output
}

impl Scan<'_> {
    fn accept(&mut self, rel: &str, name: &str) {
        self.total += 1;
        let full = self.files.len() == self.limit;
        // Compare the virtual relative path before allocating an owned result.
        if full && self.files.peek().is_some_and(|largest| {
            rel.bytes().chain((!rel.is_empty()).then_some(b'/')).chain(name.bytes()).cmp(largest.bytes()).is_ge()
        }) {
            return;
        }
        let file = relative_name(rel, name);
        if full {
            *self.files.peek_mut().unwrap() = file;
        } else {
            self.files.push(file);
        }
    }

    fn matches(&mut self, rel: &str, name: &str) -> bool {
        self.scratch.clear();
        append_relative(&mut self.scratch, rel, name);
        self.scratch.make_ascii_lowercase();
        self.scratch.contains(self.needle)
    }

    fn walk(&mut self, rel: &str, depth: usize) -> io::Result<()> {
        if depth > 128 {
            return Err(io::Error::other("folder depth limit"));
        }
        let opened = || -> io::Result<Option<fs::ReadDir>> {
            let physical = fs::canonicalize(self.base.join(rel))?;
            if !physical.starts_with(&self.base) {
                return Ok(None);
            }
            fs::read_dir(physical).map(Some)
        };
        let directory = match opened() {
            Ok(Some(directory)) => directory,
            Ok(None) => { self.unreadable += 1; return Ok(()); }
            Err(error) if !rel.is_empty() && matches!(error.kind(), io::ErrorKind::PermissionDenied | io::ErrorKind::NotFound | io::ErrorKind::NotADirectory) => {
                self.unreadable += 1;
                return Ok(());
            }
            Err(error) => return Err(error),
        };
        let local_needle = !self.needle.contains('/');
        let parent_matches = local_needle && self.matches("", rel);
        for entry in directory {
            let entry = entry?;
            self.visited += 1;
            let name = entry.file_name();
            let name = name.to_str().ok_or_else(|| io::Error::other("non-UTF8 name"))?;
            // Rust and the installed V8 can have different Unicode case tables.
            // Preserve the JS contract rather than silently changing matches/order.
            if !name.is_ascii() { return Err(io::Error::other("Unicode name requires JS search")); }
            let kind = entry.file_type()?;
            if kind.is_symlink() || !self.show_hidden && name.starts_with('.') { continue; }
            if kind.is_dir() {
                if !skipped(name) {
                    let child = relative_name(rel, name);
                    self.walk(&child, depth + 1)?;
                }
            } else if kind.is_file() {
                if local_needle {
                    if parent_matches || self.matches("", name) {
                        self.accept(rel, name);
                    }
                } else if self.matches(rel, name) {
                    self.accept(rel, name);
                }
            }
        }
        Ok(())
    }
}

fn quoted(output: &mut impl Write, text: &str) -> io::Result<()> {
    output.write_all(b"\"")?;
    for byte in text.bytes() {
        match byte {
            b'"' => output.write_all(b"\\\"")?,
            b'\\' => output.write_all(b"\\\\")?,
            0..=31 => write!(output, "\\u{byte:04x}")?,
            _ => output.write_all(&[byte])?,
        }
    }
    output.write_all(b"\"")
}

fn main_scan() -> io::Result<()> {
    let mut args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() == 1 && args[0] == "--identity" {
        return writeln!(io::stdout().lock(), "{{\"protocol\":1,\"arch\":\"{}\",\"os\":\"{}\"}}", std::env::consts::ARCH, std::env::consts::OS);
    }
    if args.last().is_some_and(|arg| arg == "--parent-pipe") {
        args.pop();
        // The process must not outlive a crashed owner while walking or blocked
        // on output. A small dedicated stack watches the parent's pipe on every
        // platform; normal CLI invocations do not create this thread.
        std::thread::Builder::new().name("owner-pipe".into()).stack_size(64 * 1024).spawn(|| {
            let mut byte = [0];
            loop {
                match io::stdin().read(&mut byte) {
                    Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                    _ => std::process::exit(3),
                }
            }
        })?;
    }
    if args.len() != 5 || args[0] != "scan-files" { return Err(io::Error::other("invalid command")); }
    let needle = args[2].to_str().ok_or_else(|| io::Error::other("invalid query"))?;
    let limit: usize = args[3].to_str().and_then(|text| text.parse().ok()).ok_or_else(|| io::Error::other("invalid limit"))?;
    if needle.is_empty() || !needle.is_ascii() || needle.len() > 512 || !(1..=2000).contains(&limit) || !(args[4] == "true" || args[4] == "false") {
        return Err(io::Error::other("unsupported request"));
    }
    let mut scan = Scan { base: fs::canonicalize(Path::new(&args[1]))?, needle, show_hidden: args[4] == "true", limit, files: BinaryHeap::new(), scratch: String::new(), total: 0, visited: 0, unreadable: 0 };
    scan.walk("", 0)?;
    let files = scan.files.into_sorted_vec();
    let mut output = io::BufWriter::new(io::stdout().lock());
    output.write_all(b"{\"protocol\":1}\n")?;
    let count = files.len();
    for file in files {
        output.write_all(b"{\"file\":")?;
        quoted(&mut output, &file)?;
        output.write_all(b"}\n")?;
    }
    writeln!(output, "{{\"complete\":true,\"total\":{},\"visited\":{},\"unreadable\":{},\"limited\":{}}}", scan.total, scan.visited, scan.unreadable, scan.total > count as u64)?;
    output.flush()
}

fn main() {
    if main_scan().is_err() {
        // The bridge falls back to the complete JS implementation. No partial
        // prefix is accepted after a failed or unsupported traversal.
        eprintln!("Native discovery could not complete this request.");
        std::process::exit(2);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scanner(needle: &str, limit: usize) -> Scan<'_> {
        Scan { base: PathBuf::new(), needle, show_hidden: true, limit, files: BinaryHeap::new(), scratch: String::new(), total: 0, visited: 0, unreadable: 0 }
    }

    #[test]
    fn borrowed_admission_preserves_the_complete_lexical_prefix_and_total() {
        let paths = [("", "A.rs"), ("", "a.rs"), ("a", "file.rs"), ("a-", "file.rs"), ("a/b", "file.rs"), ("a", "file.rs~"), ("", "quote\".rs"), ("a", "line\n.rs")];
        let mut expected: Vec<_> = paths.iter().map(|(rel, name)| if rel.is_empty() { name.to_string() } else { format!("{rel}/{name}") }).collect();
        expected.sort();
        for limit in [1, 2, 7, 2000] {
            for reverse in [false, true] {
                let mut scan = scanner("rs", limit);
                for index in 0..paths.len() {
                    let (rel, name) = paths[if reverse { paths.len() - 1 - index } else { index }];
                    scan.accept(rel, name);
                }
                assert_eq!(scan.total, paths.len() as u64);
                assert_eq!(scan.files.into_sorted_vec(), expected[..expected.len().min(limit)]);
            }
        }
    }

    #[test]
    fn reusable_matching_preserves_ascii_case_and_path_boundary_behavior() {
        let paths = [("", "Source.TS"), ("Src/Mixed", "Target.RS"), ("A", "B.rs"), ("", "other"), ("", "line\n.TS")];
        for needle in ["source", "src/mixed/target", "a/b", "b.rs", ".ts", "\n.", "missing", "SOURCE"] {
            let mut scan = scanner(needle, 1);
            for (rel, name) in paths {
                let path = if rel.is_empty() { name.to_string() } else { format!("{rel}/{name}") };
                assert_eq!(scan.matches(rel, name), path.to_ascii_lowercase().contains(needle));
            }
        }
    }
}
