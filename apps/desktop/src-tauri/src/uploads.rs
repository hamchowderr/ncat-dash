//! Big uploads straight from disk. In the app, the dashboard's Upload button opens the
//! computer's own file picker; the app then reads each part from the file and sends it to
//! the link the dashboard signed, so the window never holds the file. A file sent in parts
//! is written down with the parts already sent, so an upload that stopped (the network
//! dropped, the app was quit, the computer slept) carries on from there, even after a
//! restart.
//!
//! Security: the app only reads files the person chose in its picker (this session) or
//! that an upload they chose is still sending. Nothing else on disk can be read.

use std::collections::HashSet;
use std::fs;
use std::io::SeekFrom;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use url::Url;

/// A file chosen in the picker, as the dashboard needs it to start an upload.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Chosen {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub content_type: String,
}

/// How a file is split into parts (the dashboard's PartsPlan).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub part_size: u64,
    pub part_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SentPart {
    pub part_number: u32,
    pub etag: String,
}

/// An upload going up in parts, written down so it can carry on after it stopped.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pending {
    pub upload_id: String,
    /// The dashboard that started it; only that dashboard sees it.
    pub dashboard: String,
    pub path: String,
    pub name: String,
    pub size: u64,
    pub content_type: String,
    pub plan: Plan,
    pub parts: Vec<SentPart>,
}

/// The type a browser would give the file, from its extension.
pub fn content_type(name: &str) -> &'static str {
    let extension = Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    match extension.as_str() {
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "avi" => "video/x-msvideo",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "ogg" | "oga" => "audio/ogg",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "srt" => "application/x-subrip",
        "vtt" => "text/vtt",
        "txt" => "text/plain",
        "pdf" => "application/pdf",
        "json" => "application/json",
        _ => "application/octet-stream",
    }
}

/// What the dashboard needs to know about a chosen file.
pub fn describe(path: &Path) -> Option<Chosen> {
    let meta = fs::metadata(path).ok()?;
    if !meta.is_file() {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().to_string();
    Some(Chosen {
        path: path.display().to_string(),
        content_type: content_type(&name).to_string(),
        name,
        size: meta.len(),
    })
}

/// Where each part's bytes start and stop (not included), as the dashboard counts them.
pub fn part_range(plan: Plan, size: u64, part_number: u32) -> Option<(u64, u64)> {
    if part_number == 0 || part_number > plan.part_count {
        return None;
    }
    let start = (part_number as u64 - 1) * plan.part_size;
    Some((start, size.min(start + plan.part_size)))
}

/// The files the app may read: chosen in the picker this session, or still being sent.
#[derive(Default)]
pub struct Allowed(Mutex<HashSet<PathBuf>>);

impl Allowed {
    pub fn allow(&self, path: &Path) {
        self.0.lock().unwrap().insert(path.to_path_buf());
    }
    pub fn contains(&self, path: &Path) -> bool {
        self.0.lock().unwrap().contains(path)
    }
}

/// The uploads still going up, in uploads.json in the app's settings folder.
pub struct Store {
    path: PathBuf,
    lock: Mutex<()>,
}

impl Store {
    pub fn new(folder: &Path) -> Self {
        Self {
            path: folder.join("uploads.json"),
            lock: Mutex::new(()),
        }
    }

    /// A missing or damaged file reads as empty, so it never stops the app.
    pub fn list(&self) -> Vec<Pending> {
        let _held = self.lock.lock().unwrap();
        self.read()
    }

    fn read(&self) -> Vec<Pending> {
        fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn write(&self, pending: &[Pending]) -> Result<(), String> {
        if let Some(folder) = self.path.parent() {
            fs::create_dir_all(folder).map_err(|error| error.to_string())?;
        }
        let bytes = serde_json::to_vec_pretty(pending).map_err(|error| error.to_string())?;
        // Written whole, then moved in place, so a crash never leaves half a file.
        let part = self.path.with_extension("json.part");
        fs::write(&part, bytes).map_err(|error| error.to_string())?;
        fs::rename(&part, &self.path).map_err(|error| error.to_string())
    }

    fn change(&self, edit: impl FnOnce(&mut Vec<Pending>)) -> Result<(), String> {
        let _held = self.lock.lock().unwrap();
        let mut pending = self.read();
        edit(&mut pending);
        self.write(&pending)
    }

    /// Writes down an upload starting, or keeps the one already there (a resume).
    pub fn begin(&self, upload: Pending) -> Result<(), String> {
        self.change(|pending| {
            if !pending
                .iter()
                .any(|each| each.upload_id == upload.upload_id)
            {
                pending.push(upload);
            }
        })
    }

    pub fn get(&self, upload_id: &str) -> Option<Pending> {
        self.list()
            .into_iter()
            .find(|each| each.upload_id == upload_id)
    }

    /// Writes down a part the bucket took.
    pub fn sent(&self, upload_id: &str, part: SentPart) -> Result<(), String> {
        self.change(|pending| {
            if let Some(upload) = pending.iter_mut().find(|each| each.upload_id == upload_id) {
                upload
                    .parts
                    .retain(|each| each.part_number != part.part_number);
                upload.parts.push(part);
                upload.parts.sort_by_key(|each| each.part_number);
            }
        })
    }

    pub fn forget(&self, upload_id: &str) -> Result<(), String> {
        self.change(|pending| pending.retain(|each| each.upload_id != upload_id))
    }

    /// The stopped uploads of one dashboard whose file is still there to send from.
    pub fn stopped(&self, dashboard: &str) -> Vec<Pending> {
        self.list()
            .into_iter()
            .filter(|each| each.dashboard == dashboard)
            .filter(|each| {
                fs::metadata(&each.path)
                    .map(|meta| meta.len() == each.size)
                    .unwrap_or(false)
            })
            .collect()
    }
}

/// Only web addresses are sent to, never files or other schemes.
fn web_address(url: &str) -> Result<Url, String> {
    let url = Url::parse(url).map_err(|_| "Not a web address.".to_string())?;
    if matches!(url.scheme(), "http" | "https") {
        Ok(url)
    } else {
        Err("Not a web address.".into())
    }
}

pub fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())
}

