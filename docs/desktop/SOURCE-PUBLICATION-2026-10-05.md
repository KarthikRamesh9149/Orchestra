# Public source authorisation

On 5 October 2026, the owner explicitly requested making
`KarthikRamesh9149/Orchestra` public. This supersedes the earlier instruction to
keep this source repository private. It does not change the separate
`orchestrav2` repository or authorise installer/release publication.

The preparation reviewed main at `bad1b62777e81c731be394f115c818def6f58b37`,
its reachable history, current source and publication status:

- The repository's current source security scan passed.
- Gitleaks 8.30.1 scanned 71 content-bearing commits and about 13.17 MB of
  history. Its 12 flags were inspected: six deliberately synthetic credential
  fixtures/assertions, four generic-key test fixtures, a document fixture field,
  and runtime JWT signing code that references configuration rather than
  embedding a credential. No live credential was identified by these checks.
- No tracked environment-secret files, private keys, database dumps or customer
  exports were found by the historical filename review.
- GitHub reported no releases, no release tags and no uploaded Actions artifacts.
- First-party Apache-2.0 licensing and original asset ownership had already been
  approved. The existing third-party attribution review remains available.

These bounded checks do not establish that every possible secret or vulnerability
has been detected. Earlier build/runtime qualification remains attached to its
tested commit; this publication preparation changes documentation only.

The source is an open-source preview. Signed/notarized Mac distribution,
Windows, independent/two-computer qualification, public provider enrollment and
automatic updates retain their recorded status. Source visibility alone does not
complete those release gates. Historical reports describe their original private
candidate and are not rewritten as public-release certification.
