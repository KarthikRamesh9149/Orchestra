import * as vscode from "vscode";
import { Blob } from "node:buffer";
import { readFile } from "node:fs/promises";

const ACCESS_TOKEN_KEY = "orchestra.accessToken";
const REFRESH_TOKEN_KEY = "orchestra.refreshToken";
const CONNECTOR_TOKEN_KEY = "orchestra.vscodeConnectorToken";
const PROJECT_KEY = "orchestra.connectedProjectId";
const PROJECT_NAME_KEY = "orchestra.connectedProjectName";
const USER_EMAIL_KEY = "orchestra.userEmail";
const WEB_BASE_URL_KEY = "orchestra.webAppBaseUrl";
const OFFICIAL_API_BASE_URL = "https://beta.orchestraos.dev";
const OFFICIAL_WEB_BASE_URL = "https://beta.orchestraos.dev";

type ProjectSummary = {
  id: string;
  name: string;
  description?: string | null;
};

type Citation = {
  label?: string;
  source?: string;
  excerpt?: string;
  refId?: string;
  anchor?: string;
};

type OpenTarget = {
  targetType?: string;
  targetRef?: {
    documentId?: string;
    anchorId?: string;
    providerPermalink?: string;
    channelName?: string;
    sender?: string;
    sentAt?: string;
  };
};

type SocratesAnswer = {
  answer_md: string;
  confidence?: "high" | "medium" | "low";
  limitations?: string[];
  citations?: Citation[];
  open_targets?: OpenTarget[];
};

type DocumentUploadResult = {
  documentId?: string;
  documentVersionId?: string;
  id?: string;
  title?: string;
  status?: string;
  deduplicated?: boolean;
};

type DocumentStatus = {
  id?: string;
  title?: string;
  parseStatus?: string | null;
};

type ApiEnvelope<T> = {
  data: T;
  error?: {
    code?: string;
    message?: string;
  } | null;
};

type WebviewState = {
  apiBaseUrl: string;
  webBaseUrl: string;
  userEmail?: string;
  connectedProjectId?: string;
  connectedProjectName?: string;
  isConnected: boolean;
};

let statusBarItem: vscode.StatusBarItem | undefined;
let panelController: SocratesPanelController | undefined;

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = "orchestra.openSocrates";
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("orchestra.openSocrates", () => openSocrates(context)),
    vscode.commands.registerCommand("orchestra.connectProject", () => openSocrates(context, { focus: "login" })),
    vscode.commands.registerCommand("orchestra.askSocrates", () => openSocrates(context, { focus: "ask" })),
    vscode.commands.registerCommand("orchestra.disconnect", () => disconnect(context)),
    vscode.commands.registerCommand("orchestra.status", () => showStatus(context))
  );

  void updateStatusBar(context);
}

export function deactivate() {}

function openSocrates(context: vscode.ExtensionContext, options?: { focus?: "login" | "ask" }) {
  if (!panelController) {
    panelController = new SocratesPanelController(context, () => {
      panelController = undefined;
    });
  }
  panelController.reveal(options);
}

class SocratesPanelController {
  private readonly panel: vscode.WebviewPanel;

