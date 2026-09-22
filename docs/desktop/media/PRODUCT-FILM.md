# Orchestra product films

The **60-second launch film** and **180-second walkthrough** show how Orchestra connects product evidence, review and agent context.

**Status, 22 September 2026:** both films are rendered and pass full video decoding. Scene contact sheets and final keyframes have been inspected. The selected voice style was accepted after a 21-second audition, and both films have verified playback in the private GitHub player.

[Watch the launch film](https://github.com/user-attachments/assets/ec16c0f7-5fae-4b9b-ba15-6ce23fe48e7d) · [Watch the walkthrough](https://github.com/user-attachments/assets/51f3404e-a8e9-4263-9f8a-2cc03149f166)

## What you are watching

The films use actual desktop-app captures from **Northstar**, a fictional launch project, with the approved Orchestra banner and original logo. Socrates and Deep Research use real OpenAI-generated answers. The edit combines source captures, readable detail views, typography and chapter pauses; it is not a continuous screen recording or a latency benchmark.

The story turns on a useful distinction:

- The PRD documents CSV export with `item_id`, `title`, `owner` and `status`.
- PDF export is a request, not a recorded approval.
- The available evidence does not establish a launch date or budget.
- The project has no recorded human-approved requirements. A source or saved research report is not accepted truth.

UI captures are cropped and scaled for legibility, not rewritten to invent successful actions. The closing line is **Product Brain for High Speed Teams**.

## The launch film

The introduction moves from fragmented product context to a source-backed question, an inspectable answer and a deliberate review process. It closes with the value of scoped agent context.

Narration describes review, Product Brain, Preflight and Postflight capabilities. It does **not** show a completed approval or Postflight run. Direct Product Brain and Live Doc views are not part of the capture.

[Launch transcript](narrated-2026-09-22/launch-transcript.txt)

## The walkthrough

| Chapter | What the film shows |
| --- | --- |
| Start with evidence | The original PRD in Memory and its CSV fields. |
| Ask Socrates | A real generated answer and its source citation. |
| Explore with Deep Research | The saved generated report, source links and missing date/budget evidence. |
| Review a proposed change | The review overview, without treating PDF export as approved. |
| Inspect Preflight | A real **BLOCKED** pack, missing tests and **zero accepted-context records**. |
| Prepare the exact-pack handoff | Project/pack identity and available handoff controls, without overriding readiness blockers. |

The blocked readiness state is real. The corrected Preflight view was verified in the rebuilt native app: source and research evidence remain separate from human-approved context. No completed approval, agent implementation or Postflight run is represented.

[Walkthrough transcript](narrated-2026-09-22/walkthrough-transcript.txt)

## Narration and editing

Narration is **AI-generated using Kokoro-82M's `am_michael` American-English male preset**, not a human recording. The 129-word launch master runs for 56.490 seconds. The 428-word walkthrough master runs for 166.490 seconds; its intact paragraph clips are placed with chapter pauses in the 180-second edit. No speech is truncated or time-stretched.

The films contain 19 and 57 caption cues respectively, covering their transcripts. Cue timing is editorial, informed by measured audio segments and model duration estimates; it is not independently forced-aligned word timing. Full-length audio listening and perceptual caption-sync approval are not claimed.

## Verification

All 13 launch scenes and 29 walkthrough scenes were inspected through contact sheets, together with final keyframes. Full decoding passed for **1,800 launch frames** and **5,400 walkthrough frames**. Both private GitHub players reported 1920×1080 and the expected 60/180-second durations. Playback advanced through 20 seconds for the launch and 25.728 seconds for the walkthrough, with no player errors. These browser checks are distinct from a full-length listening review.

After commit `e70596b` was pushed, both embeds were also played directly in the repository README. Launch playback advanced to 18.801 seconds and walkthrough playback to 13.209 seconds, with no media errors. Both were paused after verification.

[Audio and film provenance](narrated-2026-09-22/PROVENANCE.md) · [Exact file identities and verification record](narrated-2026-09-22/recording-record.json)

The repository remains private. These films do not certify release readiness or authorise public distribution.

## Earlier films

`Orchestra-launch.mp4` was an illustrative silent explainer. `Orchestra-product-film.mp4`, the focused evidence walkthrough and the Preflight GIF used real source-retrieval captures, including evidence-only answers and a blocked Preflight; they did not demonstrate generated AI answers or a completed agent run. `Orchestra-narrated-overview-preview.mp4` was an earlier voice-over candidate built around that footage.

These remain historical previews, not the new real-OpenAI demonstrations. See [the original evidence notes](EVIDENCE-DEMO.md) and [the earlier production record](WALKTHROUGH-PRODUCTION.md).
