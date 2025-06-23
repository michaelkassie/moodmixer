const express = require('express');
const axios = require('axios');
const router = express.Router();
const MoodEntry = require('../models/MoodEntry'); // ✅ Import model

require('dotenv').config();

let token = null;
let tokenExpiresAt = 0;

// Get Spotify access token
async function getSpotifyToken() {
    const now = Date.now();
    if (token && now < tokenExpiresAt) return token;

    const res = await axios.post(
        'https://accounts.spotify.com/api/token',
        new URLSearchParams({ grant_type: 'client_credentials' }),
        {
            headers: {
                Authorization: `Basic ${Buffer.from(
                    `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
                ).toString('base64')}`,
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        }
    );

    token = res.data.access_token;
    tokenExpiresAt = now + res.data.expires_in * 1000;
    return token;
}

router.get('/:mood', async (req, res) => {
    try {
        const moodMap = {
            happy: ['feel good', 'good vibes', 'sunshine'],
            sad: ['emotional', 'sad songs', 'heartbreak'],
            angry: ['hard rock', 'aggressive rap', 'metal'],
            tired: ['sleep', 'calm', 'ambient'],
            relaxed: ['chill', 'lofi', 'soft beats'],
            energetic: ['hype', 'party hits', 'workout'],
            focused: ['focus', 'deep work', 'study beats']
        };

        const inputMood = req.params.mood.toLowerCase();
        const searchTerms = moodMap[inputMood] || [inputMood];
        searchTerms.push('chill'); // Always try chill last

        const accessToken = await getSpotifyToken();

        const fetchSongs = async (query) => {
            if (!query || query.trim() === '') return [];

            console.log(`Searching for: "${query}"`);

            const playlistRes = await axios.get('https://api.spotify.com/v1/search', {
                headers: { Authorization: `Bearer ${accessToken}` },
                params: { q: query, type: 'playlist', limit: 3 }
            });

            const playlists = playlistRes.data.playlists?.items || [];

            for (const playlist of playlists) {
                const playlistId = playlist?.id;
                const playlistName = playlist?.name;
                if (!playlistId) continue;

                const tracksRes = await axios.get(
                    `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
                    { headers: { Authorization: `Bearer ${accessToken}` } }
                );

                const songs = tracksRes.data.items
                    .filter(item => item.track && item.track.artists && item.track.external_urls)
                    .map(item => ({
                        name: item.track.name,
                        artist: item.track.artists[0].name,
                        url: item.track.external_urls.spotify,
                    }));

                console.log(`Playlist "${playlistName}" → ${songs.length} songs`);
                if (songs.length > 0) return songs;
            }

            return [];
        };

        let songs = [];
        for (const query of searchTerms) {
            songs = await fetchSongs(query);
            if (songs.length > 0) break;
        }

        if (songs.length === 0) {
            return res.status(404).json({ error: 'No music found even after fallback' });
        }
        // Save the mood + songs to DB
        await MoodEntry.create({
            mood: inputMood,
            songs
        });

        res.json(songs);
    } catch (error) {
        console.error('Error fetching music:', error.message);
        console.error('Full error:', error.response?.data || error);
        res.status(500).json({ error: 'Failed to fetch music' });
    }
});

//const MoodEntry = require('../models/MoodEntry'); // already at top

// GET /music/history → return all mood logs
router.get('/history/all', async (req, res) => {
    try {
        const history = await MoodEntry.find().sort({ date: -1 }); // newest first
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: 'Failed to load mood history' });
    }
});
const ClickedSong = require('../models/ClickedSong');

router.post('/track', async (req, res) => {
    try {
        const { name, artist, url, mood } = req.body;
        if (!name || !artist || !url) {
            return res.status(400).json({ error: 'Missing fields' });
        }

        await ClickedSong.create({ name, artist, url, mood });
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving clicked song:', err.message);
        res.status(500).json({ error: 'Failed to log song' });
    }
});


module.exports = router;
