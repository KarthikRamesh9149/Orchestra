// Synthetic, user-authorized product-demo content; no customer records.
import PDFDocument from 'pdfkit';
import {createWriteStream} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {finished} from 'node:stream/promises';
const output=resolve(process.argv[2]??'.desktop/demo-content');
await mkdir(output,{recursive:true});
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
for(const [filename,title,sections] of documents){
 const doc=new PDFDocument({size:'A4',margin:54,info:{Title:title,Author:'Orchestra synthetic demo'}});
 const stream=createWriteStream(join(output,filename),{flags:'wx'});doc.pipe(stream);
 doc.fontSize(10).fillColor('#b34d29').text('ORCHESTRA / SYNTHETIC DEMO');doc.moveDown();
 doc.fontSize(26).fillColor('#191714').text(title);doc.moveDown(.7);
 for(const [heading,body] of sections){doc.fontSize(12).font('Helvetica-Bold').text(heading);doc.moveDown(.25);doc.font('Helvetica').fontSize(11).fillColor('#444444').text(body,{lineGap:3});doc.moveDown(.8);doc.fillColor('#191714');}
 doc.end();await finished(stream);console.log(filename);
}
