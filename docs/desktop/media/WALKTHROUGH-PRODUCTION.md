# Narrated product walkthrough

Status: in production, not a completed all-features video. The existing silent
film is retained until a reviewed replacement exists.

## Available preview

`Orchestra-narrated-overview-preview.mp4` is a 60-second 1920×1080, 30fps
candidate, using the existing original motion edit with local synthetic male
narration (`am_michael`) and selectable English sentence captions. No visuals
have been fabricated to imply a successful AI or agent run. Narration fits each
existing scene without truncation or audio time-stretching. Source audio is
24kHz, delivered as 48kHz AAC for video compatibility; upsampling does not add
source fidelity. Loudness processing targets -16 LUFS and -1.5dB true peak.

The actual generated speech totals 53.875 seconds with pauses across the
60-second edit. Subtitle sentence timing is proportional within measured audio
segments, not word-level forced alignment. A complete perceptual listening and
caption-sync review remains required before treating this candidate as final.
The README's existing primary video has not been replaced by this preview.

## Direction

- Product: Orchestra. Exact closing line: **Product Brain for High Speed Teams**.
- Two deliverables: 60-second introduction and 3–5-minute real-product walkthrough.
- Warm, conversational adult male synthetic narrator; no imitation of a named
  person. Target approximately 140–155 spoken words per minute. Give important
  actions breathing room rather than time-stretching speech to fit the edit.
- Retain actual UI styling. Use restrained cuts, short dissolves, chapter markers,
  readable detail crops and captions. Do not overlay fake controls or results.
- Record one fictional Northstar project throughout. No customer data or secrets.
- Retain source recordings. Identify shortened waits; this is not a latency test.
- Narration is AI-generated and must be disclosed in the media description.
- No paid account, API usage, purchased music or public publication authorised by
  this media task. Local Kokoro is an audition option, not ElevenLabs audio.

## Capture and narration plan

| Section | What the viewer should actually see | Narration intent | Current evidence |
| --- | --- | --- | --- |
| The problem | Original brand introduction | A fast team needs one agreed version of its product | Existing original film |
| Bring evidence in | File selection, processing completion, document open | Start from source material, not another unsupported summary | Existing PRD is partially processed; complete successful import still needed |
| Ask and verify | Real question, response streaming, citation opened | Ask about scope and check the exact source | Evidence-only answer available; AI synthesis not configured in current profile |
| Keep work intact | Switch chat, return, preserved draft/history | A conversation stays with the project | Earlier evidence exists; record current interaction |
| Review a change | Populated Inbox, source, proposed wording and impact | A request is not automatically an approved requirement | Current Inbox empty; approval capture missing |
| Accept explicitly | Authorised approval, updated Product Brain/Live Doc | Human decision changes current truth | No current demonstration footage |
| Follow delivery | Trace and receipt with real linked evidence | Separate approved scope from implementation evidence | No agent run in current project |
| Prepare the agent | Build Preflight, inspect pack, retrieve exact ID in client | Give the agent the correct context | Actual blocked Preflight exists; successful handoff still needs capture |
| Review the result | Real Postflight for that same pack | Review changes, tests and assumptions | No current recorded agent run |
| Supporting workflows | Timeline, brief, settings and research | See history, health and explicitly available sources | Timeline captured; empty weekly brief saved; connectors not active |
| Close | Original logo and exact tagline | Product Brain for High Speed Teams | Approved assets available |

## Voice audition

The isolated `.desktop/narration-venv` uses `kokoro==0.9.4`, `soundfile` and
`imageio-ffmpeg`, without changing product dependencies. Model source:
https://huggingface.co/hexgrad/Kokoro-82M (Apache-2.0). Voice candidate:
`am_michael`, generation speed 0.94, paragraph pauses. A generated sample does
not establish final perceptual quality; pronunciation and timing must be reviewed.

ElevenLabs was signed out on 16 September 2026. Do not use unapproved paid credits
or claim local output came from ElevenLabs. No provider account was created.

## Final checks

1. Every narrated action has corresponding current real footage.
2. Successful AI, approval and agent actions are not represented by mock results.
3. Caption timing follows the final voice track; no truncated lines.
4. No exposed credentials, private customer content or misleading performance cuts.
5. Voice has no clipping, missing words or conspicuous mispronunciation.
6. Inspect beginning, each chapter boundary and ending, then watch the full cut.
7. Check actual private GitHub playback before replacing the README media.