  constructor(
    private readonly context: vscode.ExtensionContext,
    onDispose: () => void
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "orchestraSocrates",
      "Socrates - Orchestra",
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: []
      }
    );
    this.panel.iconPath = new vscode.ThemeIcon("sparkle");
    this.panel.webview.html = renderWebviewHtml(this.panel.webview, this.getInitialState());
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this.context.subscriptions);
    this.panel.onDidDispose(onDispose, undefined, this.context.subscriptions);
  }

  reveal(options?: { focus?: "login" | "ask" }) {
    this.panel.reveal(vscode.ViewColumn.Beside);
    void this.postState(options);
  }

  private async handleMessage(message: { type?: string; payload?: unknown }) {
    switch (message.type) {
      case "ready":
        await this.postState();
        break;
      case "login":
        await this.login(parseObject(message.payload));
        break;
      case "refreshProjects":
        await this.refreshProjects();
        break;
      case "connectProject":
        await this.connectProject(parseObject(message.payload));
        break;
      case "ask":
        await this.ask(parseObject(message.payload));
        break;
      case "captureSelection":
        await this.captureSelection();
        break;
      case "captureIdeContext":
        await this.captureIdeContext();
        break;
      case "uploadDocument":
        await this.uploadDocument();
        break;
      case "disconnect":
        await disconnect(this.context, { quiet: true });
        await this.postState();
        this.post({ type: "notice", payload: { message: "Disconnected from Orchestra." } });
        break;
      case "signOut":
        await clearAuth(this.context);
        await clearConnection(this.context);
        await updateStatusBar(this.context);
        await this.postState();
        this.post({ type: "notice", payload: { message: "Signed out of Orchestra." } });
        break;
      case "openCitation":
        await this.openCitation(parseObject(message.payload));
        break;
      case "openWeb":
        await vscode.env.openExternal(vscode.Uri.parse(getWebBaseUrl(this.context)));
        break;
      default:
        break;
    }
  }

  private async login(payload: Record<string, unknown>) {
    const email = String(payload.email ?? "").trim();
    const password = String(payload.password ?? "");
    if (!email || !password) {
      this.post({ type: "error", payload: { message: "Enter your Orchestra email and password." } });
      return;
    }

    try {
      this.post({ type: "busy", payload: { message: "Signing in..." } });
      const response = await fetchJson<{
        accessToken: string;
        refreshToken: string;
        user: { email: string };
      }>(`${getApiBaseUrl()}/v1/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email, password })
      });

      await this.context.secrets.store(ACCESS_TOKEN_KEY, response.data.accessToken);
      await this.context.secrets.store(REFRESH_TOKEN_KEY, response.data.refreshToken);
      await this.context.globalState.update(USER_EMAIL_KEY, response.data.user.email);

      const projects = await this.listProjects(response.data.accessToken);
      await this.postState();
      this.post({ type: "projects", payload: { projects } });
      this.post({ type: "notice", payload: { message: "Signed in. Choose the project that has your uploaded docs." } });
    } catch (error) {
      this.post({ type: "error", payload: { message: friendlyErrorMessage(error, "Could not sign in.") } });
    } finally {
      this.post({ type: "idle" });
    }
  }

  private async refreshProjects() {
    try {
      const accessToken = await this.requireAccessToken();
      this.post({ type: "busy", payload: { message: "Loading projects..." } });
      const projects = await this.listProjects(accessToken);
      this.post({ type: "projects", payload: { projects } });
    } catch (error) {
      this.post({ type: "error", payload: { message: friendlyErrorMessage(error, "Could not load projects.") } });
    } finally {
      this.post({ type: "idle" });
    }
  }

  private async connectProject(payload: Record<string, unknown>) {
    const projectId = String(payload.projectId ?? "").trim();
    const projectName = String(payload.projectName ?? "Project").trim();
    if (!projectId) {
      this.post({ type: "error", payload: { message: "Choose a project before connecting Socrates." } });
      return;
    }

    try {
      const accessToken = await this.requireAccessToken();
      this.post({ type: "busy", payload: { message: "Connecting VS Code to project memory..." } });
      await revokeStoredConnectorToken(this.context);
      const pairing = await fetchJson<{ pairingCode: string }>(
        `${getApiBaseUrl()}/v1/projects/${encodeURIComponent(projectId)}/editor-connectors/vscode/pairings`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ label: "Socrates - Orchestra VS Code" })
        }
      );

      const exchanged = await fetchJson<{
        token: string;
        project: { id: string; name: string };
        webAppBaseUrl?: string;
      }>(`${getApiBaseUrl()}/v1/editor-connectors/vscode/exchange`, {
        method: "POST",
        body: JSON.stringify({
          pairingCode: pairing.data.pairingCode,
          extensionVersion: this.context.extension.packageJSON.version,
          deviceLabel: "Socrates - Orchestra"
        })
      });

      await this.context.secrets.store(CONNECTOR_TOKEN_KEY, exchanged.data.token);
      await this.context.globalState.update(PROJECT_KEY, exchanged.data.project.id);
      await this.context.globalState.update(PROJECT_NAME_KEY, exchanged.data.project.name || projectName);
      if (exchanged.data.webAppBaseUrl) {
        await this.context.globalState.update(WEB_BASE_URL_KEY, normalizeTrustedBaseUrl(exchanged.data.webAppBaseUrl, OFFICIAL_WEB_BASE_URL));
      }
      await updateStatusBar(this.context);
      await this.postState({ focus: "ask" });
      const projects = await this.listProjects(accessToken);
      this.post({ type: "projects", payload: { projects } });
      this.post({ type: "notice", payload: { message: `Connected to ${exchanged.data.project.name || projectName}.` } });
    } catch (error) {
      this.post({ type: "error", payload: { message: friendlyErrorMessage(error, "Could not connect this project.") } });
    } finally {
      this.post({ type: "idle" });
    }
  }

  private async ask(payload: Record<string, unknown>) {
    const question = String(payload.question ?? "").trim();
    if (!question) return;

    try {
      const token = await this.context.secrets.get(CONNECTOR_TOKEN_KEY);
      if (!token) {
        this.post({ type: "error", payload: { message: "Connect a project before asking Socrates." } });
        return;
      }

      this.post({ type: "busy", payload: { message: "Socrates is reading project memory..." } });
      const ideContext = typeof payload.ideContext === "string"
        ? payload.ideContext.trim().slice(0, 20000)
        : undefined;
      const response = await fetchJson<SocratesAnswer>(`${getApiBaseUrl()}/v1/editor-connectors/vscode/socrates/ask`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({ question, ideContext })
      });
      this.post({ type: "answer", payload: normalizeAnswer(response.data) });
    } catch (error) {
      if (isConnectorAuthError(error)) {
        await clearConnection(this.context);
        await updateStatusBar(this.context);
        await this.postState();
      }
      this.post({ type: "error", payload: { message: friendlyErrorMessage(error, "Could not ask Socrates.") } });
    } finally {
      this.post({ type: "idle" });
    }
  }

  private async captureSelection() {
    const selectedText = getSelectedText();
    if (!selectedText) {
      this.post({ type: "error", payload: { message: "Highlight text in the editor first, then add it to Socrates." } });
      return;
    }

    this.post({
      type: "context",
      payload: {
        ideContext: `Selected editor text:\n${selectedText}`,
        preview: selectedText.replace(/\s+/g, " ").trim().slice(0, 180),
        label: "Selected text",
        length: selectedText.length
      }
    });
  }

  private async captureIdeContext() {
    const context = buildIdeContext();
    if (!context.ideContext) {
      this.post({ type: "error", payload: { message: "Open a file in VS Code before adding IDE context." } });
      return;
    }

    this.post({
      type: "context",
      payload: {
        ideContext: context.ideContext,
        preview: context.preview,
        label: "IDE context",
        length: context.ideContext.length
      }
    });
  }

  private async uploadDocument() {
    const projectId = this.context.globalState.get<string>(PROJECT_KEY);
    if (!projectId) {
      this.post({ type: "error", payload: { message: "Connect a project before uploading documents." } });
      return;
    }

    try {
      const accessToken = await this.requireAccessToken();
      const selection = await vscode.window.showOpenDialog({
        title: "Upload to Orchestra Project Memory",
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        filters: {
          "Project memory documents": ["pdf", "docx"]
        }
      });
      const uri = selection?.[0];
      if (!uri) return;

      const fileName = uri.path.split(/[\\/]/).pop() ?? "document";
      const contentType = fileName.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      const buffer = await readFile(uri.fsPath);
      const form = new FormData();
      form.append("title", fileName.replace(/\.(pdf|docx)$/i, ""));
      form.append("kind", "reference");
      form.append("visibility", "internal");
      form.append("file", new Blob([buffer], { type: contentType }), fileName);

      this.post({ type: "busy", payload: { message: `Uploading ${fileName} to project memory...` } });
      const response = await fetchJson<DocumentUploadResult>(
        `${getApiBaseUrl()}/v1/projects/${encodeURIComponent(projectId)}/documents/upload`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
          body: form
        },
        { json: false }
      );

      const documentId = response.data.documentId ?? response.data.id;
      if (documentId) {
        this.post({
          type: "documentStatus",
          payload: {
            title: response.data.title ?? fileName,
            status: response.data.status ?? "pending",
            message: `${response.data.title ?? fileName} uploaded. Processing project memory...`
          }
        });
        const processed = await this.pollDocumentProcessing(projectId, documentId, accessToken, response.data.title ?? fileName);
        this.post({
          type: "documentStatus",
          payload: processed
        });
      }

      this.post({
        type: "notice",
        payload: {
          message: `${response.data.title ?? fileName} uploaded to shared Project Memory.`
        }
      });
    } catch (error) {
      this.post({ type: "error", payload: { message: friendlyErrorMessage(error, "Could not upload the document.") } });
    } finally {
      this.post({ type: "idle" });
    }
  }

  private async pollDocumentProcessing(projectId: string, documentId: string, accessToken: string, title: string) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await sleep(1000);
      const response = await fetchJson<DocumentStatus>(
        `${getApiBaseUrl()}/v1/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${accessToken}` }
        }
      );
      const status = response.data.parseStatus ?? "pending";
      if (status === "ready" || status === "partial") {
        return {
          title: response.data.title ?? title,
          status,
          message: `${response.data.title ?? title} is ${status}. Socrates can use it now.`
        };
      }
      if (status === "failed") {
        return {
          title: response.data.title ?? title,
          status,
          message: `${response.data.title ?? title} uploaded, but processing failed. Check the web app for details.`
        };
      }
    }

    return {
      title,
      status: "processing",
      message: `${title} is still processing. It will appear in shared Project Memory when ready.`
    };
  }

  private async openCitation(payload: Record<string, unknown>) {
    const documentId = String(payload.documentId ?? "").trim();
    const anchorId = String(payload.anchorId ?? "").trim();
    const providerPermalink = String(payload.providerPermalink ?? "").trim();
    if (providerPermalink.startsWith("https://")) {
      await vscode.env.openExternal(vscode.Uri.parse(providerPermalink));
      return;
    }
    if (!documentId) return;
    await vscode.env.openExternal(buildCitationUri(this.context, { documentId, anchorId }));
  }

  private async listProjects(accessToken: string) {
    const response = await fetchJson<ProjectSummary[]>(`${getApiBaseUrl()}/v1/projects`, {
      method: "GET",
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    return response.data;
  }

  private async requireAccessToken() {
    const accessToken = await this.context.secrets.get(ACCESS_TOKEN_KEY);
    if (!accessToken) {
      throw new OrchestraApiError("Sign in with your Orchestra beta account first.", 401, "auth_required");
    }
    return accessToken;
  }

  private getInitialState(): WebviewState {
    return {
      apiBaseUrl: getApiBaseUrl(),
      webBaseUrl: getWebBaseUrl(this.context),
      userEmail: this.context.globalState.get<string>(USER_EMAIL_KEY),
      connectedProjectId: this.context.globalState.get<string>(PROJECT_KEY),
      connectedProjectName: this.context.globalState.get<string>(PROJECT_NAME_KEY),
      isConnected: Boolean(this.context.globalState.get<string>(PROJECT_KEY))
    };
  }

  private async postState(options?: { focus?: "login" | "ask" }) {
    const token = await this.context.secrets.get(CONNECTOR_TOKEN_KEY);
    const state: WebviewState & { focus?: "login" | "ask" } = {
      apiBaseUrl: getApiBaseUrl(),
      webBaseUrl: getWebBaseUrl(this.context),
      userEmail: this.context.globalState.get<string>(USER_EMAIL_KEY),
      connectedProjectId: this.context.globalState.get<string>(PROJECT_KEY),
      connectedProjectName: this.context.globalState.get<string>(PROJECT_NAME_KEY),
      isConnected: Boolean(token),
      focus: options?.focus
    };
    this.post({ type: "state", payload: state });
  }

  private post(message: { type: string; payload?: unknown }) {
    void this.panel.webview.postMessage(message);
  }
}

async function disconnect(context: vscode.ExtensionContext, options?: { quiet?: boolean }) {
  const token = await context.secrets.get(CONNECTOR_TOKEN_KEY);
  if (token) {
    try {
      await fetchJson<{ revoked: number }>(`${getApiBaseUrl()}/v1/editor-connectors/vscode/revoke`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: JSON.stringify({})
      });
    } catch (error) {
      if (!isConnectorAuthError(error)) {
        const action = await vscode.window.showWarningMessage(
          `${friendlyErrorMessage(error, "Could not revoke the connector on Orchestra.")} Keep the connection and try again, or clear only the local token.`,
          "Clear local token",
          "Keep connected"
        );
        if (action !== "Clear local token") return;
      }
    }
  }

  await clearConnection(context);
  await updateStatusBar(context);
  if (!options?.quiet) {
    await vscode.window.showInformationMessage("Socrates - Orchestra disconnected from VS Code.");
  }
}

async function revokeStoredConnectorToken(context: vscode.ExtensionContext) {
  const token = await context.secrets.get(CONNECTOR_TOKEN_KEY);
  if (!token) return;

  try {
    await fetchJson<{ revoked: number }>(`${getApiBaseUrl()}/v1/editor-connectors/vscode/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({})
    });
  } catch (error) {
    if (!isConnectorAuthError(error)) {
      throw error;
    }
  }
}

