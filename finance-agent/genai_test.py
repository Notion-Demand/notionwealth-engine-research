from google import genai

client = genai.Client()

resp = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Explain compound interest in one paragraph."
)

print(resp.text)