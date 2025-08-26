const express = require("express");
const PlaylistRecord = require("../models/PlaylistRecord");
const router = express.Router();

router.get("/overview", async (req, res, next) => {
  try {
    const userId = req.headers["x-demo-user-id"] || "000000000000000000000001";

    const topMoods = await PlaylistRecord.aggregate([
      { $match: { userId } },
      { $group: { _id: "$mood", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    const avgFeaturesPerMood = await PlaylistRecord.aggregate([
      { $match: { userId } },
      { $unwind: "$tracks" },
      { $lookup: { from: "songs", localField: "tracks.songId", foreignField: "_id", as: "song" } },
      { $unwind: "$song" },
      { $group: {
        _id: "$mood",
        danceability: { $avg: "$song.features.danceability" },
        energy:       { $avg: "$song.features.energy" },
        valence:      { $avg: "$song.features.valence" },
        tempo:        { $avg: "$song.features.tempo" }
      }},
      { $project: { _id: 0, mood: "$_id", danceability: 1, energy: 1, valence: 1, tempo: 1 } },
      { $sort: { mood: 1 } }
    ]);

    res.json({ topMoods, avgFeaturesPerMood });
  } catch (err) { next(err); }
});

module.exports = router;
