import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

// Use Vercel env var in prod, fallback to localhost for local dev
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:5000';
const api = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
});

function App() {
  const [mood, setMood] = useState('');
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [view, setView] = useState('main');

  const presetMoods = ['Happy', 'Sad', 'Angry', 'Relaxed', 'Tired', 'Focused'];

  const fetchSongs = async (moodToSearch) => {
    if (!moodToSearch) return;
    setLoading(true);
    setError('');
    setSongs([]);
    setView('main');
    try {
      const res = await api.get(`/music/${moodToSearch.toLowerCase()}`);
      setSongs(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load songs. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const fetchHistory = async () => {
    setLoading(true);
    setError('');
    setSongs([]);
    setView('history');
    try {
      const res = await api.get('/music/history/all');
      setHistory(res.data);
    } catch (err) {
      console.error(err);
      setError('Failed to load mood history.');
    } finally {
      setLoading(false);
    }
  };

  const handleSongClick = async (song) => {
    try {
      await api.post('/music/track', {
        name: song.name,
        artist: song.artist,
        url: song.url,
        mood: mood || 'unknown',
      });
    } catch (err) {
      console.error('Failed to log clicked song:', err.message);
    }
  };

  return (
    <div className="App">
      <h1>MoodMixer 🎧</h1>

      <div className="preset-moods">
        {presetMoods.map((preset) => (
          <button key={preset} onClick={() => fetchSongs(preset)}>
            {preset}
          </button>
        ))}
      </div>

      <div className="manual-mood">
        <input
          type="text"
          placeholder="Or type a mood (e.g. chill)"
          value={mood}
          onChange={(e) => setMood(e.target.value)}
        />
        <button onClick={() => fetchSongs(mood)}>Get Music</button>
        <button onClick={fetchHistory}>View Mood History</button>
      </div>

      {loading && <p>Loading...</p>}
      {error && <p className="error">{error}</p>}

      {view === 'main' && songs.length > 0 && (
        <ul className="song-list">
          {songs.map((song, index) => (
            <li key={index}>
              <a
                href={song.url}
                target="_blank"
                rel="noreferrer"
                onClick={() => handleSongClick(song)}
              >
                {song.name} — {song.artist}
              </a>
            </li>
          ))}
        </ul>
      )}

      {view === 'history' && history.length > 0 && (
        <div className="history-view">
          <h2>Past Mood Searches</h2>
          {history.map((entry, i) => (
            <div key={i} className="history-entry">
              <h3>
                {entry.mood} — {new Date(entry.date).toLocaleString()}
              </h3>
              <ul>
                {entry.songs.map((song, j) => (
                  <li key={j}>
                    <a href={song.url} target="_blank" rel="noreferrer">
                      {song.name} — {song.artist}
                    </a>
                  </li>
                ))}
              </ul>
              <hr />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
