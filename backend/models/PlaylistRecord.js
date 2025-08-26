const mongoose = require("mongoose");

const TrackRef = new mongoose.Schema({
  songId: { type: mongoose.Schema.Types.ObjectId, ref: "Song" },
  spotifyId: String
}, { _id: false });

const PlaylistRecordSchema = new mongoose.Schema({
  userId: { type: String, index: true }, // simple for now
  mood: { type: String, index: true },
  tracks: [TrackRef],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("PlaylistRecord", PlaylistRecordSchema);
