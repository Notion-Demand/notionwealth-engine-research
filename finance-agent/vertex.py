import os
from google import genai
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

def call_gemini(prompt: str):
    response = client.models.generate_content(
        model="gemini-2.0-flash-exp", # Trying a model that likely exists or fallback to 1.5-flash
        contents=prompt
    )
    return response.text