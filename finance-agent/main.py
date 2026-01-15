from fastapi import FastAPI
from pydantic import BaseModel
from vertex import call_gemini

app = FastAPI()

class Query(BaseModel):
    question: str

@app.post("/ask")
def ask(query: Query):
    answer = call_gemini(query.question)
    return {"answer": answer}