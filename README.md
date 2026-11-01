# Cull Pix

A local desktop app for picking keepers from a folder of photos. It reviews files in place and never moves or deletes originals.

## Run it

Install [Node.js](https://nodejs.org/) 22 or newer, then in this directory:

```sh
npm ci
npm start
```

To make a double-clickable app on macOS, run `npm run package:mac`. The app appears in `dist/Cull Pix-darwin-arm64/` on Apple Silicon, or the equivalent `x64` folder on an Intel Mac. On Windows, run `npm run package:win` and open `Cull Pix.exe` in `dist/Cull Pix-win32-x64/`. The same source code and review workflow work on both systems.

## Review

1. Choose a folder. Cull Pix shows supported images directly inside that folder, sorted by filename.
2. Press **L** to keep an unmarked photo and advance, or to unmark an existing keeper: **Enter** confirms, and any other key cancels.
3. Press **H** to hide or show all unmarked photos. Use **↑ / K** for the previous photo and **↓ / J** for the next photo.
4. Click **Copy keepers** or press **C**, then paste the selected files into Finder or File Explorer.

Other shortcuts: **B** to hide or show the sidebar, **F** to hide or show the photo strip on the right, **⌘O / Ctrl+O** to open a folder. Hiding both panels gives the viewer the most space. Navigation stops at the first and last visible photo by default, including after marking a keeper. Enable **Loop navigation** under **View** in the sidebar to wrap around in either direction.

Supported extensions: JPG, JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, HEIF, TIFF, and TIF. HEIC/HEIF/TIFF preview support depends on codecs available on the computer. Unsupported previews display an explanatory message; the files can still be categorized.

Review decisions are stored in Cull Pix's local application data as `reviews.json`. The source photos are never modified. The clipboard contains file references to the keeper images, so the original files must remain in place until you paste them.

## Open images from Finder or Explorer

Opening an image with Cull Pix opens its containing folder and selects that image, including when Cull Pix is already running. An image opened this way is shown even if non-keepers were hidden.

On macOS, move the packaged **Cull Pix.app** into **Applications** and launch it once. Select a JPEG in Finder, choose **Get Info**, set **Open with** to **Cull Pix**, then click **Change All…** and confirm. Repeat for other file types you want to associate. If Cull Pix isn't listed, choose **Other…** and select it from Applications.

On Windows, keep the packaged app in a permanent folder. Right-click a JPEG, choose **Open with → Choose another app**, browse to **Cull Pix.exe**, and select **Always** (or **Always use this app**). Repeat for other desired file types. Windows file opening is supported in the source but has not been verified on a Windows machine.

## Zoom

Pinch on a MacBook trackpad, or hold **Ctrl** and scroll the mouse wheel on Windows, with the pointer over the photo. Zoom centers on the pointer and supports up to 8× the fitted view. When zoomed in, drag the photo or use two-finger scrolling to pan. Press **Z**, click **Fit**, or double-click to reset. Double-click a fitted photo to zoom in. Each new photo starts fitted to the viewer. A photo overview appears while zoomed in, with a rectangle showing your current view. Click or drag within the overview to pan.
