"""
Pydantic models for structured LLM output and data validation.
"""
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class SignalClassification(str, Enum):
    """Classification of disclosure change signal."""
    POSITIVE = "Positive"
    NEGATIVE = "Negative"
    NOISE = "Noise"


class DisclosureChange(BaseModel):
    """A single meaningful change detected between quarters."""
    section: str = Field(description="Section name: MD&A, Risk_Factors, or Accounting")
    quote_old: str = Field(description="Specific snippet from previous quarter (verbatim, <100 words)")
    quote_new: str = Field(description="Specific snippet from current quarter (verbatim, <100 words)")
    description_of_change: str = Field(description="One-sentence summary of what changed")
    signal_classification: SignalClassification = Field(description="Positive, Negative, or Noise")


class SectionComparison(BaseModel):
    """Structured output from LLM comparison of a single section."""
    changes: List[DisclosureChange] = Field(
        default_factory=list,
        description="List of meaningful changes detected"
    )
    
    
class CompanyQuarterData(BaseModel):
    """Structured data for a single company-quarter."""
    company: str
    quarter: str
    md_a: Optional[str] = Field(None, alias="MD&A")
    risk_factors: Optional[str] = Field(None, alias="Risk_Factors")
    accounting: Optional[str] = Field(None, alias="Accounting")
    
    class Config:
        populate_by_name = True
