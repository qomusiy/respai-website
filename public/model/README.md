# RespAI model folder

Put the browser build of the RespAI cough model here. The website finds it on
its own and switches from the **Acoustic preview engine** to the real model.

## 1. Export from Edge Impulse

1. Open the RespAI project in [Edge Impulse Studio](https://studio.edgeimpulse.com).
2. Go to **Deployment**.
3. Search for **WebAssembly (browser)** and select it. Do not pick the Node.js one.
4. Keep the default optimisations (quantized int8 is fine) and click **Build**.
5. Unzip the download.

## 2. Copy two files into this folder

```
public/model/edge-impulse-standalone.js
public/model/edge-impulse-standalone.wasm
```

Keep these exact file names. You don't need the other files in the zip
(`run-impulse.js`, `index.html`, `server.js`, …).

## 3. Check it

Run `npm run dev`, open the site and look at the browser console. You should see:

```
[RespAI] Edge Impulse model loaded (…): 16000 Hz, 1000 ms window, labels [cough, noise], … ms/inference
```

The engine badge in the “Try it” section now says **Resp‑1 model · WebAssembly**. If loading
fails, the console prints a `[RespAI] … falling back to the acoustic preview engine`
warning with the reason, and the site keeps running on the preview engine.

## Requirements and notes

- The model must be an **audio** impulse and have a label that contains
  `cough`. Our project uses `cough` / `noise` at 16 kHz with 1 s windows, which works as is.
  Other sample rates and window lengths are read from the model and handled automatically.
- The site runs the model on a sliding window every 250 ms. The acoustic
  front end still measures each cough's duration, peak level, attack and spectral centroid.
- To retrain, export again and overwrite both files. Make a hard refresh
  (Ctrl+Shift+R) so the browser doesn't use its cached copy.
- To switch back to the preview engine, delete both files (keep this README).
