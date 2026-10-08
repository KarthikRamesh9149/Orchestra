# Socrates for VS Code

The VS Code companion for [Orchestra](https://github.com/KarthikRamesh9149/Orchestra).
Ask questions against the selected project's evidence and open the cited sources.

## Connect

1. Select **Socrates - Orchestra: Connect Project** from the Command Palette.
2. Use the project pairing flow on your authorised Orchestra server.
3. Select **Socrates - Orchestra: Ask** to submit a question.

The API and web addresses are machine-scoped VS Code settings. Confirm the
intended server before connecting; their initial defaults point to the hosted
beta. Project pairing credentials are stored in VS Code's secret storage, not
in workspace files. Use **Disconnect** to remove the local pairing.

This extension uses the server's editor-connector contract. Orchestra Desktop's
scoped MCP setup is a separate option using VS Code's built-in MCP client; this
extension does not replace that setup or bypass local runtime authentication.

## Build locally

```sh
npm ci
npm run build
npm run package
```

The packager requires Node.js 22 or newer. Local unsigned VSIX creation does not
publish to the Marketplace or certify every server/client combination.

First-party code is licensed under Apache-2.0. The included icon is the owner's
original Orchestra mark, with no redraw or change to its proportions.
