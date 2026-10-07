# Packaged AI qualification, 8 October 2026

## Scope and method

This qualification concerns Orchestra Desktop on one Apple Silicon Mac, not the hosted Orchestra service. Public source visibility is authorised; publishing installers, signing/notarisation, Windows, independent installation and two-computer qualification remain separate gates.

Runtime candidate: `e1866033e0db6163e1c26503a11d2728ef31af4e`. The candidate contains the startup CSP correction, immediate-new-chat draft correction, compatible runtime dependency repairs and Deep Research v5 source-identity contract. The reviewed Mammoth CLI override is pinned to Mammoth 1.13.0, its original direct argparse declaration and argparse 2.0.1. Other override forms and package identities are rejected. It does not relax the runtime graph, lockfile, staging containment or Prisma checks.

The reproducible harness is `scripts/desktop/qualify-packaged-ai.mjs`. It launches the actual packaged executable with an empty PATH and an isolated application profile. An explicitly supplied, previously authorised desktop OpenAI credential is decrypted only in native main and saved as an encrypted AI-only copy. This is not a fresh-user credential-import test. No hosted credentials, customer records or plaintext keys are exported into the evidence or repository.

The fixture corpus contains 24 actual three-page PDFs and one DOCX. Source bytes pass through native selection/upload, durable parsing jobs, chunking and real OpenAI embeddings. SQL is used only to verify persisted source hashes, current parse/version identity, vectors and jobs, not to seed this corpus. A separate scale harness uses SQL-seeded synthetic lexical records; that result must not be presented as 1,000 fully ingested/vector-indexed files.

The seven answer checks cover exact CSV fields, a pending-versus-approved scope conflict, imported prompt injection, missing launch/budget facts, named and unnamed meaning-based retrieval, and multi-page completeness. They validate streaming, model provenance and citation targets against current stored chunks. Deep Research must complete all requested topics and save generated context without elevating it into accepted truth. A rendered citation is also followed into the source viewer; parsed source facts and the target document identity must agree.

Rendered verification uses the actual composer and checks visible first answer text. Restart verification repeats 20 populated process-cold launches, without flushing OS disk caches. It verifies source hashes, vector fingerprints, archive state, saved answers/citations, research and an unsent draft without new model requests. Route/input/layout measurements are single-machine empirical samples, not fleet performance percentiles.

## Static candidate gates

- Desktop backend suite: 2,097 passed; 13 optional database tests skipped.
- Frontend suite: 295 passed. Clean tracked-source typecheck and frontend production build passed.
- Packaging suite: 113 passed, including red-to-green scoped override checks. Independent read-only review found no blocking issue in that packaging change.
- Backend and desktop typechecks/builds, VS Code build, import/inventory checks and local secret scan passed.
- Backend and desktop dependency audits report zero vulnerabilities at this verification point.
- The unrestricted upstream command still reports its 28 documented failures against intentionally excluded hosted deployment evidence. These were not hidden or relabelled as desktop passes.

Frontend and VS Code build-tool trees still report seven and six alerts respectively. Compatible updates were applied, but a major framework/tool migration was not forced into this qualification. The [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) reports no patched release at the time of this check. This is an outstanding tooling risk, not a claim that all repository security gates are green. The exact packaged dependency/notice inventory is checked separately.

## Runtime result

The fresh exact-candidate run passed. It processed all 25 physical files, including all 72 PDF pages and the DOCX marker, through the real parser/worker/indexing pipeline. Original file hashes and all expected parsed facts matched. All 25 chunks had actual 1,536-dimensional OpenAI vectors; embedding identity was persisted. All 84 migrations completed, and no durable job remained failed or pending at the final persistence checkpoint.

