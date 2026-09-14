// Original, silent product explainer. Uses macOS system typography; no bundled fonts.
// Run: swift scripts/desktop/render-launch.swift OUTPUT_DIRECTORY
import AppKit
import AVFoundation
import CoreVideo

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let movie = output.appendingPathComponent("Orchestra-launch.mp4")
guard !FileManager.default.fileExists(atPath: movie.path) else { fatalError("Output already exists; choose a fresh directory") }
let width = 1920, height = 1080, fps: Int32 = 30
let writer = try AVAssetWriter(outputURL: movie, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 6_000_000]])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height, kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true])
writer.add(input)
guard writer.startWriting() else { fatalError("Writer failed") }
writer.startSession(atSourceTime: .zero)
let ink = NSColor(calibratedRed: 0.075, green: 0.069, blue: 0.063, alpha: 1)
let paper = NSColor(calibratedRed: 0.96, green: 0.94, blue: 0.89, alpha: 1)
let orange = NSColor(calibratedRed: 0.95, green: 0.32, blue: 0.12, alpha: 1)
let muted = NSColor(calibratedRed: 0.60, green: 0.57, blue: 0.52, alpha: 1)
func label(_ text: String, _ x: CGFloat, _ y: CGFloat, _ size: CGFloat, _ color: NSColor = paper, _ weight: NSFont.Weight = .medium, _ w: CGFloat = 1650) {
    let style = NSMutableParagraphStyle(); style.lineSpacing = 10
    (text as NSString).draw(in: NSRect(x:x,y:y,width:w,height:size*3.5), withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:weight),.foregroundColor:color,.paragraphStyle:style])
}
func card(_ title: String, _ detail: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat = 490, _ active: Bool = false) {
    let rect = NSRect(x:x,y:y,width:w,height:180)
    (active ? orange.withAlphaComponent(0.12) : NSColor.white.withAlphaComponent(0.035)).setFill()
    NSBezierPath(roundedRect:rect,xRadius:18,yRadius:18).fill()
    (active ? orange : muted.withAlphaComponent(0.4)).setStroke()
    let border=NSBezierPath(roundedRect:rect,xRadius:18,yRadius:18);border.lineWidth=1.5;border.stroke()
    label(title,x+28,y+72,27,active ? orange : paper,.semibold,w-56)
    label(detail,x+28,y+15,22,muted,.regular,w-56)
}
let starts: [Double] = [0,6,12,19,27,35,43,51]
let headings = ["Your team moves fast.","Your context doesn’t.","Meet Orchestra.","Answers you can inspect.","A request is not a decision.","Give agents the right context.","Keep the decision in view.","Move fast.\nBuild from the same truth."]
for frame in 0..<1800 {
    autoreleasepool {
        let time=Double(frame)/Double(fps)
        let scene=starts.lastIndex(where:{$0 <= time})!
        let elapsed=time-starts[scene]
        let end=scene == 7 ? 60 : starts[scene+1]
        let alpha=min(1,min(elapsed/0.45,(end-time)/0.45))
        var pixel: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil,adaptor.pixelBufferPool!,&pixel)==kCVReturnSuccess, let buffer=pixel else {fatalError("Pixel allocation failed")}
        CVPixelBufferLockBaseAddress(buffer,[])
        let context=CGContext(data:CVPixelBufferGetBaseAddress(buffer),width:width,height:height,bitsPerComponent:8,bytesPerRow:CVPixelBufferGetBytesPerRow(buffer),space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipFirst.rawValue)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current=NSGraphicsContext(cgContext:context,flipped:false)
        ink.setFill();NSRect(x:0,y:0,width:width,height:height).fill()
        orange.withAlphaComponent(0.13).setStroke()
        for ring in 0..<5 {
            let radius=CGFloat(140+ring*105)+CGFloat(time*3)
            let path=NSBezierPath(ovalIn:NSRect(x:1600-radius,y:960-radius,width:radius*2,height:radius*2));path.lineWidth=1;path.stroke()
        }
        label("ORCHESTRA",110,937,23,paper,.semibold)
        label("PRODUCT BRAIN",1460,940,18,muted,.medium,350)
        context.saveGState();context.setAlpha(CGFloat(max(0,alpha)))
        let lift=CGFloat(1-min(1,elapsed/0.7))*24
        label(String(format:"%02d / 08",scene+1),112,812+lift,19,orange,.medium)
        label(headings[scene],110,530+lift,76,paper,.semibold,1700)
        switch scene {
        case 0:
            label("The next release. The next request. The next decision.",115,468,30,muted,.regular)
            card("PRODUCT","What are we building?",110,190)
            card("ENGINEERING","What changed?",650,190)
            card("YOUR AGENT","Which context is current?",1190,190)
        case 1:
            label("Documents. Conversations. Code. Different versions of the story.",115,468,30,muted,.regular)
            card("DOCUMENT","Email login for launch",110,190)
            card("CONVERSATION","Can we add Google login?",650,240,490,true)
            card("REPOSITORY","Implementation in progress",1190,190)
        case 2:
            label("One Source of Truth and Product Brain for high-speed teams.",115,468,30,muted,.regular)
            card("01  CONNECT","Bring selected evidence together",110,190,490,true)
            card("02  DECIDE","Review before accepting changes",650,190)
            card("03  BUILD","Share current context with agents",1190,190)
        case 3:
            label("Ask Socrates. Read the answer. Open the source.",115,468,30,muted,.regular)
            card("QUESTION","What authentication scope is approved?",110,190,760,true)
            card("EVIDENCE","Inspect the requirement and its source",920,190,760)
        case 4:
            label("New evidence → proposed change → human review → accepted truth",115,468,30,muted,.regular)
            card("PROPOSED","Add Google login before launch",110,190,760)
            card("HUMAN REVIEW","Accept, reject or clarify the change",920,190,760,true)
        case 5:
            label("Preflight → exact context pack → Codex / VS Code → Postflight",115,468,30,muted,.regular)
            card("BEFORE THE WORK","Requirements, evidence and boundaries",110,190,760,true)
            card("AFTER THE WORK","Record implementation evidence",920,190,760)
        case 6:
            label("From the original request to the evidence of delivery.",115,468,30,muted,.regular)
            card("WHY","Source and approved decision",110,190)
            card("WHAT CHANGED","Linked implementation evidence",650,190,490,true)
            card("WHAT’S LEFT","Gaps stay visible",1190,190)
        default:
            label("Orchestra",115,380,52,orange,.semibold)
            label("One Source of Truth and Product Brain for high-speed teams.",115,270,30,paper,.regular)
            label("Private Mac beta • Local workspaces • Shared project context",115,185,24,muted,.regular)
        }
        context.restoreGState()
        label("PRODUCT EXPLAINER  ·  ILLUSTRATIVE EXAMPLES, NOT A LIVE RECORDING",110,39,15,muted,.medium)
        orange.setFill();NSRect(x:0,y:0,width:CGFloat(width)*CGFloat(time/60),height:5).fill()
        if [90,450,690,990,1380,1680].contains(frame), let cg=context.makeImage() {
            let rep=NSBitmapImageRep(cgImage:cg)
            try! rep.representation(using:.png,properties:[:])!.write(to:output.appendingPathComponent("frame-\(frame).png"))
        }
        NSGraphicsContext.restoreGraphicsState()
        CVPixelBufferUnlockBaseAddress(buffer,[])
        while !input.isReadyForMoreMediaData {Thread.sleep(forTimeInterval:0.005)}
        guard adaptor.append(buffer,withPresentationTime:CMTime(value:Int64(frame),timescale:fps)) else {fatalError("Append failed: \(String(describing:writer.error))")}
    }
    if frame % 300 == 0 { print("Rendered \(frame / 30)s") }
}
input.markAsFinished()
let finished=DispatchSemaphore(value:0)
writer.finishWriting {finished.signal()}
finished.wait()
guard writer.status == .completed else {fatalError("Encoding failed")}
print("Completed 60-second 1920x1080 H.264 product explainer: \(movie.path)")
