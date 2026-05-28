// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::fs::File;
use std::hash::Hasher;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

struct AudioState {
    stream: Mutex<Option<OutputStream>>,
    sink: Mutex<Option<Sink>>,
}

// OutputStream on macOS (CoreAudio) contains a non-Send callback, but access
// is serialized by the Mutex and the stream lives on its own internal thread.
unsafe impl Send for AudioState {}
unsafe impl Sync for AudioState {}

// use tauri::{image::Image, tray::TrayIconBuilder, Manager};

const RATINGS_DATABASE_NAME: &str = "audiostar.sqlite3";
const RATINGS_SCHEMA: &str = r#"
    CREATE TABLE IF NOT EXISTS ratings (
        audio_hash TEXT NOT NULL PRIMARY KEY,
        pathname TEXT NOT NULL UNIQUE,
        rating INTEGER,
        rated_timestamp INTEGER NOT NULL
    )
"#;
const HASH_CACHE_SCHEMA: &str = r#"
    CREATE TABLE IF NOT EXISTS hash_cache (
        pathname TEXT NOT NULL PRIMARY KEY,
        file_size INTEGER NOT NULL,
        mtime_ms INTEGER NOT NULL,
        audio_hash TEXT NOT NULL
    )
"#;

//=============================================================================
// Get the app data path for the ratings database
//=============================================================================
fn ratings_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;

    fs::create_dir_all(&app_data_dir).map_err(|e| e.to_string())?;

    Ok(app_data_dir.join(RATINGS_DATABASE_NAME))
}

//=============================================================================
// Create the ratings database and schema if they do not already exist
//=============================================================================
fn ensure_ratings_database(app: &tauri::AppHandle) -> Result<(), String> {
    let database_path = ratings_database_path(app)?;
    let connection = Connection::open(database_path).map_err(|e| e.to_string())?;

    connection
        .execute(RATINGS_SCHEMA, [])
        .map_err(|e| e.to_string())?;
    connection
        .execute(HASH_CACHE_SCHEMA, [])
        .map_err(|e| e.to_string())?;

    Ok(())
}

//=============================================================================
// Open the ratings database from app data instead of the watched source tree
//=============================================================================
fn open_ratings_database(app: &tauri::AppHandle) -> Result<Connection, String> {
    let database_path = ratings_database_path(app)?;
    let source_database_path = Path::new(RATINGS_DATABASE_NAME);

    if !database_path.exists() && source_database_path.exists() {
        fs::copy(source_database_path, &database_path).map_err(|e| e.to_string())?;
    }

    let connection = Connection::open(database_path).map_err(|e| e.to_string())?;

    connection
        .execute(RATINGS_SCHEMA, [])
        .map_err(|e| e.to_string())?;
    connection
        .execute(HASH_CACHE_SCHEMA, [])
        .map_err(|e| e.to_string())?;

    Ok(connection)
}

#[tauri::command]
//=============================================================================
// Create the ratings database in the app data directory
//=============================================================================
fn create_database(app: tauri::AppHandle) -> Result<(), String> {
    ensure_ratings_database(&app)
}

