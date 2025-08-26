const express = require("express");
const axios = require("axios");
const PlaylistRecord = require("../models/PlaylistRecord");
const Song = require("../models/Song");

const router = express.Router();
const ML_BASE = process.env.ML_BASE || "http://localhost:8001";

router.get("/personalized", async (req, res) => {
  try {
    const userId = req.headers["x-demo-user-id"] || "000000000000000000000001";

    const records = await PlaylistRecord.find({ userId }).populate("tracks.songId");
    const history = [];
    for (const r of records) {
      for (const t of r.tracks) {
        if (t.songId?.features) {
          history.push({
            spotifyId: t.spotifyId,
            name: t.songId.name,
            artists: t.songId.artists,
            features: t.songId.features
          });
        }
      }
    }

    const catalogDocs = await Song.find({}, "spotifyId name artists features").limit(1000);
    const catalog = catalogDocs.map(s => ({
      spotifyId: s.spotifyId, name: s.name, artists: s.artists, features: s.features
    }));

    const { data } = await axios.post(`${ML_BASE}/recommend`, {
      user_history: history, catalog, top_k: 30
    });

    res.json(data);
  } catch (e) {
    console.error("recs error:", e.message);
    res.status(500).json({ error: "recs_failed" });
  }
});

module.exports = router;
