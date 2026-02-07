import faiss, os, numpy as np, json
from core.embeddings import embed

INDEX_PATH = "data/processed/finance.index"
META_PATH = "data/processed/meta.txt"

# Module-level singleton cache
_cached_index = None
_cached_meta = None

def invalidate_cache():
    """Call after save() or add() to force reload on next access."""
    global _cached_index, _cached_meta
    _cached_index = None
    _cached_meta = None

def load():
    """Load FAISS index + metadata. Uses in-memory cache after first call."""
    global _cached_index, _cached_meta
    if _cached_index is not None:
        return _cached_index, _cached_meta

    if not os.path.exists(INDEX_PATH):
        return None, []

    _cached_index = faiss.read_index(INDEX_PATH)
    _cached_meta = [json.loads(line) for line in open(META_PATH).read().splitlines()]
    return _cached_index, _cached_meta

def save(index, meta):
    os.makedirs("data/processed", exist_ok=True)
    faiss.write_index(index, INDEX_PATH)
    with open(META_PATH, "w") as f:
        for m in meta:
            f.write(json.dumps(m) + "\n")
    invalidate_cache()

def add(texts, sources):
    vectors = embed(texts)
    dim = len(vectors[0])

    index, meta = load()
    if index is None:
        index = faiss.IndexFlatL2(dim)

    index.add(np.array(vectors).astype("float32"))

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
