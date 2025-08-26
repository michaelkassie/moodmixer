// backend/routes/music.js
const express = require('express');
const axios = require('axios');
const router = express.Router();

require('dotenv').config();

// Models
const MoodEntry = require('../models/MoodEntry');
const ClickedSong = require('../models/ClickedSong');
const Song = require('../models/Song');
const PlaylistRecord = require('../models/PlaylistRecord');

// -----------------------------------------------------------------------------
// Auth: Spotify client credentials
// -----------------------------------------------------------------------------
let token = null;
let tokenExpiresAt = 0;

async function getSpotifyToken() {
  const now = Date.now();
  if (token && now < tokenExpiresAt) return token;

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Missing SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET');
  }

  const res = await axios.post(
    'https://accounts.spotify.com/api/token',
    new URLSearchParams({ grant_type: 'client_credentials' }),
    {
      headers: {
        Authorization:
          'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    }
  );

  token = res.data.access_token;
  tokenExpiresAt = now + res.data.expires_in * 1000 - 10_000; // small safety margin
  return token;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
function getUserId(req) {
  return (
    (req.user && (req.user._id || req.user.id)) ||
    req.headers['x-demo-user-id'] ||
    '000000000000000000000001'
  );
}

function toMinimalSongs(songs) {
  // UI/analytics expect: { name, artist, url }
  return songs.map((s) => ({
    name: s.name,
    artist: Array.isArray(s.artists) ? (s.artists[0] || '') : (s.artist || ''),
    url: s.url,
  }));
}

function dedupeById(songs) {
  const seen = new Set();
  const out = [];
  for (const s of songs) {
    if (!s.id || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

async function fetchAudioFeaturesById(accessToken, trackIds) {
  if (!trackIds.length) return {};
  // Spotify allows up to 100 ids per call
  const chunks = [];
  for (let i = 0; i < trackIds.length; i += 100) chunks.push(trackIds.slice(i, i + 100));

  const map = {};
  for (const ids of chunks) {
    const resp = await axios.get('https://api.spotify.com/v1/audio-features', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { ids: ids.join(',') },
      timeout: 15000,
    });
    for (const af of resp.data.audio_features || []) {
      if (!af) continue;
      map[af.id] = {
        danceability: af.danceability,
        energy: af.energy,
        valence: af.valence,
        tempo: af.tempo,
        acousticness: af.acousticness,
        instrumentalness: af.instrumentalness,
        liveness: af.liveness,
        speechiness: af.speechiness,
      };
    }
  }
  return map;
}

async function upsertSongs(spotifyTracks, featuresById) {
  if (!spotifyTracks.length) return;
  const ops = spotifyTracks.map((t) => ({
    updateOne: {
      filter: { spotifyId: t.id },
      update: {
        $set: {
          name: t.name,
          artists: t.artists || [],
          album: t.album || '',
          features: featuresById[t.id] || {},
        },
      },
      upsert: true,
    },
  }));
  await Song.bulkWrite(ops, { ordered: false });
}

async function fetchSongsFromFirstGoodPlaylist(accessToken, query) {
  // search a few playlists; return tracks from the first that yields items
  const playlistRes = await axios.get('https://api.spotify.com/v1/search', {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { q: query, type: 'playlist', limit: 3, market: 'US' },
    timeout: 15000,
  });

  const playlists = playlistRes.data.playlists?.items || [];
  for (const playlist of playlists) {
    const playlistId = playlist?.id;
    if (!playlistId) continue;

    try {
      const tracksRes = await axios.get(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { market: 'US', limit: 50 },
          timeout: 20000,
        }
      );

      const songs = (tracksRes.data.items || [])
        .map((item) => item?.track)
        .filter((t) => t?.id && t?.external_urls?.spotify)
        .map((t) => ({
          id: t.id,
          name: t.name,
          artists: (t.artists || []).map((a) => a.name),
          album: t.album?.name || '',
          url: t.external_urls.spotify,
        }));

      if (songs.length) return dedupeById(songs);
    } catch (e) {
      console.warn(`Playlist ${playlistId} fetch failed:`, e.response?.status, e.response?.data || e.message);
      // try next playlist
    }
  }
  return [];
}

// -----------------------------------------------------------------------------
// Routes
// -----------------------------------------------------------------------------

// Keep this before param routes (not strictly necessary, but harmless)
router.get('/history/all', async (req, res) => {
  try {
    const userId = getUserId(req);
    const history = await MoodEntry.find({ userId }).sort({ _id: -1 });
    res.json(history);
  } catch (err) {
    console.error('history/all error:', err.message);
    res.status(500).json({ error: 'Failed to load mood history' });
  }
});

// Log a clicked song (used by personalization)
router.post('/track', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { name, artist, url, mood } = req.body || {};
    if (!name || !artist || !url) {
      return res.status(400).json({ error: 'Missing fields: name, artist, url' });
    }
    await ClickedSong.create({ userId, name, artist, url, mood: mood || 'unknown', date: new Date() });
    res.json({ success: true });
  } catch (err) {
    console.error('Error saving clicked song:', err.message);
    res.status(500).json({ error: 'Failed to log song' });
  }
});

// Main: get playlist by mood
router.get('/by-mood/:mood', async (req, res) => {
  try {
    const moodMap = {
      happy: ['feel good', 'good vibes', 'sunshine'],
      sad: ['emotional', 'sad songs', 'heartbreak'],
      angry: ['hard rock', 'aggressive rap', 'metal'],
      tired: ['sleep', 'calm', 'ambient'],
      relaxed: ['chill', 'lofi', 'soft beats'],
      energetic: ['hype', 'party hits', 'workout'],
      focused: ['focus', 'deep work', 'study beats'],
    };

    const inputMood = String(req.params.mood || '').toLowerCase().trim();
    if (!inputMood) return res.status(400).json({ error: 'Missing mood' });

    const queries = [
      ...(moodMap[inputMood] || [inputMood]),
      inputMood, // explicit fallback
      'chill',   // last-resort fallback
    ];

    const accessToken = await getSpotifyToken();

    // Try queries until one yields tracks
    let songs = [];
    for (const q of queries) {
      const s = await fetchSongsFromFirstGoodPlaylist(accessToken, q);
      if (s.length) {
        songs = s;
        break;
      }
    }

    if (!songs.length) {
      return res.status(404).json({ error: 'No music found even after fallback' });
    }

    const userId = getUserId(req);
    const mappedSongs = toMinimalSongs(songs);

    // Enrich/Upsert Songs + write records
    try {
      const featuresById = await fetchAudioFeaturesById(accessToken, songs.map((s) => s.id));
      await upsertSongs(songs, featuresById);

      // Upsert a per-user playlist record for this mood (what analytics reads)
      await PlaylistRecord.findOneAndUpdate(
        { userId, mood: inputMood },
        { $set: { songs: mappedSongs, date: new Date() } },
        { upsert: true, new: true }
      );

      // Also log a per-request mood history row
      await MoodEntry.create({
        userId,
        mood: inputMood,
        songs: mappedSongs,
        date: new Date(),
      });
    } catch (dbErr) {
      console.error('DB save error:', dbErr.message);
      // do not fail the request; still return songs to the client
    }

    // Respond in the simple shape the UI expects
    res.json(mappedSongs);
  } catch (error) {
    console.error('Error fetching music:', error.message);
    console.error('Full error:', error.response?.data || error);
    res.status(500).json({ error: 'Failed to fetch music' });
  }
});

module.exports = router;
