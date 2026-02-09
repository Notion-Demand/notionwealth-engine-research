import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

# Cache for embedding results (text string -> embedding vector)
_embed_cache = {}


def embed(texts):
    if isinstance(texts, str):
        texts = [texts]

    all_embeddings = [None] * len(texts)
    uncached_texts = []
    uncached_indices = []

    for i, text in enumerate(texts):
        if text in _embed_cache:
            all_embeddings[i] = _embed_cache[text]
        else:
            uncached_texts.append(text)
            uncached_indices.append(i)

    # Batch-embed only uncached texts
    if uncached_texts:
        batch_size = 100
        new_embeddings = []
        for j in range(0, len(uncached_texts), batch_size):
            batch = uncached_texts[j : j + batch_size]
            res = client.models.embed_content(
                model="models/gemini-embedding-001",
                contents=batch
            )
            new_embeddings.extend([e.values for e in res.embeddings])

        for idx, emb_idx in enumerate(uncached_indices):
            all_embeddings[emb_idx] = new_embeddings[idx]
            _embed_cache[uncached_texts[idx]] = new_embeddings[idx]

    return all_embeddings
