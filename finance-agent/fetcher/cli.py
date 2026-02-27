"""
CLI entry point for the Nifty 50 transcript fetcher.

Usage:
    python -m fetcher.cli --ticker BHARTI
    python -m fetcher.cli --ticker RELIANCE --lookback 365
    python -m fetcher.cli --all
    python -m fetcher.cli --all --dry-run
    python -m fetcher.cli --list
    python -m fetcher.cli --all --verbose
"""
import argparse
import logging
import sys
from pathlib import Path

from .nifty50 import NIFTY50
from .transcript_fetcher import DEFAULT_OUTPUT_DIR, fetch_all, fetch_ticker


def _setup_logging(verbose: bool) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(message)s",
    )
    # Suppress noisy third-party loggers unless verbose
    if not verbose:
        for lib in ("httpx", "httpcore", "pdfminer"):
            logging.getLogger(lib).setLevel(logging.WARNING)


def _print_list() -> None:
    header = f"{'Ticker':<12} {'BSE':>7}  {'NSE':<18}  Name"
    print(header)
    print("-" * len(header))
    for ticker, info in NIFTY50.items():
        print(f"{ticker:<12} {info['bse']:>7}  {info['nse']:<18}  {info['name']}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m fetcher.cli",
        description="Fetch Nifty 50 earnings call transcripts from BSE India.",
    )

    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--ticker",
        metavar="TICKER",
        help="Fetch transcripts for a single ticker (e.g. BHARTI)",
    )
    group.add_argument(
        "--all",
        action="store_true",
        help="Fetch transcripts for all 50 Nifty companies",
    )
    group.add_argument(
        "--list",
        action="store_true",
        help="Print the full 50-company registry and exit",
    )

    parser.add_argument(
        "--lookback",
        type=int,
        default=548,
        metavar="DAYS",
        help="How many days back to search (default: 548 ≈ 18 months)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Discover transcripts but do not write any files",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        metavar="DIR",
        help=f"Output directory (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable DEBUG logging",
    )

    args = parser.parse_args(argv)
    _setup_logging(args.verbose)

    if args.list:
        _print_list()
        return 0

    if args.ticker:
        try:
            new_files = fetch_ticker(
                args.ticker,
                output_dir=args.output_dir,
                lookback_days=args.lookback,
                dry_run=args.dry_run,
            )
        except ValueError as exc:
            print(f"Error: {exc}", file=sys.stderr)
            return 1
        except Exception as exc:
            print(f"Error fetching {args.ticker}: {exc}", file=sys.stderr)
            return 1

        if args.dry_run:
            return 0
        print(f"\n{len(new_files)} new file(s) saved.")
        return 0

    # --all
    results = fetch_all(
        output_dir=args.output_dir,
        lookback_days=args.lookback,
        dry_run=args.dry_run,
    )

    failed = [t for t, paths in results.items() if paths == [] and not args.dry_run]
    total_new = sum(len(p) for p in results.values())

    print(f"\n{'DRY RUN — ' if args.dry_run else ''}Done. {total_new} new file(s) across {len(NIFTY50)} tickers.")
    if failed:
        print(f"Failed tickers ({len(failed)}): {', '.join(failed)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