#[tauri::command]
//=============================================================================
// Get the path to the ratings database
//=============================================================================
fn get_database_path(app: tauri::AppHandle) -> Result<String, String> {
    ratings_database_path(&app).map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
//=============================================================================
// Get the path separator for the current platform (e.g., '/' on Unix, '\' on Windows)
//=============================================================================
fn get_path_separator() -> String {
    std::path::MAIN_SEPARATOR.to_string()
}

#[tauri::command]
//=============================================================================
// Get the home directory for the current user
//=============================================================================
fn get_home_directory() -> Result<String, String> {
    dirs_next::home_dir()
        .map(|path| path.to_string_lossy().into_owned())
        .ok_or_else(|| "Failed to get home directory".to_string())
}

#[tauri::command]
//=============================================================================
// Get the size in bytes for the supplied file pathname
//=============================================================================
fn get_file_size(pathname: String) -> Result<u64, String> {
    let path = Path::new(&pathname);

    if !path.is_file() {
        return Err(format!("{} is not a valid file", path.display()));
    }

    fs::metadata(path)
        .map(|metadata| metadata.len())
        .map_err(|e| format!("Failed to read file metadata: {}", e))
}

#[tauri::command]
//=============================================================================
// Get the last modified time in milliseconds since the Unix epoch for the supplied pathname
//=============================================================================
fn get_modified_time(pathname: String) -> Result<u128, String> {
    let path = Path::new(&pathname);

    fs::metadata(path)
        .map_err(|e| format!("Failed to read file metadata: {}", e))?
        .modified()
        .map_err(|e| format!("Failed to read modified time: {}", e))?
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .map_err(|e| format!("Modified time is before the Unix epoch: {}", e))
}

#[tauri::command(rename_all = "snake_case")]
//=============================================================================
// Get the saved rating for a file, or false if no matching record exists
//=============================================================================
fn get_rating(pathname: String, app: tauri::AppHandle) -> Result<Value, String> {
    let connection = open_ratings_database(&app)?;

    let rating: Option<Option<i64>> = connection
        .query_row(
            "SELECT rating FROM ratings
             WHERE pathname = ?1
             LIMIT 1",
            params![pathname],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match rating {
        Some(value) => Ok(json!(value)),
        None => Ok(Value::Bool(false)),
    }
}

#[tauri::command(rename_all = "snake_case")]
//=============================================================================
// Batch version of get_rating: accepts a list of pathnames and returns a JSON
// object mapping each pathname to its rating (integer) or null (no record).
// Opens the database only once, avoiding the per-file IPC + connection cost.
//=============================================================================
fn get_ratings_batch(pathnames: Vec<String>, app: tauri::AppHandle) -> Result<Value, String> {
    let connection = open_ratings_database(&app)?;
    let mut map = Map::new();

    for pathname in &pathnames {
        let rating: Option<Option<i64>> = connection
            .query_row(
                "SELECT rating FROM ratings WHERE pathname = ?1 LIMIT 1",
                params![pathname],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        map.insert(pathname.clone(), json!(rating));
    }

    Ok(Value::Object(map))
}

//=============================================================================
// Return the audio hash for a file, using the hash_cache table to avoid
// recomputing when the file's size and modification time are unchanged.
//=============================================================================
fn get_cached_audio_hash(connection: &Connection, pathname: &str) -> Result<String, String> {
    let metadata = fs::metadata(pathname).map_err(|e| e.to_string())?;
    let file_size = metadata.len() as i64;
    let mtime_ms = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as i64;

    let cached: Option<String> = connection
        .query_row(
            "SELECT audio_hash FROM hash_cache
             WHERE pathname = ?1 AND file_size = ?2 AND mtime_ms = ?3",
            params![pathname, file_size, mtime_ms],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(hash) = cached {
        return Ok(hash);
    }

    let hash = audio_file_hash(pathname.to_string())?;

    connection
        .execute(
            "INSERT INTO hash_cache (pathname, file_size, mtime_ms, audio_hash)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(pathname) DO UPDATE SET
                 file_size = excluded.file_size,
                 mtime_ms  = excluded.mtime_ms,
                 audio_hash = excluded.audio_hash",
            params![pathname, file_size, mtime_ms, hash],
        )
        .map_err(|e| e.to_string())?;

    Ok(hash)
}

#[tauri::command(rename_all = "snake_case")]
//=============================================================================
// Look up a rating by audio hash. Only call this when get_rating returned
// false (no pathname match). Computes or retrieves a cached hash for the file,
// searches the ratings table by hash, and if the stored pathname differs from
// the current one the pathname is updated in the database.
// Returns the rating value, or false if no hash match is found.
//=============================================================================
fn get_rating_by_audio_hash(pathname: String, app: tauri::AppHandle) -> Result<Value, String> {
    let connection = open_ratings_database(&app)?;

    let hash = get_cached_audio_hash(&connection, &pathname)?;

    let result: Option<(Option<i64>, String)> = connection
        .query_row(
            "SELECT rating, pathname FROM ratings WHERE audio_hash = ?1 LIMIT 1",
            params![hash],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match result {
        Some((rating, db_pathname)) => {
            // Only update the pathname when the original file no longer exists —
            // that indicates a move. If the original still exists the file was
            // copied, so we leave the DB record pointing at the original.
            if db_pathname != pathname && !Path::new(&db_pathname).exists() {
                if let Err(e) = connection.execute(
                    "UPDATE ratings SET pathname = ?1 WHERE audio_hash = ?2",
                    params![pathname, hash],
                ) {
                    eprintln!("Failed to update stale pathname in ratings: {}", e);
                }
            }
            Ok(json!(rating))
        }
        None => Ok(Value::Bool(false)),
    }
}

#[tauri::command]
//=============================================================================
// Insert or update a file rating
//=============================================================================
fn rate_music_file(pathname: String, rating: i64, app: tauri::AppHandle) -> Result<(), String> {
    let connection = open_ratings_database(&app)?;
    let rated_timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;

    // Hash is fast now (raw byte window), so compute it synchronously.
    let audio_hash = get_cached_audio_hash(&connection, &pathname)?;

    connection
        .execute(
            "INSERT INTO ratings (audio_hash, pathname, rating, rated_timestamp)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(audio_hash) DO UPDATE SET
                 pathname        = excluded.pathname,
                 rating          = excluded.rating,
                 rated_timestamp = excluded.rated_timestamp",
            params![audio_hash, &pathname, rating, rated_timestamp],
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
//=============================================================================
// Clear the saved rating record for a pathname
//=============================================================================
fn clear_rating(pathname: String, app: tauri::AppHandle) -> Result<bool, String> {
    let connection = open_ratings_database(&app)?;

    connection
        .execute("DELETE FROM ratings WHERE pathname = ?1", params![pathname])
        .map(|_| true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
//=============================================================================
// List subdirectories in the given path, excluding hidden directories (those starting with '.')
//=============================================================================
fn list_directories(path: &str) -> Result<Vec<String>, String> {
    let path = Path::new(path);

    if !path.is_dir() {
        return Err(format!("{} is not a valid directory", path.display()));
    }

    match fs::read_dir(path) {
        Ok(entries) => {
            let mut directories: Vec<String> = entries
                .filter_map(|entry| {
                    entry.ok().and_then(|e| {
                        let path = e.path();

                        if path.is_dir() {
                            let name = path.file_name()?.to_string_lossy();

                            // Skip directories beginning with '.'
                            if name.starts_with('.') {
                                None
                            } else {
                                Some(name.into_owned())
                            }
                        } else {
                            None
                        }
                    })
                })
                .collect();
            directories.sort();
            Ok(directories)
        }

        Err(e) => Err(format!("Failed to read directory: {}", e)),
    }
}

#[tauri::command]
//=============================================================================
// Get a list of music files in the given directory, sorted alphabetically
//=============================================================================
fn get_music_files(path: &str) -> Result<Vec<PathBuf>, String> {
    // Supported music file extensions
    const MUSIC_EXTENSIONS: &[&str] = &[
        "aac", "ac3", "aif", "aiff", "amr", "caf", "flac", "m4a", "mp3", "ogg", "opus", "pcm",
        "wav", "wma",
    ];

    let mut music_files = Vec::new();

    for entry in fs::read_dir(path).map_err(|e| format!("Failed to read directory: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        // Only process regular files
        if path.is_file() {
            if let Some(extension) = path.extension().and_then(|e| e.to_str()) {
                let extension = extension.to_lowercase();

                if MUSIC_EXTENSIONS.contains(&extension.as_str()) {
                    music_files.push(path);
                }
            }
        }
    }

    // Sort alphabetically
    music_files.sort();

    Ok(music_files)
}

#[tauri::command]
//=============================================================================
// Play a music file using the default audio output device
//=============================================================================
fn play_music_file(pathname: String, state: tauri::State<AudioState>) -> Result<(), String> {
    // Stop anything already playing
    if let Some(old_sink) = state.sink.lock().unwrap().take() {
        old_sink.stop();
    }

    let stream = OutputStreamBuilder::open_default_stream().map_err(|e| e.to_string())?;
    let sink = Sink::connect_new(stream.mixer());
    let file = File::open(&pathname).map_err(|e| e.to_string())?;
    let source = Decoder::try_from(BufReader::new(file)).map_err(|e| e.to_string())?;
    sink.append(source);

    // Keep these alive after the command returns
    *state.stream.lock().unwrap() = Some(stream);
    *state.sink.lock().unwrap() = Some(sink);

    Ok(())
}

#[tauri::command]
//=============================================================================
// Stop any currently playing music
//=============================================================================
fn stop_music_file(state: tauri::State<AudioState>) -> Result<(), String> {
    if let Some(sink) = state.sink.lock().unwrap().take() {
        sink.stop();
    }
    *state.stream.lock().unwrap() = None;
    Ok(())
}

//=============================================================================
// Find the byte offset where audio data starts, skipping any leading metadata.
//
// ID3v2 (MP3): parses the 10-byte header to get the exact tag block size,
//   which includes album art, lyrics, and all other frames — even multi-MB art.
//
// FLAC: walks the chain of METADATA_BLOCK headers (4 bytes each: 1-bit
//   last-block flag + 7-bit type + 24-bit length) until the last one, then
//   skips past it to reach the first FRAME block.
//
// Everything else (OGG, M4A, WAV, …): skips 256 KB, which clears typical
//   metadata for these formats. Larger embedded art is unusual in OGG/M4A,
//   but if it is present the skip still has a good chance of landing in audio.
//=============================================================================
fn find_audio_start(file: &mut File, file_len: u64) -> u64 {
    let mut header = [0u8; 10];
    if file.read_exact(&mut header).is_err() {
        return 0;
    }
    let _ = file.seek(SeekFrom::Start(0));

    // --- ID3v2 ---
    if &header[0..3] == b"ID3" {
        // Bytes 6–9: syncsafe integer (7 usable bits per byte), excludes the
        // 10-byte header itself.
        let size = ((header[6] as u64) << 21)
            | ((header[7] as u64) << 14)
            | ((header[8] as u64) << 7)
            | (header[9] as u64);
        return (10 + size).min(file_len);
    }

    // --- FLAC ---
    if &header[0..4] == b"fLaC" {
        let mut pos: u64 = 4;
        loop {
            let mut block_header = [0u8; 4];
            if file.seek(SeekFrom::Start(pos)).is_err() { break; }
            if file.read_exact(&mut block_header).is_err() { break; }
            let last_block = (block_header[0] & 0x80) != 0;
            let block_len = ((block_header[1] as u64) << 16)
                | ((block_header[2] as u64) << 8)
                | (block_header[3] as u64);
            pos += 4 + block_len;
            if last_block { break; }
        }
        return pos.min(file_len);
    }

    // --- Everything else: skip 256 KB ---
    let _ = file.seek(SeekFrom::Start(0));
    (262144_u64).min(file_len)
}

//=============================================================================
// Generate a hash for a music file from a fixed window of raw bytes starting
// after all leading metadata (ID3v2 tags, album art, FLAC metadata blocks,
// etc.). Stable across moves, renames, and any metadata/art edits.
//=============================================================================
#[tauri::command]
fn audio_file_hash(pathname: String) -> Result<String, String> {
    const READ: usize = 65536;

    let mut file = File::open(&pathname).map_err(|e| e.to_string())?;
    let file_len = file.metadata().map_err(|e| e.to_string())?.len();

    let offset = find_audio_start(&mut file, file_len);
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| e.to_string())?;

    let mut buf = vec![0u8; READ];
    let n = file.read(&mut buf).map_err(|e| e.to_string())?;

    let mut hasher = DefaultHasher::new();
    hasher.write(&buf[..n]);
    // Do NOT mix in file_len: trailing metadata (ID3v1, APEv2) appended to
    // the end of the file changes the length without touching audio data.

    Ok(format!("{:016x}", hasher.finish()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
//=============================================================================
// Main entry point for the Tauri application
//=============================================================================
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AudioState {
            stream: Mutex::new(None),
            sink: Mutex::new(None),
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            list_directories,
            get_home_directory,
            get_file_size,
            get_modified_time,
            get_rating,
            get_ratings_batch,
            get_rating_by_audio_hash,
            rate_music_file,
            clear_rating,
            create_database,
            get_database_path,
            get_music_files,
            get_path_separator,
            play_music_file,
            stop_music_file,
            audio_file_hash
        ])
        .setup(|app| {
            ensure_ratings_database(app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            // let icon = Image::from_path("icons/tray.png")?;
            // TrayIconBuilder::new().icon(icon).build(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}