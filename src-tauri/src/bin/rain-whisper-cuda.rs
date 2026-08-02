use rain_lib::whisper_backend::{
    classify_whisper_error, CudaDeviceCapability, WorkerErrorKind, WorkerRequest, WorkerResponse,
    WORKER_PROTOCOL_VERSION,
};
use std::ffi::{c_char, CStr};
use std::io::{Read, Write};

extern "C" {
    fn ggml_backend_cuda_get_device_count() -> i32;
    fn ggml_backend_cuda_get_device_description(
        device: i32,
        description: *mut c_char,
        description_size: usize,
    );
    fn ggml_backend_cuda_get_device_memory(device: i32, free: *mut usize, total: *mut usize);
}

fn main() {
    let response = run().unwrap_or_else(|message| WorkerResponse::Error {
        protocol_version: WORKER_PROTOCOL_VERSION,
        kind: WorkerErrorKind::Protocol,
        message,
    });
    let mut stdout = std::io::stdout().lock();
    match serde_json::to_writer(&mut stdout, &response) {
        Ok(()) => {
            let _ = stdout.flush();
        }
        Err(error) => {
            eprintln!("Cannot encode CUDA worker response: {error}");
            std::process::exit(2);
        }
    }
}

fn run() -> Result<WorkerResponse, String> {
    let mut input = Vec::new();
    std::io::stdin()
        .lock()
        .take(1024 * 1024)
        .read_to_end(&mut input)
        .map_err(|error| format!("Cannot read worker request: {error}"))?;
    let request: WorkerRequest = serde_json::from_slice(&input)
        .map_err(|error| format!("Invalid worker request JSON: {error}"))?;

    match request {
        WorkerRequest::Probe { protocol_version } => {
            check_protocol(protocol_version)?;
            Ok(WorkerResponse::Probe {
                protocol_version: WORKER_PROTOCOL_VERSION,
                device: probe_cuda_device(),
            })
        }
        WorkerRequest::Transcribe {
            protocol_version,
            model_path,
            wav_path,
            language,
        } => {
            check_protocol(protocol_version)?;
            match rain_lib::whisper::transcribe_wav_with_language(
                &model_path,
                &wav_path,
                language.as_deref(),
                None,
            ) {
                Ok(result) => Ok(WorkerResponse::Transcription {
                    protocol_version: WORKER_PROTOCOL_VERSION,
                    result,
                }),
                Err(error) => Ok(WorkerResponse::Error {
                    protocol_version: WORKER_PROTOCOL_VERSION,
                    kind: classify_whisper_error(&error),
                    message: error.to_string(),
                }),
            }
        }
    }
}

fn check_protocol(version: u32) -> Result<(), String> {
    if version == WORKER_PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(format!(
            "Protocol mismatch: worker supports {}, request used {version}",
            WORKER_PROTOCOL_VERSION
        ))
    }
}

fn probe_cuda_device() -> CudaDeviceCapability {
    let device_count = unsafe { ggml_backend_cuda_get_device_count() };
    if device_count <= 0 {
        return CudaDeviceCapability {
            available: false,
            device_name: None,
            free_memory_bytes: None,
            total_memory_bytes: None,
            error: Some("No compatible NVIDIA CUDA device was found".to_string()),
        };
    }

    let mut description = vec![0_i8; 256];
    let mut free = 0_usize;
    let mut total = 0_usize;
    unsafe {
        ggml_backend_cuda_get_device_description(0, description.as_mut_ptr(), description.len());
        ggml_backend_cuda_get_device_memory(0, &mut free, &mut total);
    }
    let device_name = unsafe { CStr::from_ptr(description.as_ptr()) }
        .to_string_lossy()
        .trim()
        .to_string();
    CudaDeviceCapability {
        available: true,
        device_name: (!device_name.is_empty()).then_some(device_name),
        free_memory_bytes: Some(free as u64),
        total_memory_bytes: Some(total as u64),
        error: None,
    }
}
