# RespAI — website

Marketing site and live demo for **RespAI**, the smart cough detector with an air-quality monitor by team **Laputa**.

It is a **static site**: no backend and no paid server. Everything, including cough detection, runs in the visitor's browser.

## Run locally

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

Build a production copy:

```bash
npm run build      # outputs dist/
npm run preview    # serves dist/ at http://localhost:4173
```

> The microphone only works on `https://` or `http://localhost`. On a phone over your Wi‑Fi (`http://192.168…`) the sample sounds still work, but the mic is blocked by the browser. The deployed site is on https, so the mic works there.

## Deploy for free

### Vercel
1. Push this folder to a GitHub repository.
2. On vercel.com, choose **Add New → Project** and import the repository.
3. Vercel detects **Vite** automatically: build command `npm run build`, output directory `dist`. Click **Deploy**.

### Render
1. Push this folder to a GitHub repository.
2. On render.com, choose **New → Static Site** and pick the repository. `render.yaml` sets the build for you; if asked, use:
   - Build command: `npm ci && npm run build`
   - Publish directory: `dist`

## What runs where

| Feature | How it works without a backend |
| --- | --- |
| Cough detection ("Try it") | In the browser: microphone → spectrogram → small neural network. Audio never leaves the device. |
| Air-quality panel | Shows a realistic **simulated** feed by default. Optionally reads your device's Firebase node directly (below). |
| Pilot-request form | Copies the message and opens Telegram (@MUKHAMMAD_VMD). |

## Use your trained Edge Impulse model (recommended)

The built-in detector is a lightweight in-browser model. Your trained Edge Impulse model can replace it:

1. Edge Impulse Studio → your project → **Deployment** → **WebAssembly (browser)** → **Build**.
2. Unzip and copy `edge-impulse-standalone.js` and `edge-impulse-standalone.wasm` into `public/model/`.
3. Rebuild and redeploy. The badge in "Try it" changes to **Resp‑1 model · WebAssembly**.

Details: `public/model/README.md`.

## Optional: live readings from your device (free)

If the ESP32 writes its readings to Firebase Realtime Database, the site can read them directly. Set these environment variables in Vercel or Render (or in a local `.env` file), then rebuild:

```
VITE_FIREBASE_DB_URL=https://<project>-default-rtdb.<region>.firebasedatabase.app
VITE_FIREBASE_PATH=devices/respai-01/latest
```

That node must allow public **read** in your database rules (for example `".read": true` on that path only). Accepted keys: `temp|tempC|temperature`, `hum|humidity`, `mq6|mq6_raw|gas`, `coughs|count`. The panel switches to **Live device feed** while data arrives.

## Project structure

```
src/
  App.tsx              page layout + one shared WebGL canvas
  components/          page sections (Hero, ModelSection, Playground, DeviceSection, Air, …)
  three/               3D device, OLED screen, AI orb, scenes
  lib/audio/           cough engine: mic capture, DSP, detector + neural net, Edge Impulse adapter, test sounds
  lib/telemetry.ts     air-quality feed (simulation / Firebase)
public/
  images/              device photos
  fonts/               lettering for the 3D device
  model/               drop the Edge Impulse WebAssembly files here
```

> RespAI is a research prototype, not a medical device.
