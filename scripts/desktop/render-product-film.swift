// Original 60-second product film. Uses real app captures and labelled illustrative framing.
// swift scripts/desktop/render-product-film.swift CAPTURE_DIR LOGO OUTPUT_DIR
import AppKit
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 4 else { fatalError("Expected captures, logo and fresh output directory") }
let capture = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: CommandLine.arguments[3], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let movie = output.appendingPathComponent("Orchestra-product-film.mp4")
guard !FileManager.default.fileExists(atPath: movie.path) else { fatalError("Output exists; choose a fresh directory") }
func load(_ path: URL) -> NSImage {
    guard let image = NSImage(contentsOf: path) else { fatalError("Missing input: \(path.lastPathComponent)") }
    return image
}
let logo = load(URL(fileURLWithPath: CommandLine.arguments[2]))
let shots = ["chat-question-clean.png", "chat-evidence.png", "citation-open.png", "preflight-blocker.png"].map { load(capture.appendingPathComponent($0)) }
let width = 1920, height = 1080, fps: Int32 = 30
let writer = try AVAssetWriter(outputURL: movie, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_100_000, AVVideoMaxKeyFrameIntervalKey: 60, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel]
])
let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
    kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
])
writer.add(input)
guard writer.startWriting() else { fatalError("Cannot start writer") }
writer.startSession(atSourceTime: .zero)
let starts: [Double] = [0, 6, 13, 21, 29, 38, 48]
let ink = NSColor(calibratedRed: 0.055, green: 0.050, blue: 0.046, alpha: 1)
let paper = NSColor(calibratedRed: 0.97, green: 0.95, blue: 0.90, alpha: 1)
let muted = NSColor(calibratedRed: 0.65, green: 0.62, blue: 0.57, alpha: 1)
let accent = NSColor(calibratedRed: 1, green: 0.48, blue: 0.26, alpha: 1)
func ease(_ n: Double) -> CGFloat { let v = min(1, max(0,n)); return CGFloat(v*v*(3-2*v)) }
func text(_ value: String, _ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ size: CGFloat, _ color: NSColor = paper, _ weight: NSFont.Weight = .medium, _ centered: Bool = false) {
    let style = NSMutableParagraphStyle(); style.lineSpacing = 4
    if centered { style.alignment = .center }
    (value as NSString).draw(in: NSRect(x:x,y:y,width:w,height:size*4), withAttributes: [.font:NSFont.systemFont(ofSize:size,weight:weight), .foregroundColor:color, .paragraphStyle:style])
}
func line(_ from: NSPoint, _ to: NSPoint, _ color: NSColor, _ thickness: CGFloat = 1) {
    color.setStroke(); let p = NSBezierPath(); p.move(to:from); p.line(to:to); p.lineWidth=thickness; p.stroke()
}
func screenshot(_ image: NSImage, _ frame: NSRect, _ progress: CGFloat, _ context: CGContext) {
    context.saveGState()
    let shadow=NSShadow(); shadow.shadowColor=NSColor.black.withAlphaComponent(0.55);shadow.shadowBlurRadius=35;shadow.shadowOffset=NSSize(width:0,height:-12);shadow.set()
    NSColor(calibratedWhite:0.13,alpha:1).setFill();NSBezierPath(roundedRect:frame,xRadius:20,yRadius:20).fill()
    context.restoreGState();context.saveGState()
    NSBezierPath(roundedRect:frame,xRadius:20,yRadius:20).addClip()
    let scale=max(frame.width/image.size.width,frame.height/image.size.height)*(1+0.025*progress)
    let w=image.size.width*scale,h=image.size.height*scale
    image.draw(in:NSRect(x:frame.midX-w/2,y:frame.midY-h/2,width:w,height:h),from:.zero,operation:.sourceOver,fraction:1)
    context.restoreGState()
    NSColor.white.withAlphaComponent(0.16).setStroke(); let border=NSBezierPath(roundedRect:frame,xRadius:20,yRadius:20);border.lineWidth=1;border.stroke()
}
func render(_ t: Double, _ context: CGContext) {
    ink.setFill();NSRect(x:0,y:0,width:width,height:height).fill()
    // Sparse editorial grid, not stock footage or a copied competitor design.
    for i in 0..<8 { line(NSPoint(x:CGFloat(i)*280-100,y:0),NSPoint(x:CGFloat(i)*280+280,y:1080),paper.withAlphaComponent(0.025)) }
    text("ORCHESTRA",96,946,600,26,paper,.semibold)
    text("PRODUCT BRAIN",1510,952,315,18,muted,.medium)
    line(NSPoint(x:96,y:931),NSPoint(x:1824,y:931),paper.withAlphaComponent(0.13))
    let scene=starts.lastIndex(where:{$0<=t})!, elapsed=t-starts[scene], end=scene==6 ? 60 : starts[scene+1]
    let fade = min(1, max(0, min(elapsed/0.38,(end-t)/0.38)))
    let lift = 22*(1-ease(elapsed/0.9)), progress=ease(elapsed/(end-starts[scene]))
    context.saveGState();context.setAlpha(CGFloat(scene==0 && t<0.38 ? 1 : fade))
    switch scene {
    case 0:
        text("Your team moves fast.",96,445+lift,1730,105,paper,.semibold)
        text("Your context falls behind.",96,297+lift,1730,105,accent,.semibold)
        text("The requirement. The conversation. The code.",102,245,1600,34,muted)
        text("One project. Different versions of the story.",102,193,1600,34,muted)
    case 1:
        text("What are we\nactually building?",96,490+lift,890,92,paper,.semibold)
        let labels=["THE PRD","THE REQUEST","THE AGENT"]
        let values=["CSV export for launch.","Can we add PDF export?","Which scope is current?"]
        for i in 0..<3 {
            let a=ease((elapsed-Double(i)*0.45)/0.8)
            context.saveGState();context.setAlpha(a)
            let rect=NSRect(x:1080+30*(1-a),y:640-CGFloat(i)*188,width:710,height:156)
            NSColor.white.withAlphaComponent(0.045).setFill();NSBezierPath(roundedRect:rect,xRadius:14,yRadius:14).fill()
            text(labels[i],rect.minX+28,rect.minY+64,650,18,accent,.semibold)
            text(values[i],rect.minX+28,rect.minY-25,650,30,paper)
            context.restoreGState()
        }
        text("Illustrative Northstar project",100,130,900,20,muted)
    case 2,3,4:
        let index=scene-2
        let titles=["Ask the\nproject.","Check the\nevidence.","Open the\nsource."]
        let details=["Scope the question to\nthe documents you selected.","If AI is unavailable,\nOrchestra says so.","Read the requirement\nbehind the response."]
        text(String(format:"0%d / PROJECT MEMORY",index+1),96,799,550,18,accent,.semibold)
        text(titles[index],96,485+lift,550,86,paper,.semibold)
        text(details[index],101,287,525,29,muted)
        if scene == 2 {
            // Focus on the actual composer rather than freezing its animated hero title mid-letter.
            let frame=NSRect(x:655,y:355,width:1169,height:255)
            context.saveGState();NSBezierPath(roundedRect:frame,xRadius:20,yRadius:20).addClip()
            shots[index].draw(in:frame,from:NSRect(x:360,y:25,width:780,height:170),operation:.sourceOver,fraction:1)
            context.restoreGState()
            accent.withAlphaComponent(0.65).setStroke();let outline=NSBezierPath(roundedRect:frame,xRadius:20,yRadius:20);outline.lineWidth=1;outline.stroke()
        } else {
            screenshot(shots[index],NSRect(x:655,y:127,width:1169,height:775),progress,context)
        }
        text(scene==3 ? "ACTUAL APP · EVIDENCE-ONLY MODE, NOT AI SYNTHESIS" : "ACTUAL APP · SYNTHETIC PROJECT · EDITED CAPTURES",96,46,1650,15,muted)
    case 5:
        text("BEFORE YOUR AGENT BUILDS",96,799,560,18,accent,.semibold)
        text("A missing\ndecision is\na blocker.",96,390+lift,560,79,paper,.semibold)
        text("Preflight makes the gaps\nvisible before implementation.",101,186,535,28,muted)
        screenshot(shots[3],NSRect(x:655,y:127,width:1169,height:775),progress,context)
        text("ACTUAL PREFLIGHT · BLOCKED STATE RETAINED · NOT A SUCCESSFUL AGENT RUN",96,46,1650,15,muted)
    default:
        NSColor.black.setFill();NSBezierPath(roundedRect:NSRect(x:620,y:758,width:680,height:145),xRadius:20,yRadius:20).fill()
        logo.draw(in:NSRect(x:660,y:774,width:100*logo.size.width/logo.size.height,height:100),from:.zero,operation:.sourceOver,fraction:1)
        text("Orchestra",790,538,600,83,paper,.semibold)
        text("Product Brain for\nHigh Speed Teams",150,330+lift,1620,105,paper,.semibold,true)
        text("Local evidence. Explicit decisions. Scoped agent context.",160,188,1600,32,muted,.medium,true)
        text("PRIVATE MAC BETA  ·  BUILD FROM SOURCE",160,102,1600,19,accent,.semibold,true)
    }
    context.restoreGState()
    accent.setFill();NSRect(x:0,y:0,width:CGFloat(width)*CGFloat(t/60),height:4).fill()
}
for frame in 0..<1800 {
    autoreleasepool {
        var pixel: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil,adapter.pixelBufferPool!,&pixel)==kCVReturnSuccess,let buffer=pixel else {fatalError("Pixel allocation failed")}
        CVPixelBufferLockBaseAddress(buffer,[])
        let context=CGContext(data:CVPixelBufferGetBaseAddress(buffer),width:width,height:height,bitsPerComponent:8,bytesPerRow:CVPixelBufferGetBytesPerRow(buffer),space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.noneSkipFirst.rawValue)!
        NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(cgContext:context,flipped:false)
        render(Double(frame)/Double(fps),context)
        if [90,270,510,750,1020,1290,1620].contains(frame),let cg=context.makeImage() {
            try! NSBitmapImageRep(cgImage:cg).representation(using:.png,properties:[:])!.write(to:output.appendingPathComponent("frame-\(frame).png"))
        }
        NSGraphicsContext.restoreGraphicsState();CVPixelBufferUnlockBaseAddress(buffer,[])
        while !input.isReadyForMoreMediaData {Thread.sleep(forTimeInterval:0.005)}
        guard adapter.append(buffer,withPresentationTime:CMTime(value:Int64(frame),timescale:fps)) else {fatalError("Frame encoding failed")}
    }
    if frame%450==0 {print("Rendered \(frame/30)s")}
}
input.markAsFinished();let done=DispatchSemaphore(value:0);writer.finishWriting{done.signal()};done.wait()
guard writer.status == .completed else {fatalError("Video export failed")}
print("Completed 60-second 1920x1080 film: \(movie.path)")
