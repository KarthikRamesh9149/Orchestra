import {readFile} from "node:fs/promises";
import {PDFDocument, PDFPage} from "pdf-lib";
import {PDFParse} from "pdf-parse";
import {afterEach, describe, expect, it, vi} from "vitest";
import {
  createDesktopSmokePdf, createDesktopRecoveryPdf, createDesktopTransferPdf,
  createDesktopWorkerCrashPdf, createDesktopCorpusChatPdf, createDesktopDemoDocuments
} from "../scripts/desktop/pdf-fixtures.mjs";

const compact=(text: string)=>text.replace(/\s+/g, "");
async function extract(buffer: Buffer){
  expect(Buffer.isBuffer(buffer)).toBe(true);
  expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  const parser=new PDFParse({data:buffer});
  try{return await parser.getText({pageJoiner:""});}finally{await parser.destroy();}
}
afterEach(()=>vi.restoreAllMocks());

describe("pure desktop PDF fixtures",()=>{
  it.each([
    [createDesktopSmokePdf,"Orchestra Desktop Pilot Requirements The pilot launch date is 21 October 2026. Local workspaces need no hosted account. Evidence remains on this Mac. Acceptance requires upload, cited search, persistent chats and drafts, and restart recovery. The responsible owner is the local product manager. Changes require human approval; generated suggestions are not accepted truth."],
    [createDesktopRecoveryPdf,"Disposable recovery evidence. Offline acceptance requires human review."],
    [createDesktopTransferPdf,"Synthetic transfer requirement: approval requires three reviewers."]
  ] as const)("preserves all source text for %s",async(create,expected)=>{
    const buffer=await create(),result=await extract(buffer);
    expect(result.total).toBe(1);
    expect(compact(result.pages[0]!.text)).toBe(compact(expected));
    const document=await PDFDocument.load(buffer);
    expect(document.getPage(0).getSize()).toEqual({width:612,height:792});
  });

  it("preserves exactly 150 worker-crash pages and all 25 repeated requirements on each page",async()=>{
    const result=await extract(await createDesktopWorkerCrashPdf());
    expect(result.total).toBe(150);
    for(let n=0;n<150;n++)expect(compact(result.pages[n]!.text)).toBe(compact(`Synthetic crash requirement ${n}. Human approval must survive worker recovery. `.repeat(25)));
  },20_000);

  it("preserves exactly 150 corpus pages and every numbered requirement and acceptance code",async()=>{
    const result=await extract(await createDesktopCorpusChatPdf());
    expect(result.total).toBe(150);
    for(let n=0;n<150;n++){
      const expected=`Synthetic corpus section ${n}. The ZEPHYR acceptance code is ORCHESTRA-${n}. `+
        Array.from({length:18},(_,k)=>`Requirement ${n}-${k}: all product changes require explicit human approval, attributable evidence, tested persistence and bounded local access. `).join("");
      expect(compact(result.pages[n]!.text)).toBe(compact(expected));
    }
  },20_000);

  it("preserves both complete demo sources, A4 size, metadata, margin, bold headings and colour/size contracts",async()=>{
    const draw=vi.spyOn(PDFPage.prototype,"drawText");
    const fixtures=await createDesktopDemoDocuments();
    expect(fixtures.map(item=>item.filename)).toEqual(["Northstar-Launch-PRD.pdf","Northstar-Change-Request.pdf"]);
    const expected=[
      ["Northstar launch requirements",[
        "Demo project", "Synthetic product-demo content. Northstar is a fictional team analytics product. This document is source evidence, not automatically accepted Product Brain truth.",
        "The customer problem", "Team leads spend their Monday mornings assembling status updates from scattered project information. Northstar creates a weekly summary they can review and share.",
        "Launch scope", "Email and password sign-in. A project overview. Weekly summaries. CSV export with item_id, title, owner and status columns.",
        "Not in this release", "Google sign-in, PDF export and automated email delivery are outside the launch scope. Any change requires product-owner approval.",
        "Acceptance criteria", "CSV export includes only the selected project. All four columns are present. Unauthorized users cannot export another project. Empty projects return column headers without invented rows.",
        "Ownership and delivery", "The product lead approves scope. Engineering implements the approved requirements. QA verifies tenant isolation and export accuracy. Deployment evidence must be recorded separately from a merged pull request."
      ]],
      ["A new request before launch",[
        "Demo project", "Synthetic, unapproved change request for the fictional Northstar project.",
        "New customer request", "Please include PDF export before launch so team leads can share a formatted weekly report with clients.",
        "Current scope", "The launch PRD includes CSV export only. PDF export was explicitly outside the release scope.",
        "Decision needed", "Should PDF export be added to launch, deferred, or rejected? This request must not silently replace approved requirements.",
        "Potential impact", "Export service, report layout, access control, test coverage, delivery date and customer commitments. Confirm an owner and acceptance criteria before implementation."
      ]]
    ] as const;
    for(let index=0;index<fixtures.length;index++){
      const buffer=fixtures[index]!.buffer,result=await extract(buffer),[title,sections]=expected[index]!;
      expect(compact(result.text)).toBe(compact(["ORCHESTRA / SYNTHETIC DEMO",title,...sections].join(" ")));
      const document=await PDFDocument.load(buffer);
      expect(document.getTitle()).toBe(title);
      expect(document.getAuthor()).toBe("Orchestra synthetic demo");
      for(const page of document.getPages())expect(page.getSize()).toEqual({width:595.28,height:841.89});
    }
    expect(new Set(draw.mock.calls.map(([,options])=>options!.size))).toEqual(new Set([10,26,12,11]));
    for(const [line,options] of draw.mock.calls){
      expect(options!.x).toBe(54);
      expect(options!.y).toBeGreaterThanOrEqual(54);
      expect(options!.font!.name).toBe(options!.size===12?"Helvetica-Bold":"Helvetica");
      const channel=options!.size===10?[0xb3,0x4d,0x29]:options!.size===11?[0x44,0x44,0x44]:[0x19,0x17,0x14];
      expect(options!.color).toMatchObject({red:channel[0]!/255,green:channel[1]!/255,blue:channel[2]!/255});
      const advance=Array.from(line).reduce((sum,char)=>sum+options!.font!.widthOfTextAtSize(char,options!.size!),0);
      expect(advance).toBeLessThanOrEqual(595.28-108+1e-7);
    }
  });

  it("keeps automation entrypoints on the pure helper and demo writes exclusive",async()=>{
    const scripts=[
      ["ui-smoke","createDesktopSmokePdf"], ["ui-recovery","createDesktopRecoveryPdf"],
      ["ui-project-transfer","createDesktopTransferPdf"], ["qualify-worker-crash","createDesktopWorkerCrashPdf"],
      ["qualify-corpus-chat","createDesktopCorpusChatPdf"], ["make-demo-documents","createDesktopDemoDocuments"]
    ];
    for(const [script,helper] of scripts){
      const source=await readFile(new URL(`../scripts/desktop/${script}.mjs`,import.meta.url),"utf8");
      expect(source).not.toContain("pdfkit");
      expect(source).toContain(`import {${helper}} from './pdf-fixtures.mjs'`);
      expect(source).toContain(`await ${helper}()`);
      if(script==="make-demo-documents")expect(source).toContain("{flags:'wx'}");
    }
    const helper=await readFile(new URL("../scripts/desktop/pdf-fixtures.mjs",import.meta.url),"utf8");
    expect(helper.match(/^import .+$/gm)).toEqual(["import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';"]);
    expect(helper).not.toMatch(/process\.|fetch\(|_electron|playwright|writeFile|createWriteStream/);
  });
});
