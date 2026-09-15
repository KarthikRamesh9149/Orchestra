// Edited walkthrough made from unmodified CUA captures of the real desktop app.
// No synthetic UI, generated answers, fonts, music or external footage.
// swift scripts/desktop/render-evidence-demo.swift CAPTURE_DIR OUTPUT_DIR
import AppKit
import AVFoundation
import ImageIO
import UniformTypeIdentifiers

guard CommandLine.arguments.count == 3 else { fatalError("Provide capture and output directories") }
let capture = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: CommandLine.arguments[2], isDirectory: true)
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
let names = ["chat-question.png", "chat-evidence.png", "citation-open.png", "document-pages.png"]
let images = try names.map { name -> NSImage in
    guard let image = NSImage(contentsOf: capture.appendingPathComponent(name)) else {
        throw NSError(domain: "Missing capture: \(name)", code: 1)
    }
    return image
}
let headlines = ["Start with a real question.", "See the evidence. Not a made-up answer.", "Open the source behind the response.", "Keep the original document within reach."]
let captions = ["Choose Docs to scope the question to project documents.", "No AI key is configured in this demo. Evidence-only mode is labelled explicitly.", "The citation opens the uploaded Northstar PRD inside Orchestra.", "Switch between extracted text and paged text. Download the original when needed."]
let width = 1440, height = 1120, fps: Int32 = 24, seconds = 24
let movie = output.appendingPathComponent("orchestra-evidence-walkthrough.mp4")
let gifURL = output.appendingPathComponent("orchestra-evidence-walkthrough.gif")
guard !FileManager.default.fileExists(atPath: movie.path), !FileManager.default.fileExists(atPath: gifURL.path) else {
    fatalError("Choose a fresh output directory; existing media is never overwritten")
}
let writer = try AVAssetWriter(outputURL: movie, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 1_600_000, AVVideoMaxKeyFrameIntervalKey: 48]
])
let adapter = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
    kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
])
writer.add(input)
guard writer.startWriting() else { fatalError("Cannot start video") }
writer.startSession(atSourceTime: .zero)
// Four readable real states, rather than a fake typing animation or fabricated speed.
guard let gif = CGImageDestinationCreateWithURL(gifURL as CFURL, UTType.gif.identifier as CFString, 4, nil) else {
    fatalError("Cannot create GIF")
}
CGImageDestinationSetProperties(gif, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFLoopCount: 0]] as CFDictionary)
let paper = NSColor(calibratedRed: 0.96, green: 0.94, blue: 0.89, alpha: 1)
let muted = NSColor(calibratedRed: 0.66, green: 0.63, blue: 0.59, alpha: 1)
let accent = NSColor(calibratedRed: 0.98, green: 0.48, blue: 0.25, alpha: 1)
func text(_ value: String, _ rect: NSRect, size: CGFloat, color: NSColor, weight: NSFont.Weight = .regular) {
    (value as NSString).draw(in: rect, withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color])
}
func draw(_ scene: Int, _ progress: Double, _ context: CGContext) {
    NSColor(calibratedRed: 0.065, green: 0.060, blue: 0.055, alpha: 1).setFill()
    NSRect(x: 0, y: 0, width: width, height: height).fill()
    text("ORCHESTRA", NSRect(x: 64, y: 1042, width: 500, height: 35), size: 21, color: paper, weight: .semibold)
    text(String(format: "%02d / 04", scene + 1), NSRect(x: 1260, y: 1042, width: 140, height: 30), size: 19, color: accent, weight: .medium)
    text(headlines[scene], NSRect(x: 64, y: 970, width: 1312, height: 60), size: 37, color: paper, weight: .semibold)
    text(captions[scene], NSRect(x: 64, y: 921, width: 1312, height: 42), size: 21, color: muted)
    let image = images[scene]
    let scale = min(1312 / image.size.width, 825 / image.size.height)
    let w = image.size.width * scale, h = image.size.height * scale
    let frame = NSRect(x: (1440-w)/2, y: 78+(825-h)/2, width: w, height: h)
    context.saveGState()
    NSBezierPath(roundedRect: frame, xRadius: 15, yRadius: 15).addClip()
    // The source capture itself is not retouched or relabelled.
    image.draw(in: frame, from: .zero, operation: .sourceOver, fraction: 1)
    context.restoreGState()
    text("REAL APP CAPTURES · SYNTHETIC PROJECT · EDITED WALKTHROUGH, NOT A LATENCY TEST", NSRect(x: 64, y: 28, width: 1312, height: 24), size: 14, color: muted)
    accent.setFill()
    NSRect(x: 0, y: 0, width: CGFloat(width) * CGFloat(progress), height: 4).fill()
}
for frame in 0..<(seconds * Int(fps)) {
    autoreleasepool {
        let scene = min(3, frame / (6 * Int(fps)))
        var pixel: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBuffer(nil, adapter.pixelBufferPool!, &pixel) == kCVReturnSuccess, let buffer = pixel else { fatalError("Pixel allocation failed") }
        CVPixelBufferLockBaseAddress(buffer, [])
        let context = CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        draw(scene, Double(frame) / Double(seconds * Int(fps)), context)
        if frame % (6 * Int(fps)) == 0, let cg = context.makeImage() {
            let rep = NSBitmapImageRep(cgImage: cg)
            try! rep.representation(using: .png, properties: [:])!.write(to: output.appendingPathComponent("scene-\(scene).png"))
            CGImageDestinationAddImage(gif, cg, [kCGImagePropertyGIFDictionary: [kCGImagePropertyGIFDelayTime: 6.0]] as CFDictionary)
        }
        NSGraphicsContext.restoreGraphicsState()
        CVPixelBufferUnlockBaseAddress(buffer, [])
        while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
        guard adapter.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: fps)) else { fatalError("Encoding failed") }
    }
}
input.markAsFinished()
let finished = DispatchSemaphore(value: 0)
writer.finishWriting { finished.signal() }
finished.wait()
guard writer.status == .completed, CGImageDestinationFinalize(gif) else { fatalError("Media export failed") }
print("Created 24-second H.264 walkthrough and four-state GIF: \(output.path)")
