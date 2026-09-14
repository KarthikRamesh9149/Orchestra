# Private launch assets

`Orchestra-launch.mp4`: original 60-second, 1920×1080, 30 fps H.264 silent
product explainer. The examples are illustrative, not recordings of a live
answer or provider test. No customer content, third-party logos, stock media,
music or cloned voice is included. macOS system typography is rendered into
the frames; no font files are redistributed.

The narrative is scattered context → inspectable evidence → human decisions →
scoped agent context → delivery evidence. The closing card says private Mac beta,
not available for public download. Meridian's README informed the product-first
structure, not its wording, assets or design: https://github.com/Meridiona/meridian

Reproduce on macOS with:

```sh
swift scripts/desktop/render-launch.swift .desktop/launch-new
```

The renderer refuses to overwrite an existing video. AVFoundation metadata
confirmed 60.0 seconds, 1920×1080 and 30 fps. Opening, evidence and closing
frames were inspected for text hierarchy and clipping. The render is a private
deliverable, not permission to publish it or the repository. Sound design and
an actual recorded app walkthrough are not represented as completed.
