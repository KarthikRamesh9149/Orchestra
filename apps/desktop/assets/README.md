# Orchestra brand asset

The owner supplied this white Orchestra mark on black on 16 September 2026 and
requested it for the desktop app and repository README. Preserve its geometry,
colour and background. No AI redraw or invented vector source was used.

`orchestra-logo.png` is a PNG conversion of the supplied 728 × 718 JPEG.
`Orchestra.icns` contains the standard Mac icon resolutions. Its square canvas
adds five black pixels above and below the original image before resizing;
the mark is not stretched or cropped. The largest 1024-pixel representation is
upscaled from the supplied raster, not a claimed native-resolution original.

Regenerate on macOS with `node apps/desktop/scripts/build-icon.mjs`.
The package script embeds the ICNS as the application bundle icon. Existing
installed/running copies must be replaced/restarted to display a new bundle icon.
