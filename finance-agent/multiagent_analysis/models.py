"""
Pydantic v2 data models for the Multi-Agent Earnings Analysis Framework.
All models are strictly typed to produce dashboard-ready JSON payloads.
"""
from pydantic import BaseModel, Field
from typing import List, Literal, Optional


class MetricDelta(BaseModel):
    """A single insight comparing Q_t-1 vs Q_t for a specific subtopic."""
    subtopic: str = Field(
        description="e.g., 'Free Cash Flow', 'Debt Covenants', 'Pricing Power'"
    )
    quote_old: str = Field(
        description="Exact verbatim quote from Q_t-1 transcript"
    )
    quote_new: str = Field(
        description="Exact verbatim quote from Q_t transcript"
    )
    language_shift: str = Field(
        description="Short description of how the narrative changed between quarters"
    )
    signal_classification: Literal["Positive", "Negative", "Noise"] = Field(
        description="Strict signal: Positive (improving), Negative (deteriorating), Noise (no material change)"
    )
    signal_score: float = Field(
        ge=-10, le=10,
        description="Numerical score: +1 to +10 for Positive (higher=stronger), -1 to -10 for Negative (lower=worse), -0.5 to +0.5 for Noise"
    )
    ui_component_type: Literal["metric_card", "status_warning", "quote_expander"] = Field(
        description="Maps to st.metric, st.warning/error, or st.expander in the UI"
    )
    validation_status: Literal["verified", "flagged", "removed"] = Field(
        default="verified",
        description="Post-validation status: verified (passed), flagged (has issues), removed (hallucinated)"
    )
    validation_note: str = Field(
        default="",
        description="Explanation of why the metric was flagged or removed"
    )
    market_validation: Literal["aligned", "divergent", "unclear"] = Field(
        default="unclear",
        description="Market validation: aligned (market agrees), divergent (market disagrees), unclear (insufficient data)"
    )
    market_note: str = Field(
        default="",
        description="Market evidence note, e.g. 'Stock rose 4.2% post-earnings, consistent with Positive signal'"
    )


class SectionalInsight(BaseModel):
    """Analysis output from a single thematic agent for one quarter."""
    section_name: str = Field(
        description="Agent domain: 'Capital & Liquidity', 'Revenue & Growth', etc."
    )
    key_takeaways: List[str] = Field(
        description="3-5 bullet-point takeaways from this section"
    )
    metrics: List[MetricDelta] = Field(
        default_factory=list,
        description="Detailed metric deltas with quotes and signals"
    )


class QuarterSnapshot(BaseModel):
    """Raw extraction from a single quarter (before temporal comparison)."""
    section_name: str
    key_takeaways: List[str]
    raw_quotes: List[str] = Field(
        default_factory=list,
        description="Key verbatim quotes extracted for this section"
    )


class DashboardPayload(BaseModel):
    """Complete dashboard-ready payload for the frontend."""
    company_ticker: str
    quarter: str = Field(description="Current quarter being analyzed, e.g. Q4_2026")
    quarter_previous: str = Field(description="Previous quarter for comparison, e.g. Q3_2026")
    executive_evasiveness_score: float = Field(
        ge=0, le=10,
        description="Score 0-10 based on how directly executives answered analyst questions"
    )
    insights: List[SectionalInsight] = Field(
        description="One SectionalInsight per thematic agent (4 total)"
    )
    overall_score: float = Field(
        description="Aggregate score: sum of all signal_scores across all agents, normalized to -10 to +10 range"
    )
    overall_signal: Literal["Positive", "Negative", "Mixed", "Noise"] = Field(
        description="Aggregate signal derived from overall_score"
    )
    summary: str = Field(
        description="2-3 sentence executive summary of the quarter-over-quarter changes"
    )
    validation_score: float = Field(
        default=100.0,
        description="Percentage of metrics that passed validation (0-100)"
    )
    flagged_count: int = Field(
        default=0,
        description="Number of metrics flagged or removed by the validation agent"
    )
    market_alignment_pct: float = Field(
        default=0.0,
        description="Percentage of signals where market agrees (0-100)"
    )
    stock_price_change: float = Field(
        default=0.0,
        description="Post-earnings stock price change in percentage"
    )
    market_sources: List[str] = Field(
        default_factory=list,
        description="Citation URLs from Google Search grounding"
    )
