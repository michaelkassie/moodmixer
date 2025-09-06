const express = require("express");
const axios = require("axios");
const PlaylistRecord = require("../models/PlaylistRecord");
const Song = require("../models/Song");

const router = express.Router();
const ML_BASE = process.env.ML_BASE || "http://localhost:8001";

router.get("/personalized", async (req, res) => {
  try {
    const userId = req.headers["x-demo-user-id"] || "000000000000000000000001";

    // 1) Build user history from prior playlists (tracks.songId populated)
    const records = await PlaylistRecord
      .find({ userId })
      .populate("tracks.songId")
      .lean();

    const history = [];
    for (const r of records) {
      for (const t of r.tracks || []) {
        const s = t.songId;
        if (s && s.features) {
          history.push({
            spotifyId: s.spotifyId,          // <-- FIXED
            name: s.name,
            artists: s.artists,
            features: s.features,
          });
        }
      }
    }

    // 2) Build a candidate catalog (trimmed)
    const catalogDocs = await Song
      .find({}, { spotifyId: 1, name: 1, artists: 1, features: 1 })
      .limit(1000)
      .lean();

    const catalog = catalogDocs
      .filter(s => !!s.features) // ensure features exist
      .map(s => ({
        spotifyId: s.spotifyId,
        name: s.name,
        artists: s.artists,
        features: s.features,
      }));

    // If history empty, short-circuit to a simple baseline (first N from catalog)
    if (!history.length) {
      return res.json(catalog.slice(0, 30));
    }

    // 3) Call ML service
    const mlPayload = { user_history: history, catalog, top_k: 30 };
    const { data } = await axios.post(`${ML_BASE}/recommend`, mlPayload, { timeout: 15000 });

    // 4) Normalize ML response:
    //    - either an array of spotifyIds
    //    - or { ids: [...]} or { items: [{id, score}, ...]}
    let rankedIds = [];
    if (Array.isArray(data)) {
      rankedIds = data;
    } else if (Array.isArray(data?.ids)) {
      rankedIds = data.ids;
    } else if (Array.isArray(data?.items)) {
      rankedIds = data.items.map(x => x.id);
    }

    if (!rankedIds.length) {
      // fallback to baseline if ML returns nothing
      return res.json(catalog.slice(0, 30));
    }

    // 5) Map ranked ids back to full song objects (preserve order)
    const byId = new Map(catalog.map(s => [s.spotifyId, s]));
    const ranked = rankedIds
      .map(id => byId.get(id))
      .filter(Boolean);

    // If some ranked ids weren’t in catalog, top up with remaining catalog
    if (ranked.length < 30) {
      const seen = new Set(ranked.map(s => s.spotifyId));
      for (const s of catalog) {
        if (ranked.length >= 30) break;
        if (!seen.has(s.spotifyId)) ranked.push(s);
      }
    }

    res.json(ranked);
  } catch (e) {
    console.error("recs error:", e.message);
    // last-resort fallback to a small baseline
    try {
      const fallback = await Song.find({}, { spotifyId: 1, name: 1, artists: 1, features: 1 })
        .limit(30).lean();
      return res.json(fallback);
    } catch {
      return res.status(500).json({ error: "recs_failed" });
    }
  }
});

module.exports = router;
