require('dotenv').config();
const mongoose = require('mongoose');
const Song = require('../models/Song');
const PlaylistRecord = require('../models/PlaylistRecord');

(async () => {
  try {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/moodmixer';
    await mongoose.connect(uri);
    console.log('Mongo connected');

    const cursor = PlaylistRecord.find({ 'tracks.songId': { $exists: false } }).cursor();
    let scanned = 0, updated = 0;

    for await (const pr of cursor) {
      scanned++;
      const spIds = pr.tracks.map(t => t.spotifyId).filter(Boolean);
      if (!spIds.length) continue;

      const songs = await Song.find({ spotifyId: { $in: spIds } }, '_id spotifyId');
      const map = new Map(songs.map(s => [s.spotifyId, s._id]));

      let changed = false;
      pr.tracks = pr.tracks.map(t => {
        if (!t.songId && t.spotifyId && map.has(t.spotifyId)) {
          changed = true;
          return { ...t.toObject?.() ?? t, songId: map.get(t.spotifyId) };
        }
        return t;
      });

      if (changed) {
        await pr.save();
        updated++;
      }
    }

    console.log(`Scanned: ${scanned}, Updated: ${updated}`);
    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
