# PersonaAI

PersonaAI is a local-first UX research tool that lets you generate reader personas, chat with them, and run article feedback simulations from one UI.

This repository is designed for OSS use:

- no database
- no login
- no cloud backend required
- `npm run dev` starts both the web UI and local API

## Quick Start

### Requirements

- Node.js 20+

### Install

```bash
npm install
```

### Run

```bash
npm run dev
```

Open `http://localhost:5173`, then go to the Settings tab and paste your OpenAI API key.

## How It Works

- Frontend: React + Vite
- Local API: Node.js + Express
- Storage: `/.personaai/workspace.json`
- AI: OpenAI API
- Persona avatars: DiceBear Notionists API

The app runs locally, with external requests only for OpenAI API calls and persona avatar images served by DiceBear.

## References

This project is an independent local-first implementation for persona generation and article feedback simulation.

- Inspired by the DeepPersona research project: https://github.com/thzva/Deeppersona
- DeepPersona dataset license information: https://huggingface.co/datasets/THzva/deeppersona_dataset
- Persona avatar illustrations: https://www.dicebear.com/styles/notionists/

## What Gets Stored Locally

The app creates `/.personaai/workspace.json` automatically and stores:

- project settings
- personas
- chat sessions
- simulations
- feedback summaries

The OpenAI API key is stored in the browser `localStorage` and sent only to the local API server as `X-OpenAI-Api-Key`.

## Available Scripts

```bash
npm run dev
npm run build
npm run preview
npm run start
```

- `npm run dev`: starts Vite and the local API together
- `npm run build`: builds the frontend
- `npm run preview`: previews the built frontend
- `npm run start`: starts only the local API server

## Optional Environment Variables

The app works without a `.env` file. If you need custom ports or host binding, copy `.env.example`.

```bash
PORT=3001
HOST=127.0.0.1
```

## Reset Local Data

Delete `/.personaai` and restart the app.

```bash
rm -rf .personaai
```

## Project Structure

```text
PersonaAI/
├── src/         React UI
├── server/      Local API server
├── public/      Static assets
├── .personaai/  Local workspace data (auto-created)
└── package.json
```

## Common Issues

- The app opens but AI features fail
  - Add your OpenAI API key in the Settings tab
- Port `5173` or `3001` is already in use
  - Stop the conflicting process and rerun `npm run dev`
- Scraping a URL fails
  - Some sites block automated fetching

## License

MIT
