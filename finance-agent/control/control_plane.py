import json
import uuid
import datetime
from pydantic import BaseModel, Field
from typing import List, Dict, Optional, Any
from agents.financial_agent import analyze_financials
from core.financial_memory import load_facts, get_facts_for_companies
from core.entity_extraction import extract_companies
from control.research_replay import save_session
import re

# --- Data Models ---

class TraceStep(BaseModel):
    step_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = Field(default_factory=lambda: datetime.datetime.now().isoformat())
    action: str
    output: Any

class VerificationItem(BaseModel):
    claim: str
    status: str # "Verified", "Unverified", "Contradicted"
    evidence: Optional[str] = None
    confidence: float

class VerificationReport(BaseModel):
    items: List[VerificationItem]
    summary_score: float

class ResearchSession(BaseModel):
    session_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    query: str
    trace: List[TraceStep] = []
    final_result: Optional[str] = None
    verification_report: Optional[VerificationReport] = None

# --- Verification Agent ---

class VerificationAgent:
    def verify(self, text: str, companies: list[str] = None) -> VerificationReport:
        if companies:
            facts = get_facts_for_companies(companies)
        else:
            facts = load_facts()
        items = []
        
        # Simple heuristic: extract numbers and check if they exist in facts
        # In a real system, we'd use an LLM or stricter NLI
        
        # 1. Extract potential claims (sentences with numbers)
        sentences = [s.strip() for s in text.split('.') if any(c.isdigit() for c in s)]
        
        verified_count = 0
        
        for sent in sentences:
            found_match = False
            # Clean sentence for partial matching
            sent_clean = sent.lower()
            
            for fact in facts:
                # Check if fact value is in sentence
                fact_val = str(fact.get("value", ""))
                
                # Normalize both: remove $, commas, percent
                def normalize(s):
                    return s.replace('$', '').replace(',', '').replace('%', '').strip()

                fact_val_norm = normalize(fact_val)
                sent_norm = normalize(sent_clean)
                
                # Only match if the number is significant (more than 1 digit) to avoid matching "2" in "2025" or similar noise
                # But here we assume fact_val is a specific metric value
                
                # Check for substring match of the value
                if fact_val_norm and fact_val_norm in sent_norm:
                    # Context check: does company or metric appear?
                    # Split metric into words and check if at least one significant word appears in sentence
                    metric_words = [w.lower() for w in fact.get("metric", "").split() if len(w) > 3]
                    
                    context_match = False
                    if not metric_words: # specific metric name might be short
                         if fact.get("metric", "").lower() in sent_clean:
                             context_match = True
                    else:
                         if any(w in sent_clean for w in metric_words):
                             context_match = True

                    if context_match:
                         items.append(VerificationItem(
                             claim=sent,
                             status="Verified",
                             evidence=f"Matched fact: {fact['metric']} = {fact['value']} ({fact['source_file']})",
                             confidence=0.9
                         ))
                         found_match = True
                         verified_count += 1
                         break
            
            if not found_match:
                 items.append(VerificationItem(
                     claim=sent,
                     status="Unverified",
                     evidence="No exact structured fact match found.",
                     confidence=0.5
                 ))
                 
        score = verified_count / len(sentences) if sentences else 0.0
        return VerificationReport(items=items, summary_score=score)

# --- Control Plane ---

class ControlPlane:
    def run_task(self, query: str) -> ResearchSession:
        session = ResearchSession(query=query)
        companies = extract_companies(query)

        # 1. Execute Research
        session.trace.append(TraceStep(action="Start Task", output=f"Query: {query}"))

        try:
            result = analyze_financials(query)
            session.final_result = result
            session.trace.append(TraceStep(action="Agent Analysis", output=result))
        except Exception as e:
            session.trace.append(TraceStep(action="Error", output=str(e)))
            return session

        # 2. Verify (using filtered facts for speed)
        verifier = VerificationAgent()
        report = verifier.verify(result, companies=companies)
        session.verification_report = report
        session.trace.append(TraceStep(action="Verification", output=report.model_dump()))
        
        # Save session for replay
        save_session(session.model_dump())
        
        return session

# --- Singleton / Tool Entrypoint ---

control_plane = ControlPlane()

def run_research_task(query: str) -> str:
    """
    Run a full financial research task with verification and tracing.
    Returns a JSON string of the session.
    """
    session = control_plane.run_task(query)
    return session.model_dump_json(indent=2)