Seven bridge answers and one actual composer answer used configured `gpt-5.4-mini`, with `degraded=false`. They preserved exact fields, distinguished pending requests from recorded approval, resisted the imported instruction, stated unknown date/budget values and cited current original chunks. The unnamed security question retrieved and cited the original CSV specification. No additional model requests occurred across the 20 populated restarts. The native request counter recorded 37 external-AI requests across the complete fresh journey, within the isolated 120-request ceiling.

The first research sample exposed a prose-attribution error despite valid reference IDs: a vendor-note statement was described as coming from the pending request. The v5 canonical prompt now binds reference IDs to explicit source identities and separately constrains attribution and recommendations. Three prompt regressions first failed, and 98 focused tests passed after correction, including the actual service-generation boundary. The fresh real-model report was then reviewed: its relevant findings use the correct specification/request references, retain date/budget uncertainty and no longer make the observed vendor-note attribution error. This is observed improvement, not a guarantee that a probabilistic model can never misattribute a claim.

### Recorded samples

| Measurement | Result | Meaning |
| --- | --- | --- |
| Bridge answer first text | 661–1,492 ms | Seven actual streamed OpenAI requests; not population percentiles |
| Bridge answer completion | 1,385–1,937 ms | Same seven requests, including persistence |
| Composer answer first visible-text frame | 2,461 ms | One rendered UI journey; pre-paint frame-readiness proxy |
| Composer answer completion | 2,820 ms | Final rendered, persisted and cited answer |
| Deep Research completion | 5,117 ms | Completed real structured generation; no web search/fallback |
| Populated process-cold launch p95 | 1,749 ms | 20 actual Electron/PostgreSQL process launches; disk cache not flushed |
| Warm route readiness p95 | 68 ms | 60 Memory/Chat transitions; enabled/visible controls plus next frame |
| Input-handler → next-frame p95 | 13.8 ms | 30 samples; excludes dispatch delay and physical paint |
| Observed layout shift | 0 | This controlled journey, not fleet Core Web Vitals certification |

Restart checks preserved exact vector fingerprints, current versions/parse revisions, archive state, answer text and citation payloads, research results, and the unsent draft. Page and console error collections were empty. Screenshots were inspected without redesigning the UI.

A supplemental run followed the actual rendered citation into the correct source document and verified all four field names, tenant isolation/audit logging, membership/permission and acceptance criteria in the parsed viewer. It reused the unchanged runtime's validated AI answers, made no additional generation requests and repeated 20 process-cold launches. Its cold/route/input frame-readiness p95 values were 1,757/69/13.7 ms, with zero observed layout shift. These are two series on the same machine, not independent-machine results.

The internal ZIP was extracted into a new directory. A non-link-following comparison matched all 19,906 entries, including exact file hashes, link targets and executable flags. The extracted app then launched with an empty PATH and restored AI configuration, the cited conversation and the draft without requesting generation. This was an archive round-trip check, not an independent clean-machine installation or signed-distribution pass.

### Separate scale benchmark

The final candidate's compiled backend and bundled PostgreSQL were exercised against 1,000 SQL-seeded synthetic documents and 10,000 current lexical chunks over 20 cycles. Eight quality cases passed, covering sparse old/middle evidence, multi-document coverage, current versions, stale parses, archived sources and foreign-tenant exclusion. Native startup p95 was 841.5 ms; total cold/warm request p95 was 91.6/71.6 ms; instrumented cold/warm retrieval p95 was 64/59 ms.

This scale result used the local developer Node driver and the packaged backend/native database. It was not 1,000 physical-file uploads, a 1,000-document vector-indexing benchmark, a rendered 1,000-document workspace, or a real-AI large-corpus accuracy certification.

## Remaining boundaries

The requested bounded Mac/OpenAI package qualification is evidenced. It is not a zero-bug certificate, proof of zero future hallucinations, or public installer approval. The documented tooling alerts and agreed independent-installation/provider/hardware/distribution deferrals remain separate. Hosted production and `orchestrav2` were not changed. Raw reports and screenshots are retained locally, without credential/profile exports into this public repository.
