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

// ---------- Config ----------
const ML_BASE = process.env.ML_BASE || process.env.FASTAPI_URL || 'http://localhost:8001';

// ---------- Spotify auth (client credentials) ----------
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
        Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    }
  );

  token = res.data.access_token;
  tokenExpiresAt = now + res.data.expires_in * 1000 - 10_000; // small safety margin
  return token;
}

// ---------- Helpers ----------
function getUserId(req) {
  return (
    (req.user && (req.user._id || req.user.id)) ||
    req.headers['x-demo-user-id'] ||
    '000000000000000000000001'
  );
}

function toMinimalSongs(songs) {
  // UI expects: { name, artist, url }
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

// ---------- Routes ----------

// Simple sanity route so curl /music/test works
router.get('/test', (_req, res) => res.json({ ok: true, where: '/music/test' }));

// Keep this before param routes (harmless)
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

// Alias: GET /music/:mood  -> /music/by-mood/:mood (keeps older calls working)
router.get('/:mood', (req, res) => {
  const mood = String(req.params.mood || '').trim();
  if (!mood || mood === 'by-mood') return res.status(400).json({ error: 'Missing mood' });
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  return res.redirect(307, `/music/by-mood/${encodeURIComponent(mood)}${qs}`);
});

// Main: get playlist by mood (diagnostic-friendly)
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

    const queries = [ ...(moodMap[inputMood] || [inputMood]), inputMood, 'chill' ];

    // 1) Token
    let accessToken;
    try {
      accessToken = await getSpotifyToken();
      if (req.query.debug === '1') console.log('[DBG] got token?', !!accessToken);
    } catch (e) {
      console.error('[ERR] getSpotifyToken failed:', e.message, e.response?.data || '');
      if (req.query.debug === '1') {
        return res.status(502).json({ error: 'token_failed', message: e.message, data: e.response?.data || null });
      }
      throw e;
    }

    // 2) Playlists → songs
    let songs = [];
    for (const q of queries) {
      try {
        const s = await fetchSongsFromFirstGoodPlaylist(accessToken, q);
        if (s.length) { songs = s; break; }
      } catch (e) {
        console.warn('[WARN] playlist fetch failed for query:', q, e.message);
        if (req.query.debug === '1') console.log('[DBG] playlist error data:', e.response?.data || null);
      }
    }
    if (!songs.length) {
      if (req.query.debug === '1') {
        return res.status(404).json({ error: 'no_songs', message: 'No music found even after fallback' });
      }
      return res.status(404).json({ error: 'No music found even after fallback' });
    }

    // 3) Audio features once
    let featuresById = {};
    try {
      featuresById = await fetchAudioFeaturesById(accessToken, songs.map(s => s.id));
    } catch (e) {
      console.warn('[WARN] audio-features failed:', e.message);
      if (req.query.debug === '1') console.log('[DBG] features error data:', e.response?.data || null);
    }
    const nonEmpty = Object.values(featuresById)
      .filter(f => f && Object.keys(f).length)
      .length;
    console.log('[ML] features fetched:', nonEmpty, '/', songs.length);

    // 4) Optional ML re-ranking
    const useML = (req.query.ml || 'false') === 'true';
    console.log('[ML] useML?', useML, 'mood=', inputMood, 'ML_BASE=', ML_BASE);
    if (useML) {
      try {
        console.log('[ML] sending first 5 track IDs:', songs.slice(0,5).map(s => s.id));
        const payload = {
          mood: inputMood,
          tracks: songs.map(s => ({ id: s.id, features: featuresById[s.id] || {} })),
        };
        const mlResp = await axios.post(`${ML_BASE}/predict`, payload, { timeout: 15000 });
        const rankedIds = Array.isArray(mlResp.data)
          ? mlResp.data
          : (mlResp.data?.ids || (mlResp.data?.items || []).map(x => x.id) || []);
        console.log('[ML] rankedIds length:', Array.isArray(rankedIds) ? rankedIds.length : 0,
                    'sample:', Array.isArray(rankedIds) ? rankedIds.slice(0,5) : []);
        if (rankedIds.length) {
          const rank = new Map(rankedIds.map((id, i) => [id, i]));
          songs.sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9));
        }
      } catch (e) {
        console.warn('[ML] re-rank failed; using baseline:', e.message);
        if (req.query.debug === '1') console.log('[DBG] ml error data:', e.response?.data || null);
      }
    }

    const userId = getUserId(req);

    // 5) Persist (DB) + respond
    try {
      await upsertSongs(songs, featuresById);

      const songDocs = await Song.find(
        { spotifyId: { $in: songs.map(s => s.id) } },
        { _id: 1, spotifyId: 1 }
      );
      const idMap = new Map(songDocs.map(d => [d.spotifyId, d._id]));
      const tracks = songs.map(s => idMap.get(s.id)).filter(Boolean).map(_id => ({ songId: _id }));

      const minimal = toMinimalSongs(songs);

      await PlaylistRecord.findOneAndUpdate(
        { userId, mood: inputMood },
        { $set: { tracks, songs: minimal, date: new Date() } },
        { upsert: true, new: true }
      );

      await MoodEntry.create({ userId, mood: inputMood, songs: minimal, date: new Date() });

      if (req.query.debug === '1') return res.json(songs); // raw with ids for order diff
      return res.json(minimal);
    } catch (dbErr) {
      console.error('[ERR] DB write failed:', dbErr.message);
      if (req.query.debug === '1') {
        return res.status(500).json({ error: 'db_failed', message: dbErr.message });
      }
      // still return usable data to client
      return res.json(toMinimalSongs(songs));
    }
  } catch (error) {
    console.error('Error fetching music:', error.message);
    console.error('Full error:', error.response?.data || error);
    if (req.query.debug === '1') {
      return res.status(500).json({
        error: 'fetch_failed',
        message: error.message,
        data: error.response?.data || null
      });
    }
    return res.status(500).json({ error: 'Failed to fetch music' });
  }
});

module.exports = router;
