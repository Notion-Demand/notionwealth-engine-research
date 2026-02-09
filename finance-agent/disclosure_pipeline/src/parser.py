"""
PDF parser for extracting sections from financial disclosure documents.
"""
import json
import re
import logging
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pdfplumber

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class DocumentParser:
    """Extracts MD&A, Risk Factors, and Accounting sections from 10-Q/10-K PDFs."""
    
    # Regex patterns for section detection
    SECTION_PATTERNS = {
        "MD&A": [
            r"Item\s*2\s*[.:-]?\s*Management'?s?\s*Discussion",
            r"MD&A",
            r"Management'?s?\s*Discussion\s*and\s*Analysis"
        ],
        "Risk_Factors": [
            r"Item\s*1A\s*[.:-]?\s*Risk\s*Factors",
            r"Risk\s*Factors"
        ],
        "Accounting": [
            r"Critical\s*Accounting\s*Policies",
            r"Summary\s*of\s*Significant\s*Accounting\s*Policies",
            r"Note\s*1\s*[.:-]?\s*Summary\s*of\s*Significant\s*Accounting"
        ]
    }
    
    def __init__(self, pdf_path: Path):
        self.pdf_path = pdf_path
        self.text = ""
        self.pages = []
        
    def extract_text(self) -> str:
        """Extract all text from PDF using pdfplumber."""
        try:
            with pdfplumber.open(str(self.pdf_path)) as pdf:
                for page_num, page in enumerate(pdf.pages):
                    text = page.extract_text() or ""
                    self.pages.append({
                        "page_num": page_num + 1,
                        "text": text
                    })
                    self.text += f"\n--- PAGE {page_num + 1} ---\n{text}"
            
            logger.info(f"Extracted {len(self.pages)} pages from {self.pdf_path.name}")
            return self.text
        except Exception as e:
            logger.error(f"Failed to extract text from {self.pdf_path.name}: {e}")
            return ""
    
    def find_section(self, section_name: str) -> Optional[str]:
        """
        Find and extract a specific section using regex patterns.
        Returns the section text or None if not found.
        """
        patterns = self.SECTION_PATTERNS.get(section_name, [])
        
        # Try each pattern
        for pattern in patterns:
            match = re.search(pattern, self.text, re.IGNORECASE | re.MULTILINE)
            if match:
                start_pos = match.start()
                
                # Find the next section header to determine endpoint
                end_pos = self._find_next_section(start_pos)
                
                section_text = self.text[start_pos:end_pos].strip()
                
                # Limit to reasonable size (~10 pages worth)
                if len(section_text) > 30000:
                    section_text = section_text[:30000] + "\n... [truncated]"
                
                logger.info(f"Found {section_name} in {self.pdf_path.name} ({len(section_text)} chars)")
                return section_text
        
        # Fuzzy fallback: search for keywords
        return self._fuzzy_search(section_name)
    
    def _find_next_section(self, start_pos: int) -> int:
        """Find the start of the next major section (Item X)."""
        # Look for next "Item" pattern after current position
        next_section = re.search(r"\n\s*Item\s+\d+[A-Z]?\s*[.:-]", self.text[start_pos + 100:], re.IGNORECASE)
        if next_section:
            return start_pos + 100 + next_section.start()
        # If no next section found, take next ~15000 chars (≈ 5-10 pages)
        return min(start_pos + 15000, len(self.text))
    
    def _fuzzy_search(self, section_name: str) -> Optional[str]:
        """Fallback fuzzy search if exact patterns don't match."""
        keywords = {
            "MD&A": ["management", "discussion", "analysis", "results of operations"],
            "Risk_Factors": ["risk factors", "risks", "uncertainties"],
            "Accounting": ["accounting policies", "accounting estimates", "critical accounting"]
        }
        
        search_terms = keywords.get(section_name, [])
        for term in search_terms:
            match = re.search(re.escape(term), self.text, re.IGNORECASE)
            if match:
                start_pos = max(0, match.start() - 500)  # Include some context before
                end_pos = min(len(self.text), match.start() + 5000)
                logger.warning(f"Fuzzy match for {section_name} in {self.pdf_path.name} using '{term}'")
                return self.text[start_pos:end_pos].strip()
        
        logger.warning(f"Could not find {section_name} in {self.pdf_path.name}")
        return None
    
    def parse(self) -> Dict[str, Optional[str]]:
        """
        Parse the PDF and extract all sections.
        Returns dict with section names as keys.
        """
        if not self.text:
            self.extract_text()
        
        return {
            "MD&A": self.find_section("MD&A"),
            "Risk_Factors": self.find_section("Risk_Factors"),
            "Accounting": self.find_section("Accounting")
        }


