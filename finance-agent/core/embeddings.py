import os
from google import genai

from dotenv import load_dotenv
load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

def embed(texts):
    if isinstance(texts, str):
        texts = [texts]

    all_embeddings = []
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        res = client.models.embed_content(
            model="text-embedding-004",
            contents=batch
        )
        all_embeddings.extend([e.values for e in res.embeddings])
        
    return all_embeddings