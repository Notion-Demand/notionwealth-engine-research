from pathlib import Path
from pypdf import PdfReader
from core.vector import add
from core.extraction import extract_financials
from core.financial_memory import save_facts, clear_memory


def chunk(text, size=1200, overlap=200):
    out, i = [], 0
    while i < len(text):
        out.append(text[i:i+size])
        i += size - overlap
    return out



from docx import Document

def extract_text_from_file(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(path)
        return "\n".join(
            p.extract_text() for p in reader.pages if p.extract_text()
        )
    elif path.suffix.lower() == ".docx":
        doc = Document(path)
        return "\n".join([p.text for p in doc.paragraphs])
    return ""

def ingest_docs(folder: str = "data/raw") -> str:
    """
    Ingest PDFs and DOCX from a folder into the finance vector store.
    """
    docs = []
    sources = []

    for path in Path(folder).iterdir():
        if path.suffix.lower() not in [".pdf", ".docx"]:
            continue
            
        text = extract_text_from_file(path)
        if not text: continue
        
        chunks = chunk(text)

        docs.extend(chunks)
        sources.extend([path.name] * len(chunks))

    if docs:
        add(docs, sources)
    return f"Ingested {len(docs)} chunks from {len(set(sources))} documents"

def ingest_financials(folder: str = "data/raw") -> str:
    """
    Ingest PDFs/DOCX from a folder and extract structured financial facts.
    """
    count = 0
    
    for path in Path(folder).iterdir():
        if path.suffix.lower() not in [".pdf", ".docx"]:
            continue
            
        print(f"Processing for structured data: {path.name}")
        text = extract_text_from_file(path)
        if not text: continue
        
        # Use larger chunks for context in structured extraction
        chunks = chunk(text, size=4000, overlap=200)

        for c in chunks:
            facts = extract_financials(c, path.name)
            if facts:
                save_facts(facts)
                count += len(facts)
                print(f"  Extracted {len(facts)} facts from chunk.")
                
    return f"Structured ingestion complete. Extracted {count} facts."
