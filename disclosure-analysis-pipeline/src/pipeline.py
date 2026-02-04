"""
Main orchestration pipeline for disclosure change analysis.
"""
import argparse
import json
import logging
from pathlib import Path
import pandas as pd
from tqdm import tqdm

from .parser import parse_all_pdfs, save_parsed_data
from .analyzer import analyze_all_companies

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def run_pipeline(
    data_dir: str = "data",
    output_dir: str = "output",
    dry_run: bool = False,
    skip_parsing: bool = False,
    use_semantic: bool = True
):
    """
    Run the complete disclosure analysis pipeline.
    
    Args:
        data_dir: Directory containing PDF files
        output_dir: Directory for output files
        dry_run: If True, skip LLM API calls (for testing)
        skip_parsing: If True, use existing parsed_data.json
        use_semantic: If True, use AI-based semantic extraction (for earnings transcripts).
                     If False, use regex-based extraction (for structured SEC filings).
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    parsed_data_path = output_path / "parsed_data.json"
    
    # Step 1: Parse PDFs
    if skip_parsing and parsed_data_path.exists():
        logger.info("Loading existing parsed data...")
        with open(parsed_data_path, 'r') as f:
            parsed_data = json.load(f)
        logger.info(f"Loaded data for {len(parsed_data)} companies")
    else:
        logger.info(f"\n{'='*60}")
        logger.info("STEP 1: Parsing PDF Documents")
        logger.info(f"{'='*60}\n")
        
        parsed_data = parse_all_pdfs(data_dir, use_semantic_extraction=use_semantic)
        
        if not parsed_data:
            logger.error("No data parsed. Check your PDF files and try again.")
            return
        
        save_parsed_data(parsed_data, str(parsed_data_path))
        
        # Print summary
        total_quarters = sum(len(quarters) for quarters in parsed_data.values())
        logger.info(f"\nParsing Summary:")
        logger.info(f"  Extraction mode: {'Semantic (AI)' if use_semantic else 'Regex (SEC filings)'}")
        logger.info(f"  Companies: {len(parsed_data)}")
        logger.info(f"  Total quarters: {total_quarters}")
        for company, quarters in parsed_data.items():
            logger.info(f"  {company}: {sorted(quarters.keys())}")
    
    # Step 2: Analyze with LLM
    logger.info(f"\n{'='*60}")
    logger.info("STEP 2: LLM-based Disclosure Analysis")
    logger.info(f"{'='*60}\n")
    
    if dry_run:
        logger.warning("DRY RUN MODE: Will not make actual LLM API calls")
    
    changes = analyze_all_companies(parsed_data, dry_run=dry_run)
    
    if not changes and not dry_run:
        logger.warning("No changes detected across all companies")
        return
    
    # Step 3: Generate output
    logger.info(f"\n{'='*60}")
    logger.info("STEP 3: Generating Output")
    logger.info(f"{'='*60}\n")
    
    if not dry_run:
        # Save to CSV
        df = pd.DataFrame(changes)
        csv_path = output_path / "disclosure_changes.csv"
        df.to_csv(csv_path, index=False)
        logger.info(f"Saved {len(df)} changes to {csv_path}")
        
        # Generate summary statistics
        logger.info("\n" + "="*60)
        logger.info("SUMMARY STATISTICS")
        logger.info("="*60)
        logger.info(f"Total changes detected: {len(df)}")
        logger.info(f"\nBy signal classification:")
        for signal, count in df['Signal'].value_counts().items():
            logger.info(f"  {signal}: {count}")
        logger.info(f"\nBy section:")
        for section, count in df['Section'].value_counts().items():
            logger.info(f"  {section}: {count}")
        logger.info(f"\nBy company:")
        for company, count in df['Company'].value_counts().items():
            logger.info(f"  {company}: {count}")
        
        # Save summary
        summary = {
            "total_changes": len(df),
            "by_signal": df['Signal'].value_counts().to_dict(),
            "by_section": df['Section'].value_counts().to_dict(),
            "by_company": df['Company'].value_counts().to_dict()
        }
        summary_path = output_path / "summary.json"
        with open(summary_path, 'w') as f:
            json.dump(summary, f, indent=2)
        logger.info(f"\nSaved summary to {summary_path}")
    
    logger.info("\n" + "="*60)
    logger.info("PIPELINE COMPLETE!")
    logger.info("="*60 + "\n")


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(
        description="Financial Disclosure Change Analysis Pipeline"
    )
    parser.add_argument(
        "--data-dir",
        default="data",
        help="Directory containing PDF files (default: data)"
    )
    parser.add_argument(
        "--output-dir",
        default="output",
        help="Directory for output files (default: output)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Skip LLM API calls (for testing)"
    )
    parser.add_argument(
        "--skip-parsing",
        action="store_true",
        help="Use existing parsed_data.json if available"
    )
    parser.add_argument(
        "--use-regex",
        action="store_true",
        help="Use regex-based extraction (for structured SEC filings). Default is semantic extraction (for earnings transcripts)."
    )
    
    args = parser.parse_args()
    
    run_pipeline(
        data_dir=args.data_dir,
        output_dir=args.output_dir,
        dry_run=args.dry_run,
        skip_parsing=args.skip_parsing,
        use_semantic=not args.use_regex  # Default to semantic
    )


if __name__ == "__main__":
    main()
