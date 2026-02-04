#!/usr/bin/env python3
"""
Quick test script to verify the pipeline setup with earnings call transcript data.
Creates sample transcript data for testing semantic extraction.
"""
import json
from pathlib import Path

# Sample earnings call transcript data (dialogue format)
sample_data = {
    "AAPL": {
        "Q1_2024": {
            "MD&A": """
MANAGEMENT COMMENTARY ON Q1 2024 RESULTS:

CEO: We're pleased to report strong financial results for Q1. Revenue reached $100B, up 12% year-over-year, 
driven by robust iPhone demand across all geographic segments. We saw particularly strong performance in 
services, which grew 18%. Our gross margin remained healthy at 42%, reflecting favorable product mix.

CFO: Breaking down the numbers, iPhone revenue was $55B, Services $25B, and Other Products $20B. We're seeing 
continued momentum in our subscription services, now exceeding 900M paid subscriptions globally. Operating 
expenses were well-controlled at $12B.

CEO: Looking at regional performance, Americas grew 10%, Europe 11%, and Greater China showed resilience 
with 8% growth despite temporary macroeconomic headwinds. We're confident in our product roadmap and 
innovation pipeline heading into Q2.
            """,
            "Risk_Factors": """
ANALYST Q&A - RISKS AND CHALLENGES:

Analyst: Can you discuss supply chain risks going forward?

CFO: We're managing through some temporary component constraints, particularly in certain regions. The situation 
has improved from last quarter, but we're monitoring geopolitical tensions and their potential impact on our 
supply network. We have good visibility for Q2 but remain cautious about the broader macro environment.

Analyst: What about competitive pressures in China?

CEO: Competition in China remains intense. We're seeing local competitors gain market share in the premium 
segment, which is a shift from prior years. However, our brand loyalty remains strong and our ecosystem 
provides differentiation. We're realistic about the competitive landscape and focused on innovation.

Analyst: Any regulatory concerns?

General Counsel: We continue to monitor regulatory developments in multiple jurisdictions, particularly 
around app store policies and data privacy. We're engaged in constructive dialogues with regulators globally.
            """,
            "Accounting": """
ACCOUNTING POLICY DISCUSSION:

CFO: I want to highlight a few accounting items. We made no material changes to our revenue recognition policies 
this quarter. Depreciation continues on a straight-line basis over useful lives of 3-5 years for most equipment.

Analyst: Can you clarify the inventory valuation approach?

CFO: We continue to use weighted average cost for inventory valuation. No changes there. On the warranty reserve, 
we maintain our historical accrual rate of approximately 2% of hardware revenue, which has proven accurate over time.
            """
        },
        "Q2_2024": {
            "MD&A": """
MANAGEMENT COMMENTARY ON Q2 2024 RESULTS:

CEO: Q2 results reflect continued execution against our strategic priorities. Revenue reached $105B, up 10% year-over-year, 
though growth moderated compared to Q1. Services growth remained strong at 16%, while iPhone revenue grew 8%. 
Gross margin compressed to 40%, primarily due to product mix shifts and some one-time costs.

CFO: Total revenue breakdown: iPhone $57B, Services $27B, Other Products $21B. We're pleased with Services momentum, 
though we're seeing structural challenges in the iPhone business related to longer upgrade cycles. Operating 
expenses increased to $13.5B due to increased R&D investments in AI and AR capabilities.

CEO: Geographically, Americas grew 9%, Europe 8%, but Greater China declined 2% - a shift from the growth we saw 
in Q1. The China market is proving more challenging than anticipated, with both macro pressures and intensifying competition.
            """,
            "Risk_Factors": """
ANALYST Q&A - RISKS AND CHALLENGES:

Analyst: The China decline is concerning. Can you elaborate?

CEO: China presents multiple challenges. We're seeing structural changes in consumer behavior, not just cyclical weakness. 
Local competition has intensified significantly, particularly from manufacturers offering AI-enabled features at competitive 
price points. Additionally, geopolitical tensions create uncertainty around supply chain and market access. We're taking 
this very seriously.

Analyst: What about supply chain - you mentioned one-time costs?

CFO: We experienced some operational disruptions in Southeast Asia that impacted production timelines and costs. Unlike 
Q1 where we characterized supply issues as temporary, we're now seeing more persistent challenges that require structural 
adjustments to our manufacturing footprint. This is an ongoing area of focus.

Analyst: Any new regulatory pressures?

General Counsel: We've received formal inquiries from EU regulators regarding app store practices. Additionally, 
data localization requirements in several countries are increasing our compliance costs and operational complexity.
            """,
            "Accounting": """
ACCOUNTING POLICY DISCUSSION:

CFO: I want to flag an important accounting change this quarter. We've revised our depreciation policy for data center 
equipment, extending useful lives from 4 to 5 years. This better reflects our actual experience with asset longevity. 
The change added approximately $200M to operating income this quarter.

Analyst: Any changes to warranty reserves?

CFO: Yes, we increased our warranty accrual rate from 2% to 2.5% of hardware revenue based on higher-than-expected 
claim rates for certain products launched last year. This is a permanent adjustment going forward.

Analyst: How about inventory?

CFO: Inventory valuation remains weighted average cost. However, we did take a $150M write-down on component inventory 
related to a discontinued product line. This was reflected in cost of goods sold.
            """
        }
    }
}

def main():
    print("Creating sample earnings call transcript data for testing...")
    
    output_dir = Path("output")
    output_dir.mkdir(exist_ok=True)
    
    output_file = output_dir / "parsed_data.json"
    with open(output_file, 'w') as f:
        json.dump(sample_data, f, indent=2)
    
    print(f"✅ Created {output_file}")
    print("\nSample data includes:")
    print("  - Company: AAPL")
    print("  - Format: Earnings call transcripts (dialogue)")
    print("  - Quarters: Q1_2024, Q2_2024")
    print("  - Sections: MD&A, Risk_Factors, Accounting (semantically extracted)")
    print("\nExpected changes to detect (Q1 → Q2):")
    print("  1. 'robust' → 'moderated' growth language (Negative)")
    print("  2. 'temporary' → 'structural' challenges (Negative)")
    print("  3. 'temporary' → 'persistent' supply chain issues (Negative)")
    print("  4. China 'growth 8%' → 'declined 2%' (Negative)")
    print("  5. 'intense competition' → 'significantly intensified' (More specific negative)")
    print("  6. Depreciation useful life change 4→5 years (Accounting change)")
    print("  7. Warranty accrual 2% → 2.5% (Accounting change)")
    print("  8. New inventory write-down disclosure (New risk signal)")
    print("\nNow run: python -m src.pipeline --skip-parsing")
    print("\nNote: This bypasses PDF parsing since we're using pre-extracted transcript content.")

if __name__ == "__main__":
    main()