async function showStatus(context: vscode.ExtensionContext) {
  const token = await context.secrets.get(CONNECTOR_TOKEN_KEY);
  const projectName = context.globalState.get<string>(PROJECT_NAME_KEY);
  const message = token && projectName
    ? `Socrates - Orchestra is connected to ${projectName}.`
    : "Socrates - Orchestra is not connected.";
  const action = await vscode.window.showInformationMessage(message, token ? "Open Socrates" : "Connect");
  if (action) openSocrates(context, { focus: token ? "ask" : "login" });
}

function getSelectedText() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.selection.isEmpty) return undefined;
  return editor.document.getText(editor.selection).slice(0, 12000);
}

function buildIdeContext() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return { ideContext: "", preview: "" };
  }

  const document = editor.document;
  const relativePath = toWorkspaceRelativePath(document.uri);
  const selectionText = !editor.selection.isEmpty ? document.getText(editor.selection).slice(0, 12000) : "";
  const visibleText = selectionText || getVisibleText(editor).slice(0, 12000) || document.getText().slice(0, 12000);
  const diagnostics = vscode.languages
    .getDiagnostics(document.uri)
    .slice(0, 12)
    .map(formatDiagnostic)
    .join("\n");
  const openTabs = getOpenTextTabs().slice(0, 20).join("\n");
  const workspaceFolders = (vscode.workspace.workspaceFolders ?? [])
    .map((folder) => `- ${folder.name}`)
    .join("\n");

  const parts = [
    `IDE context is temporary user-provided context from VS Code. It is not Project Memory and must not be persisted as evidence.`,
    `Active file: ${relativePath}`,
    `Language: ${document.languageId}`,
    workspaceFolders ? `Workspace folders:\n${workspaceFolders}` : "",
    openTabs ? `Open editor tabs:\n${openTabs}` : "",
    diagnostics ? `Diagnostics for active file:\n${diagnostics}` : "",
    visibleText ? `Active editor ${selectionText ? "selection" : "visible/current"} text:\n${visibleText}` : ""
  ].filter(Boolean);

  const ideContext = parts.join("\n\n").slice(0, 20000);
  return {
    ideContext,
    preview: `${relativePath}${diagnostics ? " with diagnostics" : ""}`.slice(0, 180)
  };
}

