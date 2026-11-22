//! "Open in your editor" in the app: a run's timelines, captions, finished clips and the
//! original recording are saved into one folder, so the editor finds the media next to the
//! timeline. The dashboard says what to save; the app decides where, and only ever writes,
//! opens or shows things inside its own exports folder.

use std::path::{Component, Path, PathBuf};
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;
use url::Url;

/// A file the dashboard made, such as a timeline or captions.
#[derive(Debug, Clone, Deserialize)]
pub struct TextFile {
    pub name: String,
    pub text: String,
}

/// A file to fetch, such as a finished clip or the original recording.
#[derive(Debug, Clone, Deserialize)]
pub struct Download {
    pub name: String,
    pub url: String,
}

/// What was saved, for the dashboard to show.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Saved {
    /// The folder everything went into.
    pub folder: String,
    /// Each file saved, by the name the dashboard gave it, with where it went.
    pub files: Vec<SavedFile>,
    /// Downloads that could not be fetched.
    pub failed: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SavedFile {
    pub name: String,
    pub path: String,
}

/// A name that is safe as one file or folder name on Mac, Windows and Linux: no folders,
/// no characters any of them refuse, no trailing dots or spaces, not empty.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            c => c,
        })
        .collect();
    let trimmed = cleaned
        .trim()
        .trim_end_matches(['.', ' '])
        .trim_start_matches('.');
    let short: String = trimmed.chars().take(120).collect();
    let short = short.trim_end_matches(['.', ' ']).to_string();
    if short.is_empty() {
        "Untitled".to_string()
    } else {
        short
    }
}

/// Whether `path` is inside `base` (after resolving `..` and links where the file exists).
pub fn is_inside(base: &Path, path: &Path) -> bool {
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return false;
    }
    let base = base.canonicalize().unwrap_or_else(|_| base.to_path_buf());
    let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    path.starts_with(&base) && path != base
}

/// Only web addresses are fetched, never files or other schemes.
fn web_address(url: &str) -> Option<Url> {
    let url = Url::parse(url).ok()?;
    matches!(url.scheme(), "http" | "https").then_some(url)
}

/// Saves everything into `base/<folder>`. Text files are always written fresh. A download
/// that is already there is kept (a recording can be big), and a download goes to a
/// `.part` file first, so a file that is there is always whole.
pub async fn save(
    base: &Path,
    folder: &str,
    files: &[TextFile],
    downloads: &[Download],
) -> Result<Saved, String> {
    let folder = base.join(safe_name(folder));
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(|error| format!("Could not make the folder {}: {error}", folder.display()))?;

    let mut saved = Vec::new();
    for file in files {
        let path = folder.join(safe_name(&file.name));
        tokio::fs::write(&path, &file.text)
            .await
            .map_err(|error| format!("Could not save {}: {error}", file.name))?;
        saved.push(SavedFile {
            name: file.name.clone(),
            path: path.display().to_string(),
        });
    }

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let mut failed = Vec::new();
    for download in downloads {
        let path = folder.join(safe_name(&download.name));
        if tokio::fs::try_exists(&path).await.unwrap_or(false) {
            saved.push(SavedFile {
                name: download.name.clone(),
                path: path.display().to_string(),
            });
            continue;
        }
        match fetch(&client, &download.url, &path).await {
            Ok(()) => saved.push(SavedFile {
                name: download.name.clone(),
                path: path.display().to_string(),
            }),
            Err(_) => failed.push(download.name.clone()),
        }
    }
    Ok(Saved {
        folder: folder.display().to_string(),
        files: saved,
        failed,
    })
}