/// Sends bytes `start..end` of `path` to `url` in one PUT, read from disk as they go, and
/// returns the bucket's ETag (None when it gives none).
pub async fn put_range(
    client: &reqwest::Client,
    path: &Path,
    start: u64,
    end: u64,
    url: &str,
    content_type: Option<&str>,
) -> Result<Option<String>, String> {
    let url = web_address(url)?;
    if end < start {
        return Err("That part is outside the file.".into());
    }
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|error| format!("Could not read {}: {error}", path.display()))?;
    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|error| error.to_string())?;
    let body = reqwest::Body::wrap_stream(tokio_util::io::ReaderStream::with_capacity(
        file.take(end - start),
        1024 * 1024,
    ));
    let mut request = client
        .put(url)
        // Buckets refuse a PUT without its length, so the stream is sent with it.
        .header(reqwest::header::CONTENT_LENGTH, end - start)
        .body(body);
    if let Some(content_type) = content_type {
        request = request.header(reqwest::header::CONTENT_TYPE, content_type);
    }
    let response = request.send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("The bucket answered {}.", response.status()));
    }
    Ok(response
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|etag| etag.to_str().ok())
        .map(str::to_string))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;

    #[test]
    fn types_follow_the_extension() {
        assert_eq!(content_type("Talk.MP4"), "video/mp4");
        assert_eq!(content_type("clip.mov"), "video/quicktime");
        assert_eq!(content_type("notes"), "application/octet-stream");
    }

    #[test]
    fn parts_cover_the_file_as_the_dashboard_counts_them() {
        let plan = Plan {
            part_size: 10,
            part_count: 3,
        };
        assert_eq!(part_range(plan, 25, 1), Some((0, 10)));
        assert_eq!(part_range(plan, 25, 3), Some((20, 25)));
        assert_eq!(part_range(plan, 25, 0), None);
        assert_eq!(part_range(plan, 25, 4), None);
    }

    fn pending(upload_id: &str, path: &Path, size: u64) -> Pending {
        Pending {
            upload_id: upload_id.into(),
            dashboard: "https://app.example/".into(),
            path: path.display().to_string(),
            name: "talk.mp4".into(),
            size,
            content_type: "video/mp4".into(),
            plan: Plan {
                part_size: 4,
                part_count: 3,
            },
            parts: vec![],
        }
    }

    #[test]
    fn remembers_sent_parts_until_the_upload_is_done() {
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("talk.mp4");
        fs::write(&file, b"0123456789").unwrap();
        let store = Store::new(&folder.path().join("settings"));
        store.begin(pending("u1", &file, 10)).unwrap();
        let part = |n: u32| SentPart {
            part_number: n,
            etag: format!("\"e{n}\""),
        };
        store.sent("u1", part(2)).unwrap();
        store.sent("u1", part(1)).unwrap();
        store.sent("u1", part(2)).unwrap();
        // Beginning again (a resume) keeps what was sent.
        store.begin(pending("u1", &file, 10)).unwrap();

        // Read back as the app would after a restart.
        let again = Store::new(&folder.path().join("settings"));
        let upload = again.get("u1").unwrap();
        assert_eq!(upload.parts, vec![part(1), part(2)]);
        assert_eq!(again.stopped("https://app.example/").len(), 1);
        assert!(again.stopped("https://elsewhere.example/").is_empty());

        // A file that changed or went away can't be carried on from.
        fs::write(&file, b"shorter").unwrap();
        assert!(again.stopped("https://app.example/").is_empty());

        again.forget("u1").unwrap();
        assert!(again.list().is_empty());
    }

    #[test]
    fn a_damaged_list_reads_as_empty() {
        let folder = tempfile::tempdir().unwrap();
        fs::write(folder.path().join("uploads.json"), b"{not json").unwrap();
        assert!(Store::new(folder.path()).list().is_empty());
    }

    /// A bucket stand-in: keeps each PUT's body and headers, answers with an ETag.
    async fn bucket() -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let keep = seen.clone();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let keep = keep.clone();
                tokio::spawn(async move {
                    let mut request = Vec::new();
                    let mut buffer = [0u8; 4096];
                    loop {
                        let read = socket.read(&mut buffer).await.unwrap_or(0);
                        if read == 0 {
                            break;
                        }
                        request.extend_from_slice(&buffer[..read]);
                        let text = String::from_utf8_lossy(&request).to_string();
                        if let Some(split) = text.find("\r\n\r\n") {
                            let length = text
                                .lines()
                                .find_map(|line| {
                                    line.to_ascii_lowercase()
                                        .strip_prefix("content-length: ")
                                        .map(|value| value.trim().parse::<usize>().unwrap())
                                })
                                .unwrap_or(0);
                            if request.len() >= split + 4 + length {
                                break;
                            }
                        }
                    }
                    keep.lock()
                        .unwrap()
                        .push(String::from_utf8_lossy(&request).to_string());
                    let _ = socket
                        .write_all(
                            b"HTTP/1.1 200 OK\r\netag: \"abc\"\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                        )
                        .await;
                });
            }
        });
        (format!("http://{address}/part"), seen)
    }

    #[tokio::test]
    async fn sends_one_part_of_the_file_with_its_length() {
        let (url, seen) = bucket().await;
        let folder = tempfile::tempdir().unwrap();
        let file = folder.path().join("talk.mp4");
        fs::write(&file, b"0123456789").unwrap();
        let client = client().unwrap();

        let etag = put_range(&client, &file, 4, 8, &url, None).await.unwrap();
        assert_eq!(etag.as_deref(), Some("\"abc\""));
        let request = seen.lock().unwrap()[0].clone();
        assert!(request.starts_with("PUT /part"));
        assert!(request.to_ascii_lowercase().contains("content-length: 4"));
        assert!(request.ends_with("\r\n\r\n4567"));

        put_range(&client, &file, 0, 10, &url, Some("video/mp4"))
            .await
            .unwrap();
        let request = seen.lock().unwrap()[1].clone();
        assert!(request
            .to_ascii_lowercase()
            .contains("content-type: video/mp4"));
        assert!(request.ends_with("0123456789"));

        assert!(put_range(&client, &file, 0, 4, "file:///etc/hosts", None)
            .await
            .is_err());
    }
}
