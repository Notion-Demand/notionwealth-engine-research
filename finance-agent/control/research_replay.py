import json
import os
import glob
from typing import List, Dict, Optional, Any
from pydantic import BaseModel
from datetime import datetime

# Define paths
SESSION_DIR = "data/sessions"

class ReplayResult(BaseModel):
    original_session_id: str
    new_session_id: str
    timestamp: str = datetime.now().isoformat()
    match_score: float # Placeholder for similarity score
    notes: List[str]

def ensure_session_dir():
    os.makedirs(SESSION_DIR, exist_ok=True)

def save_session(session_data: Dict[str, Any]):
    """Save a research session to disk."""
    ensure_session_dir()
    session_id = session_data.get("session_id")
    if not session_id:
        return
        
    path = os.path.join(SESSION_DIR, f"{session_id}.json")
    with open(path, "w") as f:
        json.dump(session_data, f, indent=2)

def load_session(session_id: str) -> Optional[Dict[str, Any]]:
    """Load a session by ID."""
    path = os.path.join(SESSION_DIR, f"{session_id}.json")
    if not os.path.exists(path):
        return None
    with open(path, "r") as f:
        return json.load(f)

def list_research_sessions() -> str:
    """List available research sessions."""
    ensure_session_dir()
    files = glob.glob(os.path.join(SESSION_DIR, "*.json"))
    sessions = []
    
    for f in files:
        try:
            with open(f, "r") as r:
                data = json.load(r)
                sessions.append({
                    "id": data.get("session_id"),
                    "query": data.get("query"),
                    "timestamp": data.get("trace", [{}])[0].get("timestamp", "Unknown")
                })
        except:
            continue
            
    return json.dumps(sessions, indent=2)

def replay_research(session_id: str) -> str:
    """
    Replay a past research session.
    """
    # Import here to avoid circular dependency
    from control.control_plane import run_research_task
    
    # 1. Load Original
    original = load_session(session_id)
    if not original:
        return json.dumps({"error": "Session not found"})
        
    query = original.get("query")
    print(f"Replaying Query: {query}")
    
    # 2. Run New
    # This calls the control plane which generates a NEW session ID and saves it
    new_json_str = run_research_task(query)
    new_session = json.loads(new_json_str)
    
    # 3. Compare (Basic Diff)
    original_trace = original.get("trace", [])
    new_trace = new_session.get("trace", [])
    
    original_verifier = original.get("verification_report", {})
    new_verifier = new_session.get("verification_report", {})
    
    notes = []
    
    # Trace Length
    if len(original_trace) != len(new_trace):
        notes.append(f"Trace length changed: {len(original_trace)} -> {len(new_trace)}")
    else:
        notes.append("Trace length match.")
        
    # Result Length
    res_len_diff = len(new_session.get("final_result", "")) - len(original.get("final_result", ""))
    notes.append(f"Final result character delta: {res_len_diff}")
    
    # Verification Score
    old_score = original_verifier.get("summary_score", 0) if original_verifier else 0
    new_score = new_verifier.get("summary_score", 0) if new_verifier else 0
    
    notes.append(f"Verification Score: {old_score:.2f} -> {new_score:.2f}")
    
    result = ReplayResult(
        original_session_id=session_id,
        new_session_id=new_session.get("session_id"),
        match_score=1.0 if abs(old_score - new_score) < 0.1 else 0.5, # Dummy heuristic
        notes=notes
    )
    
    return json.dumps({
        "replay_summary": result.model_dump(),
        "original_session": original,
        "new_session": new_session
    }, indent=2)
