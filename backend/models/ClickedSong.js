const mongoose = require('mongoose');

const clickedSongSchema = new mongoose.Schema({
  name: String,
  artist: String,
  url: String,
  mood: String,
  clickedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ClickedSong', clickedSongSchema);