function getVisibleText(editor: vscode.TextEditor) {
  const document = editor.document;
  return editor.visibleRanges
    .slice(0, 3)
    .map((range) => document.getText(range))
    .filter(Boolean)
    .join("\n\n");
}

function getOpenTextTabs() {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs
      .map((tab) => {
        const input = tab.input;
        if (input instanceof vscode.TabInputText || input instanceof vscode.TabInputTextDiff) {
          const uri = input instanceof vscode.TabInputText ? input.uri : input.modified;
          return `- ${toWorkspaceRelativePath(uri)}`;
        }
        return undefined;
      })
      .filter((value): value is string => Boolean(value))
  );
}

function formatDiagnostic(diagnostic: vscode.Diagnostic) {
  const severity = {
    [vscode.DiagnosticSeverity.Error]: "error",
    [vscode.DiagnosticSeverity.Warning]: "warning",
    [vscode.DiagnosticSeverity.Information]: "info",
    [vscode.DiagnosticSeverity.Hint]: "hint"
  }[diagnostic.severity] ?? "diagnostic";
  const line = diagnostic.range.start.line + 1;
  const column = diagnostic.range.start.character + 1;
  return `- ${severity} ${line}:${column} ${diagnostic.message.slice(0, 240)}`;
}

function toWorkspaceRelativePath(uri: vscode.Uri) {
  if (uri.scheme === "file") {
    return vscode.workspace.asRelativePath(uri, false);
  }
  return uri.toString(true);
}

function getApiBaseUrl() {
  const configuration = vscode.workspace.getConfiguration("orchestra");
  const inspected = configuration.inspect<string>("apiBaseUrl");
  const configured = inspected?.globalValue ?? inspected?.defaultValue ?? OFFICIAL_API_BASE_URL;
  return normalizeTrustedBaseUrl(configured, OFFICIAL_API_BASE_URL);
}

function getWebBaseUrl(context: vscode.ExtensionContext) {
  const configuration = vscode.workspace.getConfiguration("orchestra");
  const inspected = configuration.inspect<string>("webBaseUrl");
  const configured = inspected?.globalValue ?? inspected?.defaultValue ?? context.globalState.get<string>(WEB_BASE_URL_KEY) ?? OFFICIAL_WEB_BASE_URL;
  return normalizeTrustedBaseUrl(configured, OFFICIAL_WEB_BASE_URL);
}

function normalizeTrustedBaseUrl(value: string, officialBaseUrl: string) {
  try {
    const parsed = new URL(value);
    const isOfficial = parsed.origin === officialBaseUrl;
    const isLoopback = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if ((!isOfficial && !isLoopback) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return officialBaseUrl;
    }
    return parsed.origin;
  } catch {
    return officialBaseUrl;
  }
}

function buildCitationUri(context: vscode.ExtensionContext, targetRef: { documentId?: string; anchorId?: string }) {
  const webBase = getWebBaseUrl(context);
  const fragment = targetRef.anchorId ? `#${encodeURIComponent(targetRef.anchorId)}` : "";
  return vscode.Uri.parse(`${webBase}/memory/docs/${encodeURIComponent(targetRef.documentId ?? "")}/view${fragment}`);
}

async function clearConnection(context: vscode.ExtensionContext) {
  await context.secrets.delete(CONNECTOR_TOKEN_KEY);
  await context.globalState.update(PROJECT_KEY, undefined);
  await context.globalState.update(PROJECT_NAME_KEY, undefined);
}

async function clearAuth(context: vscode.ExtensionContext) {
  await context.secrets.delete(ACCESS_TOKEN_KEY);
  await context.secrets.delete(REFRESH_TOKEN_KEY);
  await context.globalState.update(USER_EMAIL_KEY, undefined);
}

async function updateStatusBar(context: vscode.ExtensionContext) {
  if (!statusBarItem) return;
  const token = await context.secrets.get(CONNECTOR_TOKEN_KEY);
  if (!token) {
    statusBarItem.text = "$(sparkle) Socrates";
    statusBarItem.tooltip = "Socrates - Orchestra is not connected. Click to sign in.";
    statusBarItem.show();
    return;
  }

  const projectName = context.globalState.get<string>(PROJECT_NAME_KEY) ?? "Project Memory";
  statusBarItem.text = `$(sparkle) Socrates: ${projectName}`;
  statusBarItem.tooltip = "Ask Socrates about uploaded Orchestra project memory.";
  statusBarItem.show();
}

class OrchestraApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly code?: string
  ) {
    super(message);
  }
}

async function fetchJson<T>(url: string, init: RequestInit, options?: { json?: boolean }): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  if (options?.json !== false && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(url, {
    ...init,
    headers
  });
  const body = await response.json().catch(() => null) as ApiEnvelope<T> | null;
  if (!response.ok || body?.error) {
    throw new OrchestraApiError(
      body?.error?.message ?? `Orchestra request failed: ${response.status}`,
      response.status,
      body?.error?.code
    );
  }
  return body as ApiEnvelope<T>;
}

function isConnectorAuthError(error: unknown) {
  return error instanceof OrchestraApiError && [
    "vscode_token_denied",
    "vscode_token_expired",
    "vscode_token_required"
  ].includes(error.code ?? "");
}

