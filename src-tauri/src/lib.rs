// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::fs::File;
use std::hash::Hasher;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
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
        id INTEGER NOT NULL UNIQUE,
        pathname TEXT NOT NULL UNIQUE,
        audio_hash TEXT,
        rating INTEGER,
        rated_timestamp INTEGER NOT NULL,
        PRIMARY KEY(id AUTOINCREMENT)
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

//=============================================================================
// Populate a rating row's audio hash in the background
//=============================================================================
fn populate_audio_hash_in_background(app: tauri::AppHandle, pathname: String) {
    std::thread::spawn(move || {
        let audio_hash = match decoded_audio_hash(pathname.clone()) {
            Ok(audio_hash) => audio_hash,
            Err(e) => {
                eprintln!("Failed to generate audio hash for {}: {}", pathname, e);
                return;
            }
        };

        let connection = match open_ratings_database(&app) {
            Ok(connection) => connection,
            Err(e) => {
                eprintln!("Failed to open ratings database: {}", e);
                return;
            }
        };

        if let Err(e) = connection.execute(
            "UPDATE ratings
             SET audio_hash = ?1
             WHERE pathname = ?2",
            params![audio_hash, pathname],
        ) {
            eprintln!("Failed to update audio hash: {}", e);
        }
    });
}

#[tauri::command(rename_all = "camelCase")]
//=============================================================================
// Insert or update a file rating and return the database id
//=============================================================================
fn rate_music_file(pathname: String, rating: i64, app: tauri::AppHandle) -> Result<i64, String> {
    let connection = open_ratings_database(&app)?;
    let rated_timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;

    connection
        .execute(
            "INSERT INTO ratings (pathname, rating, rated_timestamp)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(pathname) DO UPDATE SET
                 rating = excluded.rating,
                 rated_timestamp = excluded.rated_timestamp",
            params![&pathname, rating, rated_timestamp],
        )
        .map_err(|e| e.to_string())?;

    let id = connection
        .query_row(
            "SELECT id FROM ratings WHERE pathname = ?1",
            params![&pathname],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    populate_audio_hash_in_background(app, pathname);

    Ok(id)
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
// Generate a unique hash for a music file based on its decoded audio data.
//=============================================================================
#[tauri::command]
fn decoded_audio_hash(pathname: String) -> Result<String, String> {
    let path = Path::new(&pathname);

    let file = File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();

    if let Some(extension) = path.extension().and_then(|s| s.to_str()) {
        hint.with_extension(extension);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| e.to_string())?;

    let mut format = probed.format;

    let track = format
        .default_track()
        .ok_or_else(|| "no default audio track found".to_string())?;

    let codec_params = &track.codec_params;

    let mut decoder = symphonia::default::get_codecs()
        .make(codec_params, &DecoderOptions::default())
        .map_err(|e| e.to_string())?;

    let track_id = track.id;

    let mut hasher = DefaultHasher::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(_)) => break,
            Err(SymphoniaError::ResetRequired) => {
                return Err("decoder reset required".to_string());
            }
            Err(err) => return Err(err.to_string()),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(SymphoniaError::DecodeError(_)) => {
                continue;
            }
            Err(err) => return Err(err.to_string()),
        };

        let spec = *decoded.spec();
        let duration = decoded.capacity() as u64;

        let mut sample_buffer = SampleBuffer::<i16>::new(duration, spec);
        sample_buffer.copy_interleaved_ref(decoded);

        for sample in sample_buffer.samples() {
            hasher.write(&sample.to_le_bytes());
        }
    }

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
            rate_music_file,
            clear_rating,
            create_database,
            get_database_path,
            get_music_files,
            get_path_separator,
            play_music_file,
            stop_music_file,
            decoded_audio_hash
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