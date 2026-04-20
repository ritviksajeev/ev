# evzero watchparty — extension

Chrome MV3 extension that syncs `<video>` playback on YouTube, Netflix, and Twitch via the [watchparty server](../server).

## Load as unpacked

1. Run the server locally (`cd ../server && npm run dev`) or tick "Use hosted server" in the popup after deploying to Railway.
2. Chrome → `chrome://extensions` → enable **Developer mode** → **Load unpacked** → pick this folder.
3. Pin the extension. Open a tab on YouTube / Netflix / Twitch, open the popup, create or join a room.

## Files

- `manifest.json` — MV3 config, host permissions for the three sites + server
- `background.js` — service worker, owns the WebSocket, relays events
- `content.js` — finds `<video>`, hooks play/pause/seek/rate, applies remote events with a ~600ms echo-suppression window
- `popup.html/css/js` — room create/join UI, peer list, server toggle

## Notes

- Twitch live streams ignore seek (unseekable) but play/pause/rate still sync.
- Netflix uses HTML5 video under DRM — same event hooks work, no need to touch MSE internals.
- YouTube reuses the same `<video>` across SPA navigations; a MutationObserver re-attaches if the element is swapped.
