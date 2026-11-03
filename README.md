# Cull Pix

A local desktop app for picking keepers from a folder of photos. It reviews files in place and never moves or deletes originals.

## Run it

Install [Node.js](https://nodejs.org/) 22 or newer, then in this directory:

```sh
npm ci
npm start
```

Download an installer from [GitHub Releases](https://github.com/huynht-software/cull-pix/releases). The Windows installer installs for your user and creates a Start menu entry. To build it yourself, run `npm run release:win`; installer and update files appear in `release/`. On a Mac, `npm run release:mac` creates DMG and ZIP files for the current architecture.

Portable development builds remain available with `npm run package:win` or `npm run package:mac`, under `dist/`. Automatic updates require a release installer rather than a portable development build.

## Updates and releases

Installed Windows releases check the public GitHub release feed shortly after launch, once an hour, and when the computer comes back online. New stable releases download in the background and install when you quit, or via **App controls → Install update & restart**. **Check for updates** checks immediately. Offline checks fail quietly and retry later; editing and review continue to work offline. Download checksums are verified by electron-updater.

Pushing a `v<package version>` tag runs `.github/workflows/release.yml` to test and build Windows and macOS artifacts, then publish the installers and update metadata to GitHub Releases. Updates come from published, versioned releases, not arbitrary commits on the main branch.

macOS automatic updating requires an Apple-signed build. Configure GitHub Actions secrets `CSC_LINK` and `CSC_KEY_PASSWORD` for signing, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` for notarization. Unsigned macOS builds can be downloaded manually, but automatic updates are disabled. No GitHub access token is shipped in the app; the release feed is public.

## Review

Every group on the left (Workspace, View, Crop & Export, Keeper Selection, Quick Keys, and App controls) can be collapsed by clicking its heading. Expanded/collapsed states are remembered between sessions.

1. Choose a folder. Cull Pix shows supported images directly inside that folder, sorted by filename.
2. Press **L** to keep an unmarked photo and advance, or to unmark an existing keeper: **Enter** confirms, and any other key cancels.
3. Press **H** to hide or show all unmarked photos. Use **↑ / K** for the previous photo and **↓ / J** for the next photo.
4. Click **Copy keepers** or press **C**, then paste the selected files into Finder or File Explorer.

Other shortcuts: **B** to hide or show the sidebar, **F** to hide or show the photo strip on the right, **⌘O / Ctrl+O** to open a folder. Hiding both panels gives the viewer the most space. Navigation stops at the first and last visible photo by default, including after marking a keeper. Enable **Loop navigation** under **View** in the sidebar to wrap around in either direction.

Drag the inner edge of either sidebar to resize it. Expand **Options** at the top of the right photo strip to display **1, 2, 3, or 4 columns**, choose a sort order, or enable **Show filenames**. Options expand inline and start collapsed. Panel widths, columns, sorting, and filename visibility are remembered between sessions. The resize edges also support Left/Right arrow keys, Home, and End when focused.

Sort by **Name (A–Z or Z–A)** or **Taken (oldest or newest first)**. Capture-date sorting reads the photo's EXIF `DateTimeOriginal` field, including timezone offsets and subseconds when present. Photos without a readable capture date appear last, ordered by name. Reading dates does not block photo review, and dates are cached in `.cull-pix-cache/capture-dates-v1.json` and refreshed when source files change. Filesystem creation and modification times are not substituted for the capture date.

Selecting or navigating between photos highlights the selection without automatically scrolling or centering the photo strip. Scroll the strip manually to keep your preferred position.

After the current photo loads, the viewer prepares the next and previous visible photos in the background, decoding one at a time. This reduces the decoding delay when browsing sequentially. The adjacent-photo cache holds at most two images and 96 MiB of decoded pixels, discards distant photos, and cancels obsolete preloading when you navigate or switch folders. The viewer retains original resolution for ordinary formats; the first photo and jumps to uncached photos still require decoding.

Supported extensions: JPG, JPEG, PNG, WebP, GIF, BMP, AVIF, HEIC, HEIF, TIFF, and TIF. HEIC/HEIF/TIFF preview support depends on codecs available on the computer. Unsupported previews display an explanatory message; the files can still be categorized.

Review decisions are stored in Cull Pix's local application data as `reviews.json`. The source photos are never modified. The clipboard contains file references to the keeper images, so the original files must remain in place until you paste them.

Photo-strip thumbnails are saved as small JPEGs in `.cull-pix-cache` inside the photo folder you open. Cull Pix prepares the whole folder's thumbnails in the background, with visible photos taking priority and at most two thumbnails being processed at once. Switching folders stops the previous background pass after its current thumbnail. Reopening a folder reuses its cached thumbnails without decoding the originals again. Changed photos get fresh thumbnails. You can delete `.cull-pix-cache` at any time to reclaim space; Cull Pix recreates it as needed. Old thumbnails for changed or deleted photos remain until the cache is deleted. If the folder is read-only, thumbnails work for the current session without being saved. Formats without native thumbnail support fall back to the original preview.

## Open images from Finder or Explorer

Opening an image with Cull Pix opens its containing folder and selects that image, including when Cull Pix is already running. An image opened this way is shown even if non-keepers were hidden.

On macOS, move the packaged **Cull Pix.app** into **Applications** and launch it once. Select a JPEG in Finder, choose **Get Info**, set **Open with** to **Cull Pix**, then click **Change All…** and confirm. Repeat for other file types you want to associate. If Cull Pix isn't listed, choose **Other…** and select it from Applications.

On Windows, keep the packaged app in a permanent folder. Right-click a JPEG, choose **Open with → Choose another app**, browse to **Cull Pix.exe**, and select **Always** (or **Always use this app**). Repeat for other desired file types. Windows file opening is supported in the source but has not been verified on a Windows machine.

The Windows window has no menu bar. Open folders with the sidebar button or **Ctrl+O**. Expand **App controls** near the bottom of the left sidebar for fullscreen, reload, and quit; **F11**, **Ctrl+R**, and **Ctrl+Q** also work. Standard **Ctrl+C** and **Ctrl+A** text actions remain available.

## Crop layouts

Choose a **Crop layout** in the sidebar: **Original**, **Square (1:1)**, **Instagram portrait (4:5)**, **Instagram portrait (3:4)**, **Instagram landscape (1.91:1)**, or **Instagram Story / Reel (9:16)**. The selected layout applies to the viewer and photo strip for the whole folder.

Hold **Space** and drag the photo to adjust its crop. Use the **Zoom** slider, enter an exact percentage (including decimals), or click **− / +** for one-percentage-point adjustments. The **− / +** keyboard keys also work. In a crop layout, the mouse wheel zooms directly without Ctrl; coarse wheel steps are limited to about 5%. Pinching and **Ctrl+wheel** also work. Zooming out stops when the photo fills the frame, so no empty edges appear. **Reset this crop**, **Z**, or **Fill** resets the current photo to a centered crop. Each photo's zoom and position are remembered separately for each layout, and the folder's selected layout is restored when you return.

Enable **Add border** beside the crop controls to choose a border width and color. Borders default to white at 3%. Width is a percentage of the shorter outside edge for fixed crop layouts; the outside edge keeps the selected aspect ratio. In Original mode the border is added around the full image. Border settings are saved for each folder.

Use **Rotate left / Rotate right** for 90° turns or **Reset** to restore the photo's original orientation. Rotation is saved per photo, shown in the viewer and thumbnails, and applied to exports. Saved crop centers rotate with the image. Originals are never modified.

Click **Export image…** to save the selected image as **JPEG** or **PNG**, with its crop and border applied. Export decodes the original file at full resolution, preserves the native pixels within the crop, and adds border pixels around them. Zooming in exports the smaller area you selected without enlarging it. EXIF orientation is applied and normalized, and capture metadata is retained. HEIC/HEIF export requires a compatible native OS decoder; an unavailable codec produces an error rather than a reduced-resolution export. Animated inputs export their first frame.

The originals stay unchanged. **Copy keepers** still copies references to the originals; use **Export image…** for a rendered copy.

The last successful export folder is remembered across photos, folders, and app restarts. Cancelling or failing an export does not change it.

**Reset all settings** restores Original layout, fit zoom, no rotation, and the default disabled border. It clears all saved crop positions for the selected photo. The folder's layout and border are shared; other photos' saved crops, rotations, keeper decisions, and the remembered export folder are preserved.

## Zoom

Pinch on a MacBook trackpad, or hold **Ctrl** and scroll the mouse wheel on Windows, with the pointer over the photo. Zoom centers on the pointer and supports up to 8× the fitted view. When zoomed in, drag the photo or use two-finger scrolling to pan. Press **Z**, click **Fit**, or double-click to reset. Double-click a fitted photo to zoom in. Each new photo starts fitted to the viewer. A photo overview appears while zoomed in, with a rectangle showing your current view. Click or drag within the overview to pan.