function friendlyErrorMessage(error: unknown, fallback: string) {
  if (error instanceof OrchestraApiError) {
    switch (error.code) {
      case "auth_required":
        return "Sign in with your Orchestra beta account first.";
      case "auth_invalid_credentials":
        return "That email or password was not accepted.";
      case "vscode_pairing_invalid":
        return "The generated connector pairing code was not recognized. Try connecting again.";
      case "vscode_pairing_expired":
        return "The connector pairing code expired. Try connecting again.";
      case "vscode_token_expired":
        return "Your Orchestra VS Code connection has expired. Reconnect to the project.";
      case "vscode_token_denied":
      case "vscode_token_required":
        return "Your Orchestra VS Code connection was revoked or is no longer valid. Reconnect to the project.";
      case "feature_disabled_in_beta":
        return "That Orchestra feature is disabled in the beta.";
      default:
        return `${fallback} ${error.message}`;
    }
  }
  if (error instanceof TypeError) {
    return `${fallback} Check the Orchestra API URL and your network connection.`;
  }
  return fallback;
}

function parseObject(payload: unknown): Record<string, unknown> {
  return typeof payload === "object" && payload !== null ? payload as Record<string, unknown> : {};
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeAnswer(answer: SocratesAnswer) {
  return {
    answer_md: answer.answer_md,
    confidence: answer.confidence ?? "medium",
    limitations: answer.limitations ?? [],
    citations: answer.citations ?? [],
    open_targets: answer.open_targets ?? []
  };
}

function renderWebviewHtml(webview: vscode.Webview, state: WebviewState) {
  const nonce = getNonce();
  const stateJson = JSON.stringify(state).replace(/</g, "\\u003c");
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Socrates - Orchestra</title>
  <style nonce="${nonce}">
    :root {
      --bg: var(--vscode-sideBar-background, #181818);
      --panel: var(--vscode-editor-background, #1f1f1f);
      --panel-soft: var(--vscode-input-background, #242424);
      --text: var(--vscode-foreground, #d7d7d7);
      --muted: var(--vscode-descriptionForeground, #9a9a9a);
      --muted-soft: color-mix(in srgb, var(--muted) 62%, transparent);
      --border: var(--vscode-sideBar-border, rgba(255, 255, 255, 0.09));
      --accent: var(--vscode-focusBorder, #3794ff);
      --button: var(--vscode-button-background, #0e639c);
      --button-text: var(--vscode-button-foreground, #ffffff);
      --input: var(--vscode-input-background, #242424);
      --input-border: var(--vscode-input-border, rgba(255, 255, 255, 0.12));
      --chip: rgba(255, 255, 255, 0.055);
      --danger: var(--vscode-errorForeground, #f48771);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      color: var(--text);
      background: var(--bg);
      font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      -webkit-font-smoothing: antialiased;
    }
    button, input, textarea { font: inherit; }
    button { cursor: pointer; color: inherit; }
    .app {
      height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
      background: var(--bg);
      overflow: hidden;
    }
    .topbar {
      min-height: 38px;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 0 12px;
      border-bottom: 1px solid var(--border);
      background: var(--bg);
    }
    .tabs {
      display: flex;
      gap: 18px;
      min-width: 0;
      flex: 1;
    }
    .tab {
      position: relative;
      height: 38px;
      display: inline-flex;
      align-items: center;
      color: var(--muted);
      font-size: 12px;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .tab.active {
      color: var(--text);
    }
    .tab.active::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 1px;
      background: var(--accent);
    }
    .top-actions {
      display: flex;
      gap: 4px;
    }
    .icon-button {
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      font-size: 12px;
    }
    .icon-button:hover {
      background: var(--chip);
      color: var(--text);
    }
    .login {
      min-height: 0;
      overflow: auto;
      display: grid;
      align-content: center;
      padding: 24px;
    }
    .login-card {
      display: grid;
      gap: 12px;
      max-width: 360px;
      margin: 0 auto;
      width: 100%;
    }
    .login-title {
      margin: 0;
      color: var(--text);
      font-size: 18px;
      font-weight: 600;
    }
    .login-copy {
      margin: 0 0 6px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.5;
    }
    .shell {
      min-height: 0;
      display: grid;
      grid-template-rows: auto 1fr auto;
    }
    .projects {
      border-bottom: 1px solid var(--border);
      padding: 12px 12px 10px;
      background: var(--bg);
    }
    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .section-title {
      margin: 0;
      color: var(--muted);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }
    .project-list {
      display: grid;
      gap: 2px;
      max-height: 142px;
      overflow: auto;
    }
    .project-button {
      width: 100%;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--muted);
      padding: 7px 8px;
      text-align: left;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      align-items: center;
    }
    .project-button:hover {
      background: var(--chip);
      color: var(--text);
    }
    .project-button.active {
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      color: var(--text);
    }
    .project-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .project-state {
      color: var(--muted);
      font-size: 11px;
    }
    .chat {
      min-height: 0;
      overflow: auto;
      padding: 14px 14px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .toast {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-soft);
      color: var(--muted);
      padding: 9px 10px;
      font-size: 12px;
      line-height: 1.4;
    }
    .toast.error {
      color: var(--danger);
      border-color: color-mix(in srgb, var(--danger) 45%, transparent);
    }
    .empty-state {
      min-height: 42vh;
      flex: 1;
      display: grid;
      place-items: center;
      text-align: center;
      color: var(--muted);
      padding: 24px 8px;
    }
    .empty-inner {
      display: grid;
      justify-items: center;
      gap: 12px;
      max-width: 280px;
    }
    .socrates-mark {
      position: relative;
      width: 62px;
      height: 62px;
      border-radius: 999px;
      border: 8px dotted color-mix(in srgb, var(--muted) 60%, transparent);
      display: grid;
      place-items: center;
      opacity: 0.82;
    }
    .socrates-face {
      width: 30px;
      height: 30px;
      border-radius: 999px;
      background: var(--panel);
      border: 1px solid var(--border);
      position: relative;
    }
    .socrates-face::before,
    .socrates-face::after {
      content: "";
      position: absolute;
      top: 10px;
      width: 5px;
      height: 9px;
      border-radius: 999px;
      background: var(--text);
    }
    .socrates-face::before { left: 8px; }
    .socrates-face::after { right: 8px; }
    .empty-title {
      margin: 0;
      color: var(--text);
      font-size: 15px;
      line-height: 1;
      font-weight: 600;
    }
    .field {
      width: 100%;
      border: 1px solid var(--input-border);
      border-radius: 6px;
      background: var(--input);
      color: var(--text);
      padding: 9px 10px;
      outline: none;
    }
    .field:focus {
      border-color: var(--accent);
    }
    .primary {
      border: 0;
      border-radius: 6px;
      background: var(--button);
      color: var(--button-text);
      padding: 9px 12px;
      font-weight: 600;
    }
    .secondary {
      border: 1px solid var(--border);
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      padding: 7px 9px;
    }
    .secondary:hover { color: var(--text); background: var(--chip); }
    .messages {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .row { display: flex; }
    .row.user { justify-content: flex-end; }
    .assistant-wrap {
      max-width: 92%;
    }
    .bubble {
      max-width: 92%;
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 10px 12px;
      font-size: 13px;
      line-height: 1.55;
      word-break: break-word;
    }
    .row.user .bubble {
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      border-bottom-right-radius: 4px;
    }
    .row.assistant .bubble {
      color: var(--text);
      background: var(--panel-soft);
      border-bottom-left-radius: 4px;
    }
    .bubble p { margin: 0 0 9px; }
    .bubble p:last-child { margin-bottom: 0; }
    .bubble h3 {
      margin: 10px 0 6px;
      font-size: 13px;
      line-height: 1.35;
    }
    .bubble ul,
    .bubble ol {
      margin: 6px 0 9px;
      padding-left: 18px;
    }
    .bubble li { margin: 3px 0; }
    .context-note {
      margin-top: 7px;
      color: var(--muted);
      font-size: 11px;
    }
    .sources {
      margin-top: 9px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }
    .source-card {
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel-soft);
      padding: 8px;
      text-align: left;
      min-width: min(100%, 180px);
      max-width: 100%;
    }
    .source-title {
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 10px;
    }
    .source-excerpt {
      margin: 5px 0 0;
      color: var(--muted);
      font-size: 11px;
      line-height: 1.45;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .source-open {
      margin-top: 6px;
      padding: 0;
      border: 0;
      background: transparent;
      color: var(--accent);
      font-size: 10px;
      font-weight: 650;
    }
    .composer-wrap {
      border-top: 1px solid var(--border);
      background: var(--bg);
      padding: 12px;
    }
    .upload-status,
    .context-pill {
      border: 1px solid var(--border);
      border-radius: 9px;
      background: var(--chip);
      color: var(--muted);
      padding: 8px 10px;
      font-size: 11px;
      line-height: 1.35;
      margin-bottom: 8px;
    }
    .context-pill {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .context-pill span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .clear-context {
      border: 0;
      background: transparent;
      color: var(--muted);
      font-size: 11px;
    }
    .composer {
      position: relative;
      border: 1px solid var(--border);
      border-radius: 22px;
      background: var(--input);
      padding: 11px 48px 11px 46px;
    }
    textarea {
      display: block;
      width: 100%;
      min-height: 42px;
      max-height: 130px;
      resize: vertical;
      border: 0;
      outline: 0;
      background: transparent;
      color: var(--text);
      line-height: 1.5;
    }
    textarea::placeholder { color: var(--muted-soft); }
    .plus,
    .send {
      position: absolute;
      bottom: 10px;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: 999px;
      background: var(--chip);
      color: var(--text);
      font-size: 20px;
    }
    .plus { left: 8px; }
    .send { right: 8px; }
    .plus:hover,
    .send:hover { background: color-mix(in srgb, var(--accent) 24%, transparent); }
    .send:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
    .busy {
      min-height: 16px;
      margin: 6px 8px 0;
      color: var(--muted);
      font-size: 11px;
    }
    .action-menu {
      position: absolute;
      left: 6px;
      bottom: 48px;
      min-width: 210px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel);
      box-shadow: 0 12px 30px rgba(0, 0, 0, 0.28);
      padding: 6px;
      z-index: 5;
    }
    .action-item {
      width: 100%;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--text);
      display: block;
      padding: 8px 9px;
      text-align: left;
      font-size: 12px;
    }
    .action-item:hover { background: var(--chip); }
    .hint {
      color: var(--muted);
      font-size: 11px;
      line-height: 1.4;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="app">
    <header class="topbar">
      <div class="tabs" aria-label="Orchestra views">
        <div class="tab active">Socrates</div>
      </div>
      <div class="top-actions">
        <button id="refreshProjectsBtn" class="icon-button hidden" type="button" title="Refresh projects">R</button>
        <button id="disconnectBtn" class="icon-button hidden" type="button" title="Disconnect active project">X</button>
        <button id="signOutBtn" class="icon-button hidden" type="button" title="Sign out">Out</button>
      </div>
    </header>

    <section id="loginView" class="login">
      <form id="loginForm" class="login-card">
        <div class="socrates-mark"><div class="socrates-face"></div></div>
        <h1 class="login-title">Socrates</h1>
        <p class="login-copy">Sign in, choose a project, then chat with the same memory used by OrchestraOS.</p>
          <input id="email" class="field" type="email" autocomplete="username" placeholder="Email" required>
          <input id="password" class="field" type="password" autocomplete="current-password" placeholder="Password" required>
          <button class="primary" type="submit">Sign in</button>
      </form>
    </section>

    <section id="shell" class="shell hidden">
      <aside class="projects">
        <div class="section-head">
          <p class="section-title">Projects</p>
          <span id="statusText" class="hint">offline</span>
        </div>
        <div id="projectList" class="project-list"></div>
      </aside>

      <main class="chat" id="chatScroll">
        <div id="toast" class="toast hidden"></div>
        <div id="messages" class="messages"></div>
        <div id="emptyChat" class="empty-state">
          <div class="empty-inner">
            <div class="socrates-mark"><div class="socrates-face"></div></div>
            <p class="empty-title">Ask Socrates</p>
            <p id="projectCaption" class="hint">Select a project to start chatting.</p>
          </div>
        </div>
      </main>

      <footer class="composer-wrap">
        <div id="uploadStatus" class="upload-status hidden"></div>
        <div id="contextPill" class="context-pill hidden">
          <span id="contextPreview"></span>
          <button id="clearContextBtn" class="clear-context" type="button">clear</button>
        </div>
        <form id="askForm" class="composer">
          <button id="plusBtn" class="plus" type="button" aria-label="Open Socrates actions">+</button>
          <div id="actionMenu" class="action-menu hidden">
            <button id="uploadActionBtn" class="action-item" type="button">Upload PDF/DOCX</button>
            <button id="ideContextActionBtn" class="action-item" type="button">Add IDE context</button>
            <button id="selectionActionBtn" class="action-item" type="button">Add selected text</button>
          </div>
          <textarea id="question" rows="2" placeholder="Do anything"></textarea>
          <button id="sendBtn" class="send" type="submit" aria-label="Ask Socrates">&uarr;</button>
        </form>
        <p class="busy" id="busyText"></p>
      </footer>
    </section>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const initialState = ${stateJson};
    const state = {
      ...initialState,
      projects: [],
      messages: [],
      busy: false,
      ideContext: "",
      contextPreview: "",
      contextLabel: "",
      uploadStatus: null
    };

    const els = {
      statusText: document.getElementById("statusText"),
      toast: document.getElementById("toast"),
      loginView: document.getElementById("loginView"),
      shell: document.getElementById("shell"),
      loginForm: document.getElementById("loginForm"),
      email: document.getElementById("email"),
      password: document.getElementById("password"),
      projectList: document.getElementById("projectList"),
      refreshProjectsBtn: document.getElementById("refreshProjectsBtn"),
      askForm: document.getElementById("askForm"),
      question: document.getElementById("question"),
      sendBtn: document.getElementById("sendBtn"),
      plusBtn: document.getElementById("plusBtn"),
      actionMenu: document.getElementById("actionMenu"),
      uploadActionBtn: document.getElementById("uploadActionBtn"),
      ideContextActionBtn: document.getElementById("ideContextActionBtn"),
      selectionActionBtn: document.getElementById("selectionActionBtn"),
      messages: document.getElementById("messages"),
      emptyChat: document.getElementById("emptyChat"),
      projectCaption: document.getElementById("projectCaption"),
      chatScroll: document.getElementById("chatScroll"),
      busyText: document.getElementById("busyText"),
      disconnectBtn: document.getElementById("disconnectBtn"),
      signOutBtn: document.getElementById("signOutBtn"),
      uploadStatus: document.getElementById("uploadStatus"),
      contextPill: document.getElementById("contextPill"),
      contextPreview: document.getElementById("contextPreview"),
      clearContextBtn: document.getElementById("clearContextBtn")
    };

    function post(type, payload) {
      vscode.postMessage({ type, payload });
    }

    function escapeHtml(value) {
      return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[char]));
    }

    function formatMarkdown(value) {
      const blocks = String(value || "").trim().split(/\\n{2,}/).filter(Boolean);
      if (!blocks.length) return "";
      return blocks.map((block) => {
        const lines = block.split(/\\n/).map((line) => line.trim()).filter(Boolean);
        if (lines.length === 1 && /^#{1,3}\\s+/.test(lines[0])) {
          return "<h3>" + formatInline(lines[0].replace(/^#{1,3}\\s+/, "")) + "</h3>";
        }
        if (lines.every((line) => /^[-*]\\s+/.test(line))) {
          return "<ul>" + lines.map((line) => "<li>" + formatInline(line.replace(/^[-*]\\s+/, "")) + "</li>").join("") + "</ul>";
        }
        if (lines.every((line) => /^\\d+\\.\\s+/.test(line))) {
          return "<ol>" + lines.map((line) => "<li>" + formatInline(line.replace(/^\\d+\\.\\s+/, "")) + "</li>").join("") + "</ol>";
        }
        return "<p>" + lines.map(formatInline).join("<br>") + "</p>";
      }).join("");
    }

    function formatInline(value) {
      return escapeHtml(value).replace(/\\*\\*([^*]+)\\*\\*/g, "<strong>$1</strong>");
    }

    function showToast(message, kind = "notice") {
      if (!message) {
        els.toast.classList.add("hidden");
        return;
      }
      els.toast.textContent = message;
      els.toast.classList.toggle("error", kind === "error");
      els.toast.classList.remove("hidden");
    }

    function setBusy(message) {
      state.busy = Boolean(message);
      els.busyText.textContent = message || "";
      els.sendBtn.disabled = state.busy || !state.isConnected;
    }

    function render() {
      els.statusText.textContent = state.isConnected ? "online" : state.userEmail ? "signed in" : "offline";
      els.disconnectBtn.classList.toggle("hidden", !state.isConnected);
      els.signOutBtn.classList.toggle("hidden", !state.userEmail);
      els.refreshProjectsBtn.classList.toggle("hidden", !state.userEmail);
      els.projectCaption.textContent = state.connectedProjectName
        ? "Ask about " + state.connectedProjectName + " memory. Uploaded docs and synced Slack stay shared with the web app."
        : "Select a project to start chatting.";

      els.loginView.classList.toggle("hidden", Boolean(state.userEmail));
      els.shell.classList.toggle("hidden", !state.userEmail);
      els.emptyChat.classList.toggle("hidden", state.messages.length > 0);
      els.messages.classList.toggle("hidden", state.messages.length === 0);
      els.sendBtn.disabled = state.busy || !state.isConnected;
      els.question.disabled = !state.isConnected;
      els.plusBtn.disabled = !state.isConnected;
      els.question.placeholder = state.isConnected ? "Do anything" : "Select a project first";

      if (state.userEmail) els.email.value = state.userEmail;
      renderProjects();
      renderMessages();
      renderContext();
      renderUploadStatus();
    }

    function renderProjects() {
      if (!state.userEmail) return;
      if (!state.projects.length) {
        els.projectList.innerHTML = '<p class="hint">No projects loaded. Refresh after signing in.</p>';
        return;
      }
      els.projectList.innerHTML = state.projects.map(function (project) {
        const active = state.connectedProjectId === project.id && state.isConnected;
        return '<button class="project-button ' + (active ? 'active' : '') + '" type="button" data-connect="' + escapeHtml(project.id) + '" data-name="' + escapeHtml(project.name) + '">' +
          '<span class="project-name">' + escapeHtml(project.name) + '</span>' +
          '<span class="project-state">' + (active ? 'Active' : 'Open') + '</span>' +
        '</button>';
      }).join("");
      document.querySelectorAll("[data-connect]").forEach((button) => {
        button.addEventListener("click", () => {
          if (button.getAttribute("data-connect") === state.connectedProjectId && state.isConnected) return;
          state.messages = [];
          state.ideContext = "";
          state.contextPreview = "";
          state.contextLabel = "";
          state.uploadStatus = null;
          render();
          post("connectProject", {
            projectId: button.getAttribute("data-connect"),
            projectName: button.getAttribute("data-name")
          });
        });
      });
    }

    function renderMessages() {
      els.messages.innerHTML = state.messages.map((message, index) => {
        if (message.role === "user") {
          return '<div class="row user"><div class="bubble">' +
            formatMarkdown(message.content) +
            (message.contextPreview ? '<div class="context-note">Context: ' + escapeHtml(message.contextPreview) + '</div>' : '') +
          '</div></div>';
        }
        if (message.role === "system") {
          return '<div class="toast">' + escapeHtml(message.content) + '</div>';
        }
        const citations = (message.citations || []).map((citation, citationIndex) => {
          const target = (message.open_targets || [])[citationIndex] || (message.open_targets || [0])[0];
          const ref = target && target.targetRef ? target.targetRef : {};
          const isSlack = Boolean(ref.providerPermalink || ref.channelName || String(citation.source || citation.label || "").toLowerCase().includes("slack"));
          const title = (isSlack ? "SLACK " : "DOC ") + (citation.source || citation.label || citation.refId || "source");
          const canOpen = ref.documentId || ref.providerPermalink;
          return '<div class="source-card">' +
            '<div class="source-title">' + escapeHtml(title) + '</div>' +
            (citation.excerpt ? '<p class="source-excerpt">' + escapeHtml(citation.excerpt) + '</p>' : '') +
            (canOpen ? '<button class="source-open" type="button" data-source-open="1" data-doc="' + escapeHtml(ref.documentId || '') + '" data-anchor="' + escapeHtml(ref.anchorId || '') + '" data-url="' + escapeHtml(ref.providerPermalink || '') + '">OPEN SOURCE</button>' : '') +
          '</div>';
        }).join("");
        return '<div class="row assistant"><div class="assistant-wrap">' +
          '<div class="bubble">' + formatMarkdown(message.content) + '</div>' +
          (citations ? '<div class="sources">' + citations + '</div>' : '') +
        '</div></div>';
      }).join("");
      document.querySelectorAll("[data-source-open]").forEach((button) => {
        button.addEventListener("click", () => {
          post("openCitation", {
            documentId: button.getAttribute("data-doc"),
            anchorId: button.getAttribute("data-anchor"),
            providerPermalink: button.getAttribute("data-url")
          });
        });
      });
      els.chatScroll.scrollTop = els.chatScroll.scrollHeight;
    }

    function renderContext() {
      els.contextPill.classList.toggle("hidden", !state.ideContext);
      els.contextPreview.textContent = state.contextPreview
        ? (state.contextLabel || "Context") + ": " + state.contextPreview
        : "";
    }

    function renderUploadStatus() {
      if (!state.uploadStatus) {
        els.uploadStatus.classList.add("hidden");
        return;
      }
      els.uploadStatus.textContent = state.uploadStatus.message || "Document status updated.";
      els.uploadStatus.classList.remove("hidden");
    }

    els.loginForm.addEventListener("submit", (event) => {
      event.preventDefault();
      post("login", { email: els.email.value, password: els.password.value });
    });

    els.refreshProjectsBtn.addEventListener("click", () => post("refreshProjects"));
    els.disconnectBtn.addEventListener("click", () => post("disconnect"));
    els.signOutBtn.addEventListener("click", () => post("signOut"));
    els.plusBtn.addEventListener("click", () => {
      els.actionMenu.classList.toggle("hidden");
    });
    els.uploadActionBtn.addEventListener("click", () => {
      els.actionMenu.classList.add("hidden");
      post("uploadDocument");
    });
    els.ideContextActionBtn.addEventListener("click", () => {
      els.actionMenu.classList.add("hidden");
      post("captureIdeContext");
    });
    els.selectionActionBtn.addEventListener("click", () => {
      els.actionMenu.classList.add("hidden");
      post("captureSelection");
    });
    els.clearContextBtn.addEventListener("click", () => {
      state.ideContext = "";
      state.contextPreview = "";
      state.contextLabel = "";
      render();
    });

    els.askForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const question = els.question.value.trim();
      if (!question || state.busy || !state.isConnected) return;
      const ideContext = state.ideContext;
      const contextPreview = state.contextPreview;
      state.messages.push({ role: "user", content: question, contextPreview });
      state.ideContext = "";
      state.contextPreview = "";
      state.contextLabel = "";
      els.question.value = "";
      render();
      post("ask", { question, ideContext });
    });

    els.question.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        els.askForm.requestSubmit();
      }
    });

    window.addEventListener("message", (event) => {
      const message = event.data || {};
      if (message.type === "state") {
        Object.assign(state, message.payload || {});
        if (message.payload && message.payload.focus === "ask") setTimeout(() => els.question.focus(), 30);
        if (message.payload && message.payload.focus === "login") setTimeout(() => els.email.focus(), 30);
        render();
      }
      if (message.type === "projects") {
        state.projects = (message.payload && message.payload.projects) || [];
        render();
      }
      if (message.type === "answer") {
        const answer = message.payload || {};
        state.messages.push({
          role: "assistant",
          content: answer.answer_md || "I don't have enough project memory to answer that yet.",
          citations: answer.citations || [],
          open_targets: answer.open_targets || []
        });
        render();
      }
      if (message.type === "context") {
        state.ideContext = (message.payload && message.payload.ideContext) || "";
        state.contextPreview = (message.payload && message.payload.preview) || "";
        state.contextLabel = (message.payload && message.payload.label) || "Context";
        showToast((state.contextLabel || "Context") + " added for the next Socrates message only.");
        render();
      }
      if (message.type === "documentStatus") {
        state.uploadStatus = message.payload || null;
        if (message.payload && message.payload.message) {
          state.messages.push({ role: "system", content: message.payload.message });
        }
        render();
      }
      if (message.type === "notice") showToast(message.payload && message.payload.message);
      if (message.type === "error") showToast(message.payload && message.payload.message, "error");
      if (message.type === "busy") setBusy(message.payload && message.payload.message);
      if (message.type === "idle") setBusy("");
    });

    render();
    post("ready");
    if (state.userEmail) post("refreshProjects");
  </script>
</body>
</html>`;
}

function getNonce() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
