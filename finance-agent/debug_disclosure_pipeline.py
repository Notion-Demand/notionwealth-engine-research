import sys
import os
import traceback

# Add project root and pipeline path
sys.path.append(os.getcwd())
pipeline_path = os.path.join(os.getcwd(), "disclosure_pipeline")
if pipeline_path not in sys.path:
    sys.path.append(pipeline_path)

print(f"Debug: python path: {sys.path}")

try:
    import src.pipeline
    from src.pipeline import run_pipeline
    print("Successfully imported pipeline.")
except ImportError as e:
    print(f"ImportError: {e}")
    # Try fallback
    fallback_path = os.path.join(os.getcwd(), "..", "disclosure-analysis-pipeline")
    print(f"Trying fallback path: {fallback_path}")
    sys.path.append(fallback_path)
    try:
        import src.pipeline
        from src.pipeline import run_pipeline
        print("Successfully imported pipeline from fallback.")
    except ImportError as e2:
        print(f"Fallback failed: {e2}")
        sys.exit(1)

print("\nRunning pipeline debug...")
try:
    summary = run_pipeline(
        data_dir="disclosure_pipeline/data",
        output_dir="disclosure_pipeline/output",
        skip_parsing=True
    )
    
    print("\nPipeline finished.")
    if summary is None:
        print("ERROR: Pipeline returned None")
    else:
        print("Success! Keys:", summary.keys())
        print("Verdict:", summary.get("verdict"))
        
except Exception as e:
    print("\nCRASH DETECTED!")
    traceback.print_exc()
