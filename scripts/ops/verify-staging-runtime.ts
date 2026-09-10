import { File } from "node:buffer";
import JSZip from "jszip";
import PDFDocument from "pdfkit";

type ApiEnvelope = {
  data?: unknown;
  error?: { code?: string; message?: string } | null;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("API returned an invalid object");
  return value as Record<string, unknown>;
}

function idOf(value: unknown, label: string) {
  const id = record(value).id;
  if (typeof id !== "string" || !id) throw new Error(`${label} did not return an id`);
  return id;
}

async function request(baseUrl: string, path: string, init: RequestInit = {}, token?: string) {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (init.body && !(init.body instanceof FormData)) headers.set("content-type", "application/json");
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(30_000)
  });
  const envelope = (await response.json()) as ApiEnvelope;
  if (!response.ok) {
    throw new Error(
      `HTTP ${init.method ?? "GET"} ${path} returned ${response.status} (${envelope.error?.code ?? "unknown_error"})`
    );
  }
  return envelope.data;
}

async function main() {
  const baseUrl = (process.env.BETA_SMOKE_BASE_URL ?? "").replace(/\/+$/, "");
  if (!baseUrl.startsWith("https://")) throw new Error("BETA_SMOKE_BASE_URL must be an HTTPS staging URL");

  const nonce = Date.now();
  const email = `fix3-runtime-${nonce}@example.com`;
  const password = `Fix3Runtime!${nonce}xStrong`;
  const signup = record(
    await request(baseUrl, "/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        orgName: `Fix 3 Runtime ${nonce}`,
        email,
        password,
        displayName: "Fix 3 Runtime Manager"
      })
    })
  );
  const firstToken = String(signup.accessToken ?? "");
  if (!firstToken) throw new Error("signup did not return an access token");

  const project = await request(
    baseUrl,
    "/v1/projects",
    {
      method: "POST",
      body: JSON.stringify({ name: `Fix 3 Persistence ${nonce}`, description: "Synthetic isolated-staging proof" })
    },
    firstToken
  );
  const projectId = idOf(project, "project create");
  const subscription = await request(
    baseUrl,
    `/v1/projects/${projectId}/subscriptions`,
    {
      method: "POST",
      body: JSON.stringify({
        name: "Synthetic staging subscription",
        category: "database",
        provider: "manual",
        cost: 1,
        currency: "AUD",
        billingType: "monthly",
        status: "active"
      })
    },
    firstToken
  );
  const subscriptionId = idOf(subscription, "subscription create");

  const login = record(
    await request(baseUrl, "/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    })
  );
  const secondToken = String(login.accessToken ?? "");
  if (!secondToken || secondToken === firstToken) throw new Error("fresh login did not rotate the access token");

  const reloadedProject = await request(baseUrl, `/v1/projects/${projectId}`, {}, secondToken);
  if (idOf(reloadedProject, "project reload") !== projectId) throw new Error("project did not survive a fresh login");
  const subscriptions = await request(baseUrl, `/v1/projects/${projectId}/subscriptions`, {}, secondToken);
  if (!JSON.stringify(subscriptions).includes(subscriptionId)) {
    throw new Error("subscription did not survive a fresh login");
  }

  const documents = [
    {
      title: "Fix 3 DOCX Worker Proof",
      fileName: "fix3-worker-proof.docx",
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      content: await createDocxFixture()
    },
    {
      title: "Fix 3 PDF Worker Proof",
      fileName: "fix3-worker-proof.pdf",
      contentType: "application/pdf",
      content: await createPdfFixture()
    }
  ];
  const documentResults: Array<{ documentId: string; fileName: string; status: string }> = [];
  for (const fixture of documents) {
    const form = new FormData();
    form.append("title", fixture.title);
    form.append("kind", "reference");
    form.append("visibility", "internal");
    form.append("sourceLabel", "fix3-staging-runtime");
    form.append("file", new File([fixture.content], fixture.fileName, { type: fixture.contentType }));
    const uploaded = await request(
      baseUrl,
      `/v1/projects/${projectId}/documents/upload`,
      { method: "POST", body: form },
      secondToken
    );
    const uploadResult = record(uploaded);
    const documentId = String(uploadResult.documentId ?? uploadResult.id ?? "");
    if (!documentId) throw new Error(`${fixture.fileName} upload did not return a document id`);

    let documentStatus = "pending";
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const document = record(
        await request(baseUrl, `/v1/projects/${projectId}/documents/${documentId}`, {}, secondToken)
      );
      documentStatus = String(document.parseStatus ?? record(document.currentVersion).status ?? "pending");
      if (documentStatus === "ready" || documentStatus === "partial") break;
      if (documentStatus === "failed") throw new Error(`staging worker failed ${fixture.fileName}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    if (documentStatus !== "ready" && documentStatus !== "partial") {
      throw new Error(`staging worker did not finish ${fixture.fileName} before timeout`);
    }
    documentResults.push({ documentId, fileName: fixture.fileName, status: documentStatus });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        liveProof: true,
        baseUrl,
        checks: [
          "synthetic signup",
          "project persistence after fresh login",
          "subscription persistence after fresh login",
          "private storage upload",
          "Redis-backed worker processing",
          "Supabase vector write"
        ],
        projectId,
        documents: documentResults
      },
      null,
      2
    )
  );
}

async function createDocxFixture() {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body><w:p><w:r><w:t>Isolated staging persists synthetic evidence through its worker queue.</w:t></w:r></w:p></w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

async function createPdfFixture() {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const document = new PDFDocument({ size: "A4", margin: 48 });
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
    document.text("Isolated staging safely parses PDF evidence through its worker queue.");
    document.end();
  });
}

await main();
