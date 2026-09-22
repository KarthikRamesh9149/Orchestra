# Orchestra narrated films: reproduction record

The upload files `Orchestra-launch-web.mp4` and `Orchestra-walkthrough-web-safe.mp4` are preserved in this repository as [Orchestra-launch-narrated.mp4](../Orchestra-launch-narrated.mp4) and [Orchestra-walkthrough-narrated.mp4](../Orchestra-walkthrough-narrated.mp4). Their bytes and SHA-256 values match `media-manifest.json` and `verification.json`; only the filenames differ. The earlier walkthrough web encode is superseded.

The manifest, portable timelines and SRT captions contain no personal absolute paths. Original capture pixels, logo, narration WAVs and high-quality masters are retained privately and are not bundled here. Relative `assets/` paths describe the layout needed to reproduce the edit; input hashes are recorded in the manifest. The audio and scene timing are specified in the timelines.

Compile `scripts/desktop/render-narrated-launch.swift` on macOS using Swift and the macOS SDK, then render each timeline into a fresh directory:

```sh
renderer launch.timeline.json launch-master
renderer walkthrough.timeline.json walkthrough-master
```

Use FFmpeg H.264 two-pass encoding, preset `slow`, `yuv420p`, AAC mono at 48 kHz and `+faststart`. Launch uses 1100 kbps video and 64 kbps audio. Walkthrough uses 350 kbps video, 64 kbps audio and `volume=-2dB` on the master audio. Do not change narration speed, remove speech or resynthesise it. For the final walkthrough, only audio gain/encoding was corrected after the initial web encode; the verified video stream was copied unchanged.

After encoding, verify duration, dimensions, frame rate, byte size below 9,500,000, full-file decode and readable keyframes. Numeric loudness/peak results and review limitations are in `verification.json`. The master files are not upload-size constrained.