def parse_filename(filename: str) -> Optional[Dict[str, str]]:
    """
    Parse filename to extract company ticker and quarter.
    Expected format: CompanyTicker_Q#_Year.pdf
    Example: AAPL_Q1_2024.pdf
    """
    pattern = r"^([A-Z]+)_Q(\d)_(\d{4})\.pdf$"
    match = re.match(pattern, filename, re.IGNORECASE)
    if match:
        return {
            "company": match.group(1).upper(),
            "quarter": f"Q{match.group(2)}_{match.group(3)}"
        }
    logger.warning(f"Filename {filename} doesn't match expected format: CompanyTicker_Q#_Year.pdf")
    return None


def parse_all_pdfs(
    data_dir: str = "data", 
    use_semantic_extraction: bool = True,
    target_company: Optional[str] = None
) -> Dict:
    """
    Parse all PDFs in the data directory.
    Returns nested dict: {company: {quarter: {section: text}}}
    
    Args:
        data_dir: Directory containing PDF files
        use_semantic_extraction: If True, use AI to extract sections from unstructured transcripts.
                                 If False, use regex-based section detection (for structured SEC filings).
        target_company: Optional company name substring to filter files (case-insensitive).
    """
    data_path = Path(data_dir)
    if not data_path.exists():
        logger.error(f"Data directory {data_dir} does not exist")
        return {}
    
    results = {}
    pdf_files = list(data_path.glob("*.pdf"))
    
    if not pdf_files:
        logger.warning(f"No PDF files found in {data_dir}")
        return {}
    
    logger.info(f"Found {len(pdf_files)} PDF files potential candidates")
    if target_company:
        logger.info(f"Filtering for company: {target_company}")

    logger.info(f"Extraction mode: {'Semantic (AI-based)' if use_semantic_extraction else 'Regex-based (SEC filings)'}")
    
    for pdf_path in pdf_files:
        # 1. Filter by target company if specified
        if target_company and target_company.lower() not in pdf_path.name.lower():
            continue

        # Parse filename to get company and quarter
        # Heuristic: try standard format first, else use filename as company placeholder
        file_info = parse_filename(pdf_path.name)
        
        if file_info:
            company = file_info["company"]
            quarter = file_info["quarter"]
        else:
            # Fallback for non-standard filenames (e.g. "Bajaj Finance Q1.pdf")
            # We use the filename as company and try to guess quarter, or just use filename
            company = target_company.upper() if target_company else "UNKNOWN"
            # Try to extract quarter from filename
            q_match = re.search(r"(Q[1-4]).*?(FY\d{2})", pdf_path.name, re.IGNORECASE)
            if q_match:
                quarter = f"{q_match.group(1).upper()}_{q_match.group(2).upper()}"
            else:
                quarter = pdf_path.stem

        # Parse the document
        
        # Parse the document
        parser = DocumentParser(pdf_path)
        
        if use_semantic_extraction:
            # For earnings call transcripts: extract full text, then use AI to categorize
            full_text = parser.extract_text()
            
            if not full_text or len(full_text) < 100:
                logger.warning(f"Insufficient text extracted from {pdf_path.name}, skipping")
                continue
            
            # Import here to avoid circular dependency
            from .semantic_extraction import extract_semantic_sections
            
            logger.info(f"Using semantic extraction for {company} {quarter}...")
            sections = extract_semantic_sections(full_text, company, quarter)
        else:
            # For structured SEC filings: use regex-based section detection
            logger.info(f"Using regex-based extraction for {company} {quarter}...")
            sections = parser.parse()
        
        # Store results
        if company not in results:
            results[company] = {}
        results[company][quarter] = sections
    
    logger.info(f"Successfully parsed data for {len(results)} companies")
    return results


def save_parsed_data(data: Dict, output_path: str = "output/parsed_data.json"):
    """Save parsed data to JSON file."""
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    logger.info(f"Saved parsed data to {output_path}")


if __name__ == "__main__":
    # Test parsing
    import argparse
    
    parser_cli = argparse.ArgumentParser()
    parser_cli.add_argument("--semantic", action="store_true", help="Use semantic extraction (for transcripts)")
    parser_cli.add_argument("--regex", action="store_true", help="Use regex extraction (for SEC filings)")
    args = parser_cli.parse_args()
    
    use_semantic = not args.regex  # Default to semantic
    
    parsed = parse_all_pdfs("data", use_semantic_extraction=use_semantic)
    save_parsed_data(parsed)
    print(f"Parsed {len(parsed)} companies using {'semantic' if use_semantic else 'regex'} extraction")
