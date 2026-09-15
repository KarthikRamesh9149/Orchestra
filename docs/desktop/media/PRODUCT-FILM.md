# Product film and preflight demo

Original, silent 60-second 1920×1080 H.264 edit, 30fps. Created with macOS
AppKit/AVFoundation from the approved Orchestra logo and actual CUA screenshots.
No third-party music, stock footage, generated interface, or bundled fonts.

## Story and evidence

| Time | Scene | Evidence boundary |
| --- | --- | --- |
| 0–6s | Fast teams, fragmented context | Product problem framing |
| 6–13s | PRD, request, agent context | Labelled illustrative Northstar scenario |
| 13–21s | Ask the project | Actual document-scoped composer, cropped to the relevant control |
| 21–29s | Check the evidence | Actual response, explicitly evidence-only; no AI key in this profile |
| 29–38s | Open the source | Actual uploaded PRD viewer, including its partial-processing label |
| 38–48s | Preflight exposes a blocker | Actual blocked preflight; no successful agent run implied |
| 48–60s | Orchestra positioning | Exact approved tagline and private-beta scope |

Captures use fictional data, as described in [EVIDENCE-DEMO.md](EVIDENCE-DEMO.md).
The edit includes typography reveals, staggered illustrative panels, easing,
camera movement, transitions and restrained brand framing. It is not continuous
screen recording or a latency test. UI pixels are cropped/scaled, not rewritten.

The second feature GIF is a 72-frame, approximately 12-second detail walkthrough
of the actual blocked Preflight. It moves from the overall state to missing
requirements and then the exact-pack handoff controls. It does not demonstrate
an agent successfully retrieving or executing that pack.

## Reproducible rendering and verification

```sh
swift scripts/desktop/render-product-film.swift .desktop/demo-content apps/desktop/assets/orchestra-logo.png .desktop/product-film-new
swift scripts/desktop/render-preflight-demo.swift .desktop/demo-content/preflight-blocker.png .desktop/preflight-demo-new
swift scripts/desktop/verify-readme-media.swift docs/desktop/media
```

Output directories must be fresh; the renderers refuse to overwrite media.
The verifier loads both encoded MP4s, checks duration/dimensions and decodes five
frames from each. It decodes all four evidence-GIF frames and all 72 preflight-GIF
frames, checking aggregate timing. GIF centisecond quantization gives approximately
12.24 seconds for the nominal six-frame-per-second preflight sequence.

Reviewed scene stills caught and corrected header/title crowding, card label
spacing and the closing brand alignment before this candidate was uploaded.
The previous illustrative `Orchestra-launch.mp4` remains historical and is not the
README's primary film.
