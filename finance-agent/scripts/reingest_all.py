import sys
import os

sys.path.append(os.getcwd())

from tools.ingest import ingest_docs, ingest_financials

print("Starting Ingestion...")
print("1. Vector Store Ingestion")
res_docs = ingest_docs()
print(res_docs)

print("\n2. Structured Financial Ingestion")
res_fin = ingest_financials()
print(res_fin)
