"""
LLM configuration for the multi-agent framework.
Uses google-genai SDK directly for reliable structured JSON output.
"""
import os
import json
import logging
from typing import Type, TypeVar
from dotenv import load_dotenv
from pydantic import BaseModel
from google import genai
from google.genai import types

load_dotenv()
logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)

_client = None


def get_client() -> genai.Client:
    """Get or create the Google GenAI client."""
    global _client
    if _client is None:
        api_key = os.getenv("GOOGLE_API_KEY")
        if not api_key:
            raise ValueError("GOOGLE_API_KEY not found in environment variables")
        _client = genai.Client(api_key=api_key)
    return _client


def invoke_structured(
    system_prompt: str,
    user_prompt: str,
    schema: Type[T],
    model: str = "gemini-2.0-flash",
    temperature: float = 0,
) -> T:
    """
    Call Gemini with structured JSON output enforced by schema.
    
    Args:
        system_prompt: System instruction for the LLM
        user_prompt: User message with the actual content
        schema: Pydantic model class to enforce as response schema
        model: Gemini model name
        temperature: Generation temperature
    
    Returns:
        Parsed Pydantic model instance
    """
    client = get_client()

    response = client.models.generate_content(
        model=model,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=temperature,
            response_mime_type="application/json",
            response_schema=schema,
        ),
    )

    raw = response.text
    data = json.loads(raw)
    return schema.model_validate(data)


def invoke_grounded(
    system_prompt: str,
    user_prompt: str,
    model: str = "gemini-2.0-flash",
    temperature: float = 0,
) -> tuple:
    """
    Call Gemini with Google Search grounding enabled.
    Returns (response_text, source_urls) — no JSON schema, freeform text.
    
    The model automatically searches the web, processes results, and
    provides citations in groundingMetadata.
    """
    client = get_client()

    grounding_tool = types.Tool(google_search=types.GoogleSearch())

    response = client.models.generate_content(
        model=model,
        contents=user_prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=temperature,
            tools=[grounding_tool],
        ),
    )

    # Extract source URLs from grounding metadata
    source_urls = []
    if response.candidates and response.candidates[0].grounding_metadata:
        metadata = response.candidates[0].grounding_metadata
        if metadata.grounding_chunks:
            for chunk in metadata.grounding_chunks:
                if chunk.web and chunk.web.uri:
                    source_urls.append(chunk.web.uri)

    return response.text or "", source_urls
