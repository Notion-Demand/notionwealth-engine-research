"""
Generate human-readable evaluation reports from judge LLM results.

Outputs:
- evaluation_report.json (structured data)
- evaluation_report.md (markdown format)
- Terminal summary
"""

import json
import logging
from pathlib import Path
from typing import Dict, List
from datetime import datetime

logger = logging.getLogger(__name__)


def generate_evaluation_report(
    evaluation_data: Dict,
    output_dir: str = "output"
) -> None:
    """
    Generate comprehensive evaluation reports in multiple formats.
    
    Args:
        evaluation_data: Output from judge_evaluator.run_full_evaluation()
        output_dir: Directory to save reports
    """
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Save JSON report
    json_path = output_path / "evaluation_report.json"
    with open(json_path, 'w') as f:
        json.dump(evaluation_data, f, indent=2)
    logger.info(f"Saved JSON evaluation report to {json_path}")
    
    # Generate Markdown report
    md_report = _generate_markdown_report(evaluation_data)
    md_path = output_path / "evaluation_report.md"
    with open(md_path, 'w') as f:
        f.write(md_report)
    logger.info(f"Saved Markdown evaluation report to {md_path}")
    
    # Print terminal summary
    _print_terminal_summary(evaluation_data)


def _generate_markdown_report(eval_data: Dict) -> str:
    """Generate detailed markdown evaluation report."""
    
    scores = eval_data.get("summary_scores", {})
    overall = scores.get("overall_accuracy", 0)
    
    # Determine overall status emoji
    if overall >= 85:
        status_emoji = "✅"
        status_text = "Excellent"
    elif overall >= 70:
        status_emoji = "✓"
        status_text = "Good"
    elif overall >= 50:
        status_emoji = "⚠️"
        status_text = "Needs Improvement"
    else:
        status_emoji = "❌"
        status_text = "Poor"
    
    md = f"""# Disclosure Pipeline Evaluation Report

**Generated**: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}

---

## {status_emoji} Overall Accuracy: {overall}% ({status_text})

"""
    
    # Stage 1: Semantic Extraction
    md += f"""### 📄 Stage 1: Semantic Extraction Quality

**Average Score**: {scores.get('extraction_avg', 0)}%

"""
    
    extraction_val = eval_data.get("extraction_validation", {})
    if extraction_val:
        md += "| Company | Quarter | Section | Score | Issues |\n"
        md += "|---------|---------|---------|-------|--------|\n"
        
        for key, val in list(extraction_val.items())[:10]:  # Show top 10
            parts = key.split("_")
            company = parts[0] if parts else "Unknown"
            quarter = parts[1] if len(parts) > 1 else "Unknown"
            section = parts[2] if len(parts) > 2 else "Unknown"
            score = val.get("quality_score", 0)
            issues = val.get("issues", [])
            issues_str = "; ".join(issues[:2]) if issues else "None"
            
            md += f"| {company} | {quarter} | {section} | {score}% | {issues_str} |\n"
        
        if len(extraction_val) > 10:
            md += f"\n*...and {len(extraction_val) - 10} more entries*\n"
    
    md += "\n---\n\n"
    
    # Stage 2: Change Detection
    md += f"""### 🔍 Stage 2: Change Detection Validity

**Average Score**: {scores.get('change_detection_avg', 0)}%

"""
    
    change_vals = eval_data.get("change_validations", [])
    if change_vals:
        # Show flagged issues
        flagged = [c for c in change_vals if c["validation"].get("overall_validity", 100) < 70]
        
        if flagged:
            md += "#### ⚠️ Flagged Changes (Score < 70%)\n\n"
            for i, item in enumerate(flagged[:5], 1):
                change = item["change"]
                val = item["validation"]
                md += f"""**Change #{i}**:
- **Section**: {change.get('Section')}
- **Description**: {change.get('Description')}
- **Quote Accuracy**: {val.get('quote_accuracy_score', 0)}%
- **Comparability**: {val.get('comparability_score', 0)}%
- **Issues**: {', '.join(val.get('issues', []))}
- **Reasoning**: {val.get('reasoning', 'N/A')}

"""
        else:
            md += "*No significant issues detected.* ✅\n\n"
        
        # Stats
        md += f"""**Statistics**:
- Total Changes Validated: {len(change_vals)}
- High Validity (>80%): {len([c for c in change_vals if c['validation'].get('overall_validity', 0) >= 80])}
- Medium Validity (50-80%): {len([c for c in change_vals if 50 <= c['validation'].get('overall_validity', 0) < 80])}
- Low Validity (<50%): {len([c for c in change_vals if c['validation'].get('overall_validity', 0) < 50])}

"""
    
    md += "---\n\n"
    
    # Stage 3: Signal Classification
    md += f"""### 🎯 Stage 3: Signal Classification Correctness

**Average Score**: {scores.get('signal_classification_avg', 0)}%

"""
    
    signal_vals = eval_data.get("signal_validations", [])
    if signal_vals:
        # Show incorrect signals
        incorrect = [s for s in signal_vals if not s["validation"].get("is_correct_signal", True)]
        
        if incorrect:
            md += "#### ⚠️ Potentially Incorrect Signals\n\n"
            for i, item in enumerate(incorrect[:5], 1):
                change = item["change"]
                val = item["validation"]
                md += f"""**Signal #{i}**:
- **Description**: {change.get('Description')}
- **Current Signal**: {change.get('Signal')}
- **Suggested Signal**: {val.get('suggested_signal')}
- **Reasoning**: {val.get('reasoning', 'N/A')}

"""
        else:
            md += "*All signals appear appropriate.* ✅\n\n"
        
        # Stats
        md += f"""**Statistics**:
- Total Signals Validated: {len(signal_vals)}
- Correct Signals: {len([s for s in signal_vals if s['validation'].get('is_correct_signal', True)])}
- Questionable Signals: {len(incorrect)}

"""
    
    md += "---\n\n"
    
    # Stage 4: Verdict Quality
    verdict_val = eval_data.get("verdict_validation", {})
    if verdict_val:
        verdict_score = scores.get("verdict_quality", 0)
        
        md += f"""### 📊 Stage 4: Final Verdict Quality

**Overall Verdict Score**: {verdict_score}%

**Component Scores**:
- **Coherence**: {verdict_val.get('coherence_score', 0)}%
- **Insight Quality**: {verdict_val.get('insight_quality_score', 0)}%
- **Signal Alignment**: {verdict_val.get('signal_alignment_score', 0)}%

**Issues**: {', '.join(verdict_val.get('issues', [])) if verdict_val.get('issues') else 'None'}

**Judge Reasoning**: {verdict_val.get('reasoning', 'N/A')}

"""
    
    md += "---\n\n"
    
    # Summary & Recommendations
    md += """## 💡 Summary & Recommendations

"""
    
    if overall >= 85:
        md += """The pipeline is performing **excellently** across all stages. Continue monitoring for edge cases.

"""
    elif overall >= 70:
        md += """The pipeline is performing **well** overall, with some areas for improvement:

"""
        if scores.get("extraction_avg", 100) < 80:
            md += "- Consider improving PDF parsing/extraction logic\n"
        if scores.get("change_detection_avg", 100) < 80:
            md += "- Review change detection prompts for better accuracy\n"
        if scores.get("signal_classification_avg", 100) < 80:
            md += "- Refine signal classification rules and regime detection\n"
        if verdict_val and verdict_val.get("overall_verdict_quality", 100) < 80:
            md += "- Enhance verdict generation prompt for better synthesis\n"
    else:
        md += """The pipeline has **significant accuracy issues** that should be addressed:

"""
        md += "- Review flagged changes and incorrect signals above\n"
        md += "- Consider retuning prompts and validation logic\n"
        md += "- Manual review of outputs is recommended\n"
    
    return md


