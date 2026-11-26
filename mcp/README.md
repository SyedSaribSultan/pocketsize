# Pocketsize MCP server

Lets Claude Code and Claude Desktop compress your images in bulk, on your own computer, with Pocketsize's own engine.

- It is a local MCP server (stdio). Claude starts it as a child process.
- It runs the same `web/worker.js` and the same Squoosh WASM codecs as the web app.
- **Your files never leave your computer.** Nothing is uploaded, no network call is made, there is no hosted service. This is how Pocketsize's "no server" rule holds for Claude too.
- It works in Claude Code and Claude Desktop. It cannot work on claude.ai in a browser or on a phone, because those cannot start a program on your computer.

## What it does

For each picture it tries every format the destination allows (JPEG, palette PNG, lossless PNG, WebP, lossless WebP, AVIF), searches each one for the lowest quality that still scores at or above the target (SSIMULACRA 2), and keeps the smallest file that passes. A picture that cannot be made smaller is left alone and reported. Animated GIFs are left exactly as they are.

## Install

Needs Node 20 or newer.

1. Install the dependencies once:

   ```
   cd <path to pocketsize>/mcp
   npm install
   ```

2. Add it to Claude Code:

   ```
   claude mcp add pocketsize --scope user -- node <absolute path>/mcp/server.mjs
   ```

3. Or add it to Claude Desktop, in `claude_desktop_config.json` (Settings, Developer, Edit Config), then restart Claude Desktop:

   ```json
   {
     "mcpServers": {
       "pocketsize": {
         "command": "node",
         "args": ["<absolute path>/mcp/server.mjs"]
       }
     }
   }
   ```

   On Windows, write the path with forward slashes or doubled backslashes.

## Tools

### `compress`

Compresses files and folders and writes the results.

- `paths`: files and/or folders (absolute paths). `recursive`: include subfolders. `glob`: for example `*.png`.
- `destination`: `web` (default), `documents`, `email`, `chat`, `social`, `thumbnail`, `original`. Same presets as the app.
- `maxWidth`, `maxHeight`: shrink to fit. Never enlarges.
- `quality`: minimum visual match, 50 to 99. `format`: force one format. `lossless`: keep every pixel. `maxSizeKB`: aim under a size.
- Output: next to the originals with a suffix (`suffix`, default `-min`), or into `outputDir` (subfolders kept). Originals are never overwritten unless `overwrite: true`, and then only when the new file has the same extension.
- Returns a table per file (before, after, format, quality, score, saved bytes, where it was written) and totals.

### `inspect`

Shows what `compress` would do and writes nothing. By default it reads only file headers (size, pixels, resize, quality target, formats that compete). With `analyze: true` it runs the full search in memory and reports the exact format, quality and size it would produce.

### `presets`

Lists the destinations, the quality each targets, the size limit, and the formats each may write.

## Limits

- **500 files per call.** A larger set is refused with nothing changed. Call again with `start: 0`, then `start: 500`, and so on, or narrow with a subfolder or `glob`.
- Pictures over 100 megapixels are refused, as in the app. A single picture that takes over 5 minutes is stopped and reported.
- Supported inputs: JPEG, PNG, WebP, GIF, AVIF, BMP. Anything else, or any unreadable file, is skipped and listed in the result.
- Files already ending in the suffix are skipped on folder scans, so a second run does not compress the first run's output.
- Work runs on a pool of threads, one per CPU core.

## How it relates to the web app

- `web/worker.js` runs unmodified inside a Node worker thread (`lib/engine-worker.mjs`), with a small stand-in for the browser pieces it uses (`lib/canvas.mjs`, `lib/decode.mjs`). The browser app is untouched.
- Decoding: Squoosh decoders from the pinned `@jsquash` packages for PNG, JPEG, WebP and AVIF; `omggif` for GIF; a small reader for BMP. JPEG EXIF rotation is applied, as the browser does.
- Encoding and scoring are the app's own: the vendored mozjpeg, oxipng, libwebp and libaom builds, and `web/ss2.js`.
- Known differences from Chrome: embedded colour profiles are not converted (pixels are taken as sRGB; the output carries no profile either way), and resizing uses an area average rather than Chrome's filter. On the test fixtures the chosen format and quality match Chrome in 13 of 15 cases; the two differences are a picture with soft transparent edges, where the two canvases round semi-transparent pixels slightly differently.

## Tests

```
npm test                  # starts the real server and compresses the fixtures
node test/parity.mjs      # optional: compares every choice with real Chrome (needs Chrome and puppeteer-core)
```
