# app.py
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List, Dict, Optional
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

# ----------------- Models -----------------
class Track(BaseModel):
    spotifyId: str
    name: Optional[str] = None
    artists: Optional[List[str]] = None
    features: Dict[str, float]

class RecRequest(BaseModel):
    user_history: List[Track]
    catalog: List[Track]
    top_k: int = 20

class SentRequest(BaseModel):
    text: str

# For /predict (re-ranking the provided list)
class PredictTrack(BaseModel):
    # accept either id or spotifyId from the caller
    id: Optional[str] = None
    spotifyId: Optional[str] = None
    features: Dict[str, float] = {}

class PredictIn(BaseModel):
    mood: str
    tracks: List[PredictTrack]

# ----------------- Health -----------------
@app.get("/health")
def health():
    return {"ok": True}

# ----------------- Sentiment -----------------
@app.post("/sentiment")
def sentiment(req: SentRequest):
    scores = sia.polarity_scores(req.text)
    c = scores["compound"]
    if c >= 0.5: mood = "happy"
    elif c <= -0.3: mood = "sad"
    elif -0.3 < c < 0.1: mood = "tired"
    else: mood = "relaxed"
    return {"mood": mood, "sentiment": scores}

# ----------------- Recommend (history + catalog) -----------------
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

# ----------------- Predict (re-rank current list) -----------------
@app.post("/predict")
def predict(inp: PredictIn):
    mood = inp.mood.lower().strip()
    # simple weights; tweak as you like
    weights_by_mood = {
        "happy":     {"valence": 0.6, "danceability": 0.3, "energy": 0.1},
        "sad":       {"valence": -0.7, "acousticness": 0.3},
        "energetic": {"energy": 0.6, "danceability": 0.3, "valence": 0.1},
        "focused":   {"instrumentalness": 0.5, "acousticness": 0.2, "liveness": -0.2, "speechiness": -0.1},
        "relaxed":   {"acousticness": 0.4, "valence": 0.3, "energy": -0.2},
        "angry":     {"energy": 0.6, "valence": -0.3},
        "tired":     {"acousticness": 0.4, "energy": -0.4},
    }
    w = weights_by_mood.get(mood, {"valence": 0.4, "danceability": 0.3, "energy": 0.3})

    def score(feat: Dict[str, float]) -> float:
        return sum(w.get(k, 0.0) * float(feat.get(k, 0.0)) for k in w.keys())

    # normalize id field
    items = []
    for t in inp.tracks:
        tid = t.id or t.spotifyId  # accept either
        if not tid:
            continue
        items.append((tid, t.features))

    ranked = sorted(items, key=lambda p: score(p[1]), reverse=True)
    # Return a plain list of IDs to match your Node parser
    return [tid for tid, _ in ranked]
