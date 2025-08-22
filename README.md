# MoodMixer

MoodMixer is a full-stack web application that recommends songs based on mood. The backend uses Node.js and Express to query the Spotify API and store mood history in MongoDB, while the frontend is built with React.

## Project structure

- `backend`: Express API server that fetches music from Spotify and persists data to MongoDB.
- `frontend`: React application for entering moods and displaying song suggestions.

## Getting started

### Prerequisites

- Node.js 18+
- npm

### Environment variables

Create a `.env` file inside `backend` with:

```
MONGODB_URI=<your mongodb connection string>
SPOTIFY_CLIENT_ID=<spotify client id>
SPOTIFY_CLIENT_SECRET=<spotify client secret>
FRONTEND_URL=http://localhost:3000
PORT=5000
```

### Installation

Install dependencies for both services:

```
cd backend
npm install

cd ../frontend
npm install
```

### Running

Start the backend server:

```
cd backend
npm start
```

Start the frontend development server:

```
cd frontend
npm start
```

The frontend runs on `http://localhost:3000` and communicates with the backend at `http://localhost:5000`.

## License

Distributed under the ISC License.

