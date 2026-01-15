import faiss, os, numpy as np, json
from core.embeddings import embed

INDEX_PATH = "data/processed/finance.index"
META_PATH = "data/processed/meta.txt"

def load():
    if not os.path.exists(INDEX_PATH):
        return None, []

    index = faiss.read_index(INDEX_PATH)
    meta = [json.loads(line) for line in open(META_PATH).read().splitlines()]
    return index, meta

def save(index, meta):
    os.makedirs("data/processed", exist_ok=True)
    faiss.write_index(index, INDEX_PATH)
    with open(META_PATH, "w") as f:
        for m in meta:
            f.write(json.dumps(m) + "\n")

def add(texts, sources):
    vectors = embed(texts)
    dim = len(vectors[0])

    index, meta = load()
    if index is None:
        index = faiss.IndexFlatL2(dim)

    index.add(np.array(vectors).astype("float32"))
    
    # Store both source and text in metadata
    new_meta = [{"source": s, "text": t} for s, t in zip(sources, texts)]
    meta.extend(new_meta)

    save(index, meta)

def search(query, k=5):
    index, meta = load()
    if index is None:
        return []

    qv = embed(query)[0]
    D, I = index.search(np.array([qv]).astype("float32"), k)

    return [meta[i] for i in I[0]]