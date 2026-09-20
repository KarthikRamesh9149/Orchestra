// Pure, in-memory synthetic PDFs. Importing this module performs no IO or automation.
import {PDFDocument, StandardFonts, rgb} from 'pdf-lib';

const LETTER=[612,792], A4=[595.28,841.89];
const black=rgb(0,0,0), ink=rgb(0x19/255,0x17/255,0x14/255);

async function renderPages(pages,{pageSize=LETTER,margin=72,title,author,paginate=true}={}){
 const document=await PDFDocument.create();
 if(title)document.setTitle(title);
 if(author)document.setAuthor(author);
 const fonts={regular:document.embedStandardFont(StandardFonts.Helvetica),bold:document.embedStandardFont(StandardFonts.HelveticaBold)};
 const supported=new Set(fonts.regular.getCharacterSet());
 for(const blocks of pages)for(const block of blocks)for(const character of block.text){
  if(character!=='\n'&&character!=='\r'&&!supported.has(character.codePointAt(0)))throw new Error('Synthetic PDF contains unsupported characters.');
 }
 for(const blocks of pages){
  let page=document.addPage(pageSize),top=pageSize[1]-margin;
  for(const {text,size=12,bold=false,color=black,lineGap=0,gapAfter=0} of blocks){
   const font=bold?fonts.bold:fonts.regular,lineHeight=size*1.2+lineGap;
   for(const line of wrapText(text,font,size,pageSize[0]-margin*2)){
    if(top-lineHeight<margin){
     if(!paginate)throw new Error('Synthetic PDF text exceeds its explicit page.');
     page=document.addPage(pageSize);top=pageSize[1]-margin;
    }
    if(line)page.drawText(line,{x:margin,y:top-size,font,size,color});
    top-=lineHeight;
   }
   top-=gapAfter;
  }
 }
 return Buffer.from(await document.save());
}

function wrapText(text,font,size,width){
 const lines=[],advances=new Map();
 for(const paragraph of text.split(/\r\n|\r|\n/)){
  const characters=Array.from(paragraph);
  if(!characters.length)lines.push('');
  for(let start=0;start<characters.length;){
   let end=start,used=0,lastSpace=-1;
   while(end<characters.length){
    const character=characters[end];
    if(!advances.has(character))advances.set(character,font.widthOfTextAtSize(character,size));
    const advance=advances.get(character);
    if(end>start&&used+advance>width)break;
    used+=advance;if(character===' ')lastSpace=end;end++;
   }
   if(end<characters.length&&lastSpace>=start)end=lastSpace+1;
   lines.push(characters.slice(start,end).join(''));start=end;
  }
 }
 return lines;
}

export function createDesktopSmokePdf(){
 return renderPages([[
  {size:18,text:'Orchestra Desktop Pilot Requirements'},
  {size:12,text:'The pilot launch date is 21 October 2026. Local workspaces need no hosted account. Evidence remains on this Mac. Acceptance requires upload, cited search, persistent chats and drafts, and restart recovery. The responsible owner is the local product manager. Changes require human approval; generated suggestions are not accepted truth.'}
 ]]);
}

export function createDesktopRecoveryPdf(){
 return renderPages([[{text:'Disposable recovery evidence. Offline acceptance requires human review.'}]]);
}

export function createDesktopTransferPdf(){
 return renderPages([[{text:'Synthetic transfer requirement: approval requires three reviewers.'}]]);
}

export function createDesktopWorkerCrashPdf(){
 return renderPages(Array.from({length:150},(_,n)=>[{size:9,text:`Synthetic crash requirement ${n}. Human approval must survive worker recovery. `.repeat(25)}]),{paginate:false});
}

export function createDesktopCorpusChatPdf(){
 return renderPages(Array.from({length:150},(_,n)=>[{size:9,text:`Synthetic corpus section ${n}. The ZEPHYR acceptance code is ORCHESTRA-${n}. `+
  Array.from({length:18},(_,k)=>`Requirement ${n}-${k}: all product changes require explicit human approval, attributable evidence, tested persistence and bounded local access. `).join('')}]),{paginate:false});
}

export async function createDesktopDemoDocuments(){
 const documents=[
  ['Northstar-Launch-PRD.pdf','Northstar launch requirements',[
   ['Demo project','Synthetic product-demo content. Northstar is a fictional team analytics product. This document is source evidence, not automatically accepted Product Brain truth.'],
   ['The customer problem','Team leads spend their Monday mornings assembling status updates from scattered project information. Northstar creates a weekly summary they can review and share.'],
   ['Launch scope','Email and password sign-in. A project overview. Weekly summaries. CSV export with item_id, title, owner and status columns.'],
   ['Not in this release','Google sign-in, PDF export and automated email delivery are outside the launch scope. Any change requires product-owner approval.'],
   ['Acceptance criteria','CSV export includes only the selected project. All four columns are present. Unauthorized users cannot export another project. Empty projects return column headers without invented rows.'],
   ['Ownership and delivery','The product lead approves scope. Engineering implements the approved requirements. QA verifies tenant isolation and export accuracy. Deployment evidence must be recorded separately from a merged pull request.']
  ]],
  ['Northstar-Change-Request.pdf','A new request before launch',[
   ['Demo project','Synthetic, unapproved change request for the fictional Northstar project.'],
   ['New customer request','Please include PDF export before launch so team leads can share a formatted weekly report with clients.'],
   ['Current scope','The launch PRD includes CSV export only. PDF export was explicitly outside the release scope.'],
   ['Decision needed','Should PDF export be added to launch, deferred, or rejected? This request must not silently replace approved requirements.'],
   ['Potential impact','Export service, report layout, access control, test coverage, delivery date and customer commitments. Confirm an owner and acceptance criteria before implementation.']
  ]]
 ];
 return Promise.all(documents.map(async([filename,title,sections])=>{
  const blocks=[
   {text:'ORCHESTRA / SYNTHETIC DEMO',size:10,color:rgb(0xb3/255,0x4d/255,0x29/255),gapAfter:12},
   {text:title,size:26,color:ink,gapAfter:26*1.2*.7}
  ];
  for(const [heading,body] of sections){
   blocks.push({text:heading,size:12,bold:true,color:ink,gapAfter:12*1.2*.25});
   blocks.push({text:body,size:11,color:rgb(0x44/255,0x44/255,0x44/255),lineGap:3,gapAfter:11*1.2*.8});
  }
  return {filename,buffer:await renderPages([blocks],{pageSize:A4,margin:54,title,author:'Orchestra synthetic demo'})};
 }));
}
