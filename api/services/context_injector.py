from pathlib import Path
from api.services.file_storage import storage

FOLDER_STRATEGIES = {
    "styles": "context_block",
    "characters": "context_block",
    "chapters": "context_block",
}

def get_injection_strategy(filepath: str, settings: dict) -> str:
    parts = filepath.replace("\\", "/").split("/")
    if len(parts) < 2:
        return settings.get("default_folder_strategy", "context_block")
    
    folder = parts[0].lower()
    folder_strategies = settings.get("folder_strategies") or FOLDER_STRATEGIES
    return folder_strategies.get(folder, settings.get("default_folder_strategy", "context_block"))

def inject_as_context_block(filepath: str, actual_path: str, system_parts: list) -> None:
    try:
        file_content = storage.read_input_file(actual_path)
        parts = actual_path.replace("\\", "/").split("/")
        folder_name = parts[0] if len(parts) > 1 else ""
        file_name = parts[-1]
        
        if folder_name.lower().endswith("s"):
            folder_str = folder_name[:-1].upper()
        else:
            folder_str = folder_name.upper()
            
        label = file_name.replace("_", " ").replace(".md", "").upper()
        
        if folder_str:
            header = f"--- {folder_str} CONTEXT: {label} ---"
        else:
            header = f"--- CONTEXT: {label} ---"
            
        system_parts.append(f"{header}\n{file_content}")
    except Exception as e:
        print(f"Error loading context block for {actual_path}: {e}")

def inject(filepath: str, actual_path: str, system_parts: list, available_paths: list, settings: dict) -> None:
    inject_as_context_block(filepath, actual_path, system_parts)
