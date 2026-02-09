import os
from google import genai

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

def generate(prompt, model="gemini-2.0-flash"):
    return client.models.generate_content(
        model=model,
        contents=prompt
    ).text