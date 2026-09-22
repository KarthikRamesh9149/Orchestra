# Narration and recording provenance

This packet records the 22 September 2026 narrated launch and walkthrough. It contains transcripts and provenance, not model weights, credentials or customer material.

## Voice and review scope

**AI-generated narration using Kokoro-82M's `am_michael` American-English male preset.** The owner accepted the style after a 20.925-second audition covering the opening and CSV/PDF distinction. It is not presented as a human recording or an imitation of a named person.

Both encoded films pass full video decoding. Contact-sheet review covered all 13 launch scenes and 29 walkthrough scenes, with final keyframes also inspected. The 19 launch and 57 walkthrough caption cues cover the transcripts. Cue boundaries are editorial, not independently forced-aligned. Full-length audio listening or perceptual caption-sync approval is not claimed.

Both films have verified playback in the private GitHub player: the launch advanced through 20 seconds and the walkthrough through 25.728 seconds, without player errors. Both reported 1920×1080 and the expected durations. Final README embed verification after the repository update remains a separate check.

## Final encoded films

| | Launch | Walkthrough |
| --- | --- | --- |
| File | [Orchestra-launch-narrated.mp4](../Orchestra-launch-narrated.mp4) | [Orchestra-walkthrough-narrated.mp4](../Orchestra-walkthrough-narrated.mp4) |
| Film duration | 60 seconds | 180 seconds |
| Size | 9,091,826 bytes | 9,408,511 bytes |
| Full frame decode | 1,800 frames passed | 5,400 frames passed |
| Final AAC loudness | -16.6 LUFS | -18.5 LUFS |
| Final AAC true peak | -0.7 dBTP | -2.5 dBTP |

The selected walkthrough uses the corrected safe AAC encode: 64 kb/s and a -2 dB gain adjustment from the master. Its video bitstream and narration pacing are unchanged. Earlier walkthrough encodes are not the selected artifact. Exact film hashes are in [recording-record.json](recording-record.json).

## Source narration

| | Launch | Walkthrough |
| --- | --- | --- |
| Transcript | [129 words](launch-transcript.txt) | [428 words](walkthrough-transcript.txt) |
| Complete narration master | 56.490 seconds | 166.490 seconds |
| Delivery master | 48 kHz mono, 24-bit PCM WAV | 48 kHz mono, 24-bit PCM WAV |
| Master integrated loudness | -16.56 LUFS | -16.46 LUFS |
| Master PCM peak | -1.493 dBFS | -1.487 dBFS |
| Full-scale PCM samples | 0 | 0 |

Synthesis is natively 24 kHz. Resampling provides video compatibility, not extra source fidelity. Two-pass master processing targeted -16 LUFS and -1.5 dBTP, using dynamic normalisation.

The walkthrough's 14 paragraph clips retain exact PCM samples from the normalised master and all speech. Their combined length is **161.830 seconds**; new chapter pauses place the final spoken material at 176.730 seconds, leaving a 3.270-second closing hold. There is no speech truncation or time-stretching.

Synthesiser text matches the supplied transcripts, apart from pronunciation aids: CSV, PDF, PRD, MCP and ID are spoken as letters; OpenAI as “Open A I”; VS Code as “V S Code”. This is a text-integrity check, not speech recognition or a listening judgement.

## Local generation and upstream sources

- Engine: `kokoro==0.9.4`; pronunciation library: `misaki==0.9.4`; Python 3.12.13; PyTorch 2.14.0. Local CPU inference, with native synthesis speed 1.25.
- Model: [`hexgrad/Kokoro-82M`](https://huggingface.co/hexgrad/Kokoro-82M/blob/f3ff3571791e39611d31c381e3a41a3af07b4987/README.md), revision `f3ff3571791e39611d31c381e3a41a3af07b4987`.
- Voice classification: [official voice list](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md). It does not establish a voice-specific human identity or age.
- The [Kokoro inference library](https://github.com/hexgrad/kokoro/blob/main/LICENSE) and model weights declare **Apache-2.0**. This records upstream licensing, not a separate legal determination for every use of generated audio. Other dependencies retain their own licences.
- Model and voice hashes were checked before rendering. Inference used cached local files with offline mode enabled. No narration API, provider key, purchase or script upload was used. Real OpenAI calls belong to the product demonstration, not voice generation.

The isolated media environment remained separate from product dependencies. This packet does not vendor model files or third-party code.

## Capture and provenance boundaries

Actual app captures use the fictional Northstar project. Editing may shorten waits; the films are neither continuous recordings nor performance benchmarks. The pending PDF request, unknown date/budget and blocked readiness are genuine. No complete approval, agent implementation or Postflight run is shown.

Preflight authority correction `c7c09e3` is verified and pushed. The recorded checks passed 2,073 backend tests, 76 focused tests and typechecking. Fresh native-app verification showed **zero accepted-context records** and **BLOCKED** readiness.

Selected audio, transcript and film hashes are verified, together with 38 retained original input assets in the ignored private production workspace. The launch audio master lacks a completed generation-run manifest, so its historical renderer attribution is not independently verified. The revised walkthrough has a complete run summary and a matching generating-script hash. Exact identities and these scope limits are retained in [recording-record.json](recording-record.json).
