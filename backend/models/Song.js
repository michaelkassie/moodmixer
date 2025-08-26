const mongoose = require("mongoose");

const AudioFeatures = new mongoose.Schema({
  danceability: Number, energy: Number, valence: Number, tempo: Number,
  acousticness: Number, instrumentalness: Number, liveness: Number, speechiness: Number
}, { _id: false });

const SongSchema = new mongoose.Schema({
  spotifyId: { type: String, unique: true, index: true },
  name: String,
  artists: [String],
  album: String,
  features: AudioFeatures
}, { timestamps: true });

module.exports = mongoose.model("Song", SongSchema);
