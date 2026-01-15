import sys
import os
import json
import time

# Add project root to path
sys.path.append(os.getcwd())

from control.control_plane import run_research_task
from control.research_replay import list_research_sessions, replay_research

def main():
    topic = "Microsoft cloud growth drivers"
    print(f"1. Running Initial Research: {topic}")
    initial_res = run_research_task(topic)
    initial_data = json.loads(initial_res)
    session_id = initial_data["session_id"]
    print(f"   -> Session ID: {session_id}")
    
    print("\n2. Listing Sessions")
    sessions = json.loads(list_research_sessions())
    print(f"   -> Found {len(sessions)} sessions.")
    
    print(f"\n3. Replaying Session {session_id}")
    replay_out = replay_research(session_id)
    replay_data = json.loads(replay_out)
    
    print("\n--- REPLAY SUMMARY ---")
    print(json.dumps(replay_data["replay_summary"], indent=2))
    
    if replay_data["replay_summary"]["match_score"] >= 0.9:
        print("\n[SUCCESS] Replay matches original session.")
    else:
        print("\n[WARNING] Replay detailed changed.")

if __name__ == "__main__":
    main()
