from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict
import nltk
from nltk.sentiment import SentimentIntensityAnalyzer
import numpy as np
from numpy.linalg import norm

# ensure VADER lexicon (downloads on first run)
try:
    nltk.data.find("sentiment/vader_lexicon.zip")
except LookupError:
    nltk.download("vader_lexicon")

sia = SentimentIntensityAnalyzer()
app = FastAPI(title="MoodMixer ML Service")

FEATURES = ["danceability","energy","valence","tempo","acousticness","instrumentalness","liveness","speechiness"]

def cosine_sim(a, b):
    a = np.array(a); b = np.array(b)
    if norm(a) == 0 or norm(b) == 0:
        return 0.0
    return float(np.dot(a, b) / (norm(a) * norm(b)))

class Track(BaseModel):
    spotifyId: str
    name: str | None = None
    artists: List[str] | None = None
    features: Dict[str, float]

class RecRequest(BaseModel):
    user_history: List[Track]
    catalog: List[Track]
    top_k: int = 20

class SentRequest(BaseModel):
    text: str

@app.post("/sentiment")
def sentiment(req: SentRequest):
    scores = sia.polarity_scores(req.text)
    c = scores["compound"]
    if c >= 0.5: mood = "happy"
    elif c <= -0.3: mood = "sad"
    elif -0.3 < c < 0.1: mood = "tired"
    else: mood = "relaxed"
    return {"mood": mood, "sentiment": scores}

@app.post("/recommend")
def recommend(req: RecRequest):
    if not req.user_history or not req.catalog:
        return {"recommendations": []}
    target = [float(sum(t.features.get(f,0) for t in req.user_history)/len(req.user_history)) for f in FEATURES]
    scored = []
    for t in req.catalog:
        feat = [t.features.get(f,0) for f in FEATURES]
        scored.append({
            "spotifyId": t.spotifyId,
            "name": t.name,
            "artists": t.artists,
            "score": cosine_sim(target, feat)
        })
    scored.sort(key=lambda x: x["score"], reverse=True)
    return {"recommendations": scored[:req.top_k]}
