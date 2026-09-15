// Edited detail walkthrough of a real blocked preflight, not a fabricated success.
// swift scripts/desktop/render-preflight-demo.swift CAPTURE.png OUTPUT_DIR
import AppKit
import ImageIO
import UniformTypeIdentifiers
guard CommandLine.arguments.count == 3, let image=NSImage(contentsOfFile:CommandLine.arguments[1]) else {fatalError("Expected capture and fresh output directory")}
let output=URL(fileURLWithPath:CommandLine.arguments[2],isDirectory:true)
try FileManager.default.createDirectory(at:output,withIntermediateDirectories:true)
let file=output.appendingPathComponent("orchestra-preflight-walkthrough.gif")
guard !FileManager.default.fileExists(atPath:file.path) else {fatalError("Output exists")}
let frames=72
guard let gif=CGImageDestinationCreateWithURL(file as CFURL,UTType.gif.identifier as CFString,frames,nil) else {fatalError("Cannot export GIF")}
CGImageDestinationSetProperties(gif,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFLoopCount:0]] as CFDictionary)
let bg=NSColor(calibratedRed:0.055,green:0.050,blue:0.046,alpha:1)
let paper=NSColor(calibratedRed:0.97,green:0.95,blue:0.90,alpha:1)
let accent=NSColor(calibratedRed:1,green:0.48,blue:0.26,alpha:1)
func label(_ value:String,_ y:CGFloat,_ size:CGFloat,_ color:NSColor) {
    (value as NSString).draw(in:NSRect(x:36,y:y,width:828,height:50),withAttributes:[.font:NSFont.systemFont(ofSize:size,weight:.medium),.foregroundColor:color])
}
let full=NSRect(x:0,y:0,width:image.size.width,height:image.size.height)
// Source coordinates use the image's bottom-left origin; crop only, never retouch UI.
let blockers=NSRect(x:265,y:360,width:835,height:554)
let handoff=NSRect(x:265,y:0,width:835,height:554)
for frame in 0..<frames {
    autoreleasepool {
        let scene=frame/24, local=Double(frame%24)/23
        let amount=CGFloat(local*local*(3-2*local))
        let a=scene==0 ? full : scene==1 ? full : blockers
        let b=scene==0 ? full : scene==1 ? blockers : handoff
        var crop=NSRect(x:a.minX+(b.minX-a.minX)*amount,y:a.minY+(b.minY-a.minY)*amount,width:a.width+(b.width-a.width)*amount,height:a.height+(b.height-a.height)*amount)
        crop.origin.y=max(0,min(crop.origin.y,image.size.height-crop.height))
        let context=CGContext(data:nil,width:900,height:760,bitsPerComponent:8,bytesPerRow:0,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue)!
        NSGraphicsContext.saveGraphicsState();NSGraphicsContext.current=NSGraphicsContext(cgContext:context,flipped:false)
        bg.setFill();NSRect(x:0,y:0,width:900,height:760).fill()
        label("AGENT PREFLIGHT",686,16,accent)
        label(["Start with the gaps in view.","Missing requirements stay visible.","Hand off an exact context pack."][scene],626,30,paper)
        let frameRect=NSRect(x:36,y:65,width:828,height:549)
        context.saveGState();NSBezierPath(roundedRect:frameRect,xRadius:12,yRadius:12).addClip()
        image.draw(in:frameRect,from:crop,operation:.sourceOver,fraction:1)
        context.restoreGState()
        label("Real blocked preflight · Synthetic project · Edited detail views",0,14,paper.withAlphaComponent(0.65))
        accent.setFill();NSRect(x:0,y:0,width:900*Double(frame)/Double(frames),height:3).fill()
        if let cg=context.makeImage() {
            CGImageDestinationAddImage(gif,cg,[kCGImagePropertyGIFDictionary:[kCGImagePropertyGIFDelayTime:1.0/6.0]] as CFDictionary)
            if [0,47,71].contains(frame) {try! NSBitmapImageRep(cgImage:cg).representation(using:.png,properties:[:])!.write(to:output.appendingPathComponent("preflight-\(frame).png"))}
        }
        NSGraphicsContext.restoreGraphicsState()
    }
}
guard CGImageDestinationFinalize(gif) else {fatalError("GIF export failed")}
print("Created 12-second preflight detail walkthrough: \(file.path)")
