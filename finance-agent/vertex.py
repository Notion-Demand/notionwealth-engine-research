import os
import hashlib
import time
from collections import OrderedDict
from google import genai
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

# In-memory LRU cache for LLM responses (max 128 entries)
_llm_cache = OrderedDict()
_LLM_CACHE_MAX = 128


def _prompt_hash(prompt: str) -> str:
    return hashlib.sha256(prompt.encode()).hexdigest()


def call_gemini(prompt: str, use_cache: bool = True, max_retries: int = 3) -> str:
    # Check cache
    if use_cache:
        key = _prompt_hash(prompt)
        if key in _llm_cache:
            _llm_cache.move_to_end(key)
            return _llm_cache[key]

    # Call API with retry
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.0-flash-exp",
                contents=prompt
            )
            result = response.text

            if use_cache:
                _llm_cache[key] = result
                if len(_llm_cache) > _LLM_CACHE_MAX:
                    _llm_cache.popitem(last=False)

            return result
        except Exception as e:
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise
