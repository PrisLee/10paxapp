// Only the GitHub Pages mirror needs this. The Worker serves the app and the API
// from one origin, so there it finds /api by itself.
//
// After `npm run deploy`, put the Worker's URL here and push:
//
//   window.PAX_API = "https://tenpax.<your-subdomain>.workers.dev/api";
//
// Leave it blank and the mirror falls back to links and copy-paste codes.

window.PAX_API = "";