def _print_terminal_summary(eval_data: Dict) -> None:
    """Print color-coded summary to terminal."""
    
    scores = eval_data.get("summary_scores", {})
    
    # ANSI color codes
    GREEN = "\033[92m"
    YELLOW = "\033[93m"
    RED = "\033[91m"
    RESET = "\033[0m"
    BOLD = "\033[1m"
    
    def colorize_score(score):
        if score >= 80:
            return f"{GREEN}{score}%{RESET}"
        elif score >= 60:
            return f"{YELLOW}{score}%{RESET}"
        else:
            return f"{RED}{score}%{RESET}"
    
    print("\n" + "="*60)
    print(f"{BOLD}EVALUATION SUMMARY{RESET}")
    print("="*60)
    
    overall = scores.get("overall_accuracy", 0)
    print(f"\n{BOLD}Overall Accuracy:{RESET} {colorize_score(overall)}")
    
    print(f"\n{BOLD}Stage Breakdown:{RESET}")
    print(f"  1. Semantic Extraction:    {colorize_score(scores.get('extraction_avg', 0))}")
    print(f"  2. Change Detection:       {colorize_score(scores.get('change_detection_avg', 0))}")
    print(f"  3. Signal Classification:  {colorize_score(scores.get('signal_classification_avg', 0))}")
    
    if scores.get("verdict_quality") is not None:
        print(f"  4. Verdict Quality:        {colorize_score(scores.get('verdict_quality'))}")
    
    # Flags
    change_vals = eval_data.get("change_validations", [])
    signal_vals = eval_data.get("signal_validations", [])
    
    flagged_changes = len([c for c in change_vals if c["validation"].get("overall_validity", 100) < 70])
    incorrect_signals = len([s for s in signal_vals if not s["validation"].get("is_correct_signal", True)])
    
    print(f"\n{BOLD}Issues Detected:{RESET}")
    if flagged_changes > 0:
        print(f"  {YELLOW}⚠{RESET}  {flagged_changes} low-validity changes")
    if incorrect_signals > 0:
        print(f"  {YELLOW}⚠{RESET}  {incorrect_signals} questionable signals")
    
    if flagged_changes == 0 and incorrect_signals == 0:
        print(f"  {GREEN}✓{RESET}  No major issues detected")
    
    print("\n" + "="*60 + "\n")