async fn fetch(client: &reqwest::Client, url: &str, path: &Path) -> Result<(), String> {
    let url = web_address(url).ok_or("Not a web address.")?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("The server answered {}.", response.status()));
    }
    let part: PathBuf = {
        let mut name = path.as_os_str().to_owned();
        name.push(".part");
        name.into()
    };
    let mut out = tokio::fs::File::create(&part)
        .await
        .map_err(|error| error.to_string())?;
    let mut body = response.bytes_stream();
    while let Some(chunk) = body.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(error) => {
                drop(out);
                let _ = tokio::fs::remove_file(&part).await;
                return Err(error.to_string());
            }
        };
        out.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
    }
    out.flush().await.map_err(|error| error.to_string())?;
    drop(out);
    tokio::fs::rename(&part, path)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn names_are_one_safe_file_name() {
        assert_eq!(safe_name("Weekly clips / 21 Nov"), "Weekly clips _ 21 Nov");
        assert_eq!(safe_name("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_name("  ..  "), "Untitled");
        assert_eq!(safe_name("clip.mp4."), "clip.mp4");
        assert_eq!(safe_name("a:b*c?d\"e<f>g|h"), "a_b_c_d_e_f_g_h");
        assert_eq!(safe_name(&"x".repeat(300)).len(), 120);
    }

    #[test]
    fn only_paths_inside_the_exports_folder_count() {
        let base = tempfile::tempdir().unwrap();
        let inside = base.path().join("Run").join("cut.xml");
        std::fs::create_dir_all(inside.parent().unwrap()).unwrap();
        std::fs::write(&inside, "x").unwrap();
        assert!(is_inside(base.path(), &inside));
        assert!(!is_inside(base.path(), base.path()));
        assert!(!is_inside(
            base.path(),
            &base.path().join("Run/../../elsewhere")
        ));
        assert!(!is_inside(base.path(), Path::new("/etc/hosts")));
    }

    /// A tiny web server that answers every request with `body`, or 404 for /missing.
    async fn serve(body: &'static [u8]) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                tokio::spawn(async move {
                    let mut request = [0u8; 1024];
                    let read = socket.read(&mut request).await.unwrap_or(0);
                    let missing = String::from_utf8_lossy(&request[..read]).contains("/missing");
                    let reply = if missing {
                        b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n"
                            .to_vec()
                    } else {
                        let mut reply = format!(
                            "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                            body.len()
                        )
                        .into_bytes();
                        reply.extend_from_slice(body);
                        reply
                    };
                    let _ = socket.write_all(&reply).await;
                });
            }
        });
        format!("http://{address}")
    }

    #[tokio::test]
    async fn saves_timelines_and_media_side_by_side() {
        let server = serve(b"video bytes").await;
        let base = tempfile::tempdir().unwrap();
        let saved = save(
            base.path(),
            "Weekly clips: 21 Nov",
            &[TextFile {
                name: "Weekly clips.xml".into(),
                text: "<xmeml/>".into(),
            }],
            &[
                Download {
                    name: "talk.mp4".into(),
                    url: format!("{server}/talk.mp4"),
                },
                Download {
                    name: "01 clip.mp4".into(),
                    url: format!("{server}/missing"),
                },
                Download {
                    name: "evil.mp4".into(),
                    url: "file:///etc/hosts".into(),
                },
            ],
        )
        .await
        .unwrap();

        let folder = base.path().join("Weekly clips_ 21 Nov");
        assert_eq!(saved.folder, folder.display().to_string());
        assert_eq!(
            std::fs::read_to_string(folder.join("Weekly clips.xml")).unwrap(),
            "<xmeml/>"
        );
        assert_eq!(
            std::fs::read(folder.join("talk.mp4")).unwrap(),
            b"video bytes"
        );
        assert_eq!(
            saved.failed,
            vec!["01 clip.mp4".to_string(), "evil.mp4".to_string()]
        );
        assert!(!folder.join("01 clip.mp4").exists());
        assert!(!folder.join("01 clip.mp4.part").exists());
        assert_eq!(saved.files.len(), 2);
    }

    #[tokio::test]
    async fn keeps_a_recording_already_saved() {
        let server = serve(b"new").await;
        let base = tempfile::tempdir().unwrap();
        let folder = base.path().join("Run");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("talk.mp4"), b"old").unwrap();
        let saved = save(
            base.path(),
            "Run",
            &[],
            &[Download {
                name: "talk.mp4".into(),
                url: format!("{server}/talk.mp4"),
            }],
        )
        .await
        .unwrap();
        assert_eq!(std::fs::read(folder.join("talk.mp4")).unwrap(), b"old");
        assert!(saved.failed.is_empty());
    }
}
