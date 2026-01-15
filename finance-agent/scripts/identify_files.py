from pypdf import PdfReader
from docx import Document
import os

def identify_pdf(path):
    try:
        reader = PdfReader(path)
        text = reader.pages[0].extract_text()
        print(f"--- PDF: {path} ---")
        print(text[:500])
    except Exception as e:
        print(f"Error reading PDF {path}: {e}")

def identify_docx(path):
    try:
        doc = Document(path)
        text = "\n".join([p.text for p in doc.paragraphs[:5]])
        print(f"--- DOCX: {path} ---")
        print(text[:500])
    except Exception as e:
        print(f"Error reading DOCX {path}: {e}")

if __name__ == "__main__":
    folder = "data/raw"
    for f in os.listdir(folder):
        path = os.path.join(folder, f)
        if f.endswith(".pdf") and f != "_10-K-2025-As-Filed.pdf":
            identify_pdf(path)
        elif f.endswith(".docx"):
            identify_docx(path)
