import sys
import os
import json

# Add project root to path
sys.path.append(os.getcwd())

from control.control_plane import run_research_task

def main():
    query = "Analyze Apple's revenue and services growth trends in 2025 vs 2024"
    print(f"Running Controlled Task for: {query}\n" + "="*60)
    
    # Run the task (returns JSON string)
    json_output = run_research_task(query)
    
    # Parse back to dict for pretty printing
    data = json.loads(json_output)
    
    print("\n--- FINAL RESULT ---")
    print(data.get("final_result"))
    
    print("\n--- VERIFICATION REPORT ---")
    report = data.get("verification_report")
    if report:
        print(f"Summary Score: {report.get('summary_score')}")
        print("Items:")
        for item in report.get("items", []):
            print(f"[{item['status']}] {item['claim']}")
            if item.get("evidence"):
                print(f"    Evidence: {item['evidence']}")
    else:
        print("No verification report found.")
        
    print("\n--- EXECUTION TRACE ---")
    for step in data.get("trace", []):
        print(f"[{step['timestamp']}] {step['action']}")

if __name__ == "__main__":
    main()
