const mongoose = require('mongoose');

const moodEntrySchema = new mongoose.Schema({
  mood: String,
  date: { type: Date, default: Date.now },
  songs: [
    {
      name: String,
      artist: String,
      url: String
    }
  ]
});

module.exports = mongoose.model('MoodEntry', moodEntrySchema);
