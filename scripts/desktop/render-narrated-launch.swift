// Original, data-driven edit of real captures. No UI reconstruction or generated app states.
// swift render-narrated-launch.swift TIMELINE.json FRESH_OUTPUT_DIR [--stills-only|--validate]
// Crop coordinates are normalised top-left x/y/width/height. Frame times are scene-relative.
// Audio is inserted at its natural duration, never accelerated, truncated or silently overlapped.
import AppKit
import AVFoundation
import ImageIO
import CryptoKit

struct AudioClip: Decodable { let file: String; let start: Double }
struct Caption: Decodable { let start: Double; let end: Double; let text: String }
struct RealFrame: Decodable { let at: Double; let file: String }
struct Scene: Decodable {
    let start: Double; let end: Double; let layout: String
    let title: String?; let eyebrow: String?; let body: String?
    let image: String?; let frames: [RealFrame]?; let crop: [Double]?; let zoom: Double?
}
struct Timeline: Decodable {
    let duration: Double; let logo: String?; let audio: [AudioClip]?
    let captions: [Caption]?; let scenes: [Scene]; let previewTimes: [Double]?
}
enum FilmError: Error, CustomStringConvertible {
    case invalid(String)
    var description: String { switch self { case .invalid(let text): return text } }
}
func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw FilmError.invalid(message) }
}
func finite(_ values: Double...) -> Bool { values.allSatisfy { $0.isFinite } }
let args = CommandLine.arguments
guard args.count >= 3 && args.count <= 4 else {
    fatalError("Expected TIMELINE.json FRESH_OUTPUT_DIR [--stills-only|--validate]")
}
let mode = args.count == 4 ? args[3] : "render"
try require(["render", "--stills-only", "--validate"].contains(mode), "Unknown render mode")
let inputURL = URL(fileURLWithPath: args[1]).standardizedFileURL
let base = inputURL.deletingLastPathComponent()
let output = URL(fileURLWithPath: args[2], isDirectory: true).standardizedFileURL
func path(_ value: String) -> URL {
    value.hasPrefix("/") ? URL(fileURLWithPath: value) : base.appendingPathComponent(value)
}
let plan = try JSONDecoder().decode(Timeline.self, from: Data(contentsOf: inputURL))
let width = 1920, height = 1080, fps: Int32 = 30
let fm = FileManager.default
try require(finite(plan.duration) && plan.duration > 0 && plan.duration <= 900,
    "Duration must be finite and between 0 and 900 seconds")
try require(abs(plan.duration * Double(fps) - (plan.duration * Double(fps)).rounded()) < 0.00001,
    "Duration must land on a 30fps frame boundary")
try require(!plan.scenes.isEmpty, "At least one scene is required")
var cursor = 0.0
var images = [String: NSImage]()
func load(_ value: String) throws -> NSImage {
    if let cached = images[value] { return cached }
    let url = path(value)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cg = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        throw FilmError.invalid("Cannot decode source capture: \(url.lastPathComponent)")
    }
    let image = NSImage(cgImage: cg, size: NSSize(width: cg.width, height: cg.height))
    images[value] = image; return image
}
for scene in plan.scenes {
    try require(finite(scene.start, scene.end) && abs(scene.start - cursor) < 0.00001 && scene.end > scene.start,
        "Scenes must be ordered, contiguous and non-empty")
    try require(["hero", "screen", "split"].contains(scene.layout), "Unknown scene layout")
    try require(scene.image == nil || scene.frames == nil, "Use a still OR a real-frame sequence")
    let zoom = scene.zoom ?? 1
    try require(zoom.isFinite && zoom >= 1 && zoom <= 1.08, "Zoom must be restrained: 1 through 1.08")
    if let crop = scene.crop {
        try require(crop.count == 4 && crop.allSatisfy { $0.isFinite }, "Crop requires four finite values")
        try require(crop[0] >= 0 && crop[1] >= 0 && crop[2] > 0 && crop[3] > 0 && crop[0] + crop[2] <= 1.000001 && crop[1] + crop[3] <= 1.000001, "Crop escapes source capture")
    }
    if let image = scene.image { _ = try load(image) }
    if let frames = scene.frames {
        try require(!frames.isEmpty && frames[0].at == 0, "Real-frame sequences must begin at zero")
        var last = -1.0
        for frame in frames {
            try require(finite(frame.at) && frame.at > last && frame.at < scene.end - scene.start, "Real-frame times must be increasing within their scene")
            _ = try load(frame.file); last = frame.at
        }
    }
    try require(scene.layout == "hero" || scene.image != nil || scene.frames != nil, "Screen scenes require real captures")
    cursor = scene.end
}
try require(abs(cursor - plan.duration) < 0.00001, "Scenes must cover the complete declared duration")
let logo = try plan.logo.map { try load($0) }
let captions = plan.captions ?? []
cursor = 0
for caption in captions {
    try require(finite(caption.start, caption.end) && caption.start >= cursor && caption.end > caption.start && caption.end <= plan.duration + 0.00001, "Captions must be ordered, non-overlapping and inside the film")
    try require(!caption.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, "Empty caption")
    let style = NSMutableParagraphStyle(); style.lineSpacing = 3.84; style.lineBreakMode = .byWordWrapping
    let measured = (caption.text as NSString).boundingRect(with: NSSize(width: 1560, height: 400), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: NSFont.systemFont(ofSize: 32, weight: .medium), .paragraphStyle: style])
    try require(measured.height <= 90, "Caption exceeds the two-line matte; split the cue at a measured or reviewed sentence boundary")
    cursor = caption.end
}
var audioAssets = [(AudioClip, AVURLAsset, Double)]()
cursor = 0
for clip in plan.audio ?? [] {
    let asset = AVURLAsset(url: path(clip.file))
    let seconds = CMTimeGetSeconds(asset.duration)
    try require(finite(clip.start, seconds) && clip.start >= cursor - 0.00001 && seconds > 0 && clip.start + seconds <= plan.duration + 0.001,
        "Narration must fit completely without overlap, speeding or clipping: \(path(clip.file).lastPathComponent)")
    try require(!asset.tracks(withMediaType: .audio).isEmpty, "Narration has no audio track")
    audioAssets.append((clip, asset, seconds)); cursor = clip.start + seconds
}
let previewTimes = plan.previewTimes ?? plan.scenes.map { ($0.start + $0.end) / 2 }
try require(previewTimes.allSatisfy { $0.isFinite && $0 >= 0 && $0 < plan.duration }, "Preview time outside film")
if mode == "--validate" {
    print("Validated \(plan.scenes.count) scenes, \(images.count) real/brand images, \(audioAssets.count) intact narration clips, \(captions.count) captions; \(plan.duration)s at 1920x1080/30fps")
    exit(0)
}
try require(!fm.fileExists(atPath: output.path), "Output exists; choose a fresh directory")
try fm.createDirectory(at: output, withIntermediateDirectories: true)
try fm.copyItem(at: inputURL, to: output.appendingPathComponent("timeline.json"))

let ink = NSColor(calibratedRed: 0.035, green: 0.034, blue: 0.032, alpha: 1)
let paper = NSColor(calibratedRed: 0.97, green: 0.955, blue: 0.92, alpha: 1)
let muted = NSColor(calibratedRed: 0.63, green: 0.625, blue: 0.60, alpha: 1)
let accent = NSColor(calibratedRed: 0.99, green: 0.44, blue: 0.23, alpha: 1)
func ease(_ n: Double) -> CGFloat { let v = min(1, max(0, n)); return CGFloat(v * v * (3 - 2 * v)) }
func attributes(_ size: CGFloat, _ color: NSColor, _ weight: NSFont.Weight, _ center: Bool = false) -> [NSAttributedString.Key: Any] {
    let style = NSMutableParagraphStyle(); style.lineSpacing = size * 0.12
    style.alignment = center ? .center : .left; style.lineBreakMode = .byWordWrapping
    return [.font: NSFont.systemFont(ofSize: size, weight: weight), .foregroundColor: color, .paragraphStyle: style]
}
func text(_ value: String, _ rect: NSRect, _ size: CGFloat, _ color: NSColor = paper, _ weight: NSFont.Weight = .medium, _ center: Bool = false) {
    (value as NSString).draw(in: rect, withAttributes: attributes(size, color, weight, center))
}
func screenshot(_ image: NSImage, scene: Scene, frame: NSRect, progress: CGFloat, context: CGContext) {
    let c = scene.crop ?? [0, 0, 1, 1]
    let crop = NSRect(x: c[0] * image.size.width, y: (1 - c[1] - c[3]) * image.size.height, width: c[2] * image.size.width, height: c[3] * image.size.height)
    let fit = min(frame.width / crop.width, frame.height / crop.height)
    let target = NSRect(x: frame.midX - crop.width * fit / 2, y: frame.midY - crop.height * fit / 2, width: crop.width * fit, height: crop.height * fit)
    context.saveGState()
    let shadow = NSShadow(); shadow.shadowColor = NSColor.black.withAlphaComponent(0.5)
    shadow.shadowBlurRadius = 38; shadow.shadowOffset = NSSize(width: 0, height: -10); shadow.set()
    NSColor.black.setFill(); NSBezierPath(roundedRect: target, xRadius: 16, yRadius: 16).fill()
    context.restoreGState(); context.saveGState()
    NSBezierPath(roundedRect: target, xRadius: 16, yRadius: 16).addClip()
    let zoom = 1 + CGFloat((scene.zoom ?? 1) - 1) * progress
    let source = NSRect(x: crop.midX - crop.width / zoom / 2, y: crop.midY - crop.height / zoom / 2, width: crop.width / zoom, height: crop.height / zoom)
    image.draw(in: target, from: source, operation: .sourceOver, fraction: 1)
    context.restoreGState()
    NSColor.white.withAlphaComponent(0.16).setStroke()
    let border = NSBezierPath(roundedRect: target, xRadius: 16, yRadius: 16); border.lineWidth = 1; border.stroke()
}
func render(_ time: Double, _ context: CGContext) {
    ink.setFill(); NSRect(x: 0, y: 0, width: width, height: height).fill()
    // Quiet warm brand light around the app; original geometry, not a mock interface.
    let glow = NSGradient(starting: accent.withAlphaComponent(0.055), ending: ink)!
    glow.draw(in: NSBezierPath(rect: NSRect(x: 0, y: 70, width: 1920, height: 1010)), angle: 135)
    let index = plan.scenes.lastIndex { $0.start <= time } ?? 0
    let scene = plan.scenes[index], elapsed = time - scene.start
    let progress = ease(elapsed / (scene.end - scene.start))
    let fade = min(1, min(elapsed / 0.22, (scene.end - time) / 0.22))
    let alpha = index == 0 && elapsed < 0.22 ? 1 : max(0, fade)
    context.saveGState(); context.setAlpha(CGFloat(alpha))
    let lift = 14 * (1 - ease(elapsed / 0.7))
    if scene.layout == "hero" {
        if let logo = logo {
            let logoHeight: CGFloat = 122, logoWidth = logoHeight * logo.size.width / logo.size.height
            logo.draw(in: NSRect(x: 960 - logoWidth / 2, y: 780, width: logoWidth, height: logoHeight), from: .zero, operation: .sourceOver, fraction: 1)
        }
        text(scene.eyebrow ?? "ORCHESTRA", NSRect(x: 120, y: 696, width: 1680, height: 42), 22, accent, .semibold, true)
        text(scene.title ?? "Product Brain for\nHigh Speed Teams", NSRect(x: 150, y: 350 + lift, width: 1620, height: 290), 94, paper, .semibold, true)
        if let body = scene.body { text(body, NSRect(x: 260, y: 235, width: 1400, height: 92), 31, muted, .regular, true) }
        if let image = scene.image { screenshot(images[image]!, scene: scene, frame: NSRect(x: 230, y: 205, width: 1460, height: 500), progress: progress, context: context) }
    } else {
        text("ORCHESTRA", NSRect(x: 80, y: 1005, width: 500, height: 29), 20, paper, .semibold)
        text(scene.eyebrow ?? String(format: "%02d / PRODUCT WALKTHROUGH", index + 1), NSRect(x: 960, y: 1007, width: 880, height: 26), 17, muted, .medium, false)
        accent.withAlphaComponent(0.72).setFill(); NSRect(x: 80, y: 980, width: 45, height: 2).fill()
        NSColor.white.withAlphaComponent(0.11).setFill(); NSRect(x: 125, y: 980, width: 1715, height: 1).fill()
        let value = scene.image ?? scene.frames!.last(where: { $0.at <= elapsed })!.file
        if scene.layout == "split" {
            text(scene.title ?? "", NSRect(x: 80, y: 446 + lift, width: 475, height: 350), 69, paper, .semibold)
            if let body = scene.body { text(body, NSRect(x: 83, y: 254, width: 425, height: 185), 27, muted, .regular) }
            screenshot(images[value]!, scene: scene, frame: NSRect(x: 560, y: 150, width: 1280, height: 782), progress: progress, context: context)
        } else {
            if let title = scene.title { text(title, NSRect(x: 80, y: 905 + lift, width: 1760, height: 63), 39, paper, .semibold) }
            screenshot(images[value]!, scene: scene, frame: NSRect(x: 80, y: 142, width: 1760, height: scene.title == nil ? 809 : 738), progress: progress, context: context)
        }
    }
    context.restoreGState()
    // Caption matte is outside the screenshot frame; never overwrites a displayed UI state.
    if let caption = captions.first(where: { $0.start <= time && time < $0.end }) {
        let rect = NSRect(x: 180, y: 20, width: 1560, height: 104)
        let style = attributes(32, paper, .medium, true)
        let measured = (caption.text as NSString).boundingRect(with: NSSize(width: rect.width, height: 400), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: style)
        (caption.text as NSString).draw(in: NSRect(x: rect.minX, y: rect.midY - measured.height / 2, width: rect.width, height: measured.height + 4), withAttributes: style)
    }
    accent.withAlphaComponent(0.85).setFill(); NSRect(x: 0, y: 0, width: CGFloat(width) * CGFloat(time / plan.duration), height: 3).fill()
}
func contextFor(_ buffer: CVPixelBuffer) -> CGContext {
    CGContext(data: CVPixelBufferGetBaseAddress(buffer), width: width, height: height, bitsPerComponent: 8,
        bytesPerRow: CVPixelBufferGetBytesPerRow(buffer), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
}
func savePreview(_ cg: CGImage, _ frame: Int) throws {
    let bytes = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])!
    try bytes.write(to: output.appendingPathComponent(String(format: "preview-%05d.png", frame)), options: .withoutOverwriting)
}
let previews = Set(previewTimes.map { Int(($0 * Double(fps)).rounded(.down)) })
let movie = output.appendingPathComponent("picture.mp4")
var writer: AVAssetWriter? = nil
var videoInput: AVAssetWriterInput? = nil
var adapter: AVAssetWriterInputPixelBufferAdaptor? = nil
if mode != "--stills-only" {
    let w = try AVAssetWriter(outputURL: movie, fileType: .mp4)
    let i = AVAssetWriterInput(mediaType: .video, outputSettings: [
        AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height,
        AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 7_500_000, AVVideoMaxKeyFrameIntervalKey: 60, AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel]
    ])
    let a = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: i, sourcePixelBufferAttributes: [
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
        kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferCGImageCompatibilityKey as String: true, kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
    ])
    w.add(i); try require(w.startWriting(), "Cannot start video writer"); w.startSession(atSourceTime: .zero)
    writer = w; videoInput = i; adapter = a
}
let count = Int((plan.duration * Double(fps)).rounded())
let renderFrames = mode == "--stills-only" ? previews.sorted() : Array(0..<count)
for frame in renderFrames {
    try autoreleasepool {
        var pixel: CVPixelBuffer?
        let status = adapter == nil ? CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_32ARGB, [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true] as CFDictionary, &pixel) : CVPixelBufferPoolCreatePixelBuffer(nil, adapter!.pixelBufferPool!, &pixel)
        try require(status == kCVReturnSuccess && pixel != nil, "Pixel allocation failed")
        let buffer = pixel!; CVPixelBufferLockBaseAddress(buffer, [])
        let context = contextFor(buffer)
        NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: false)
        render(Double(frame) / Double(fps), context)
        if previews.contains(frame), let cg = context.makeImage() { try savePreview(cg, frame) }
        NSGraphicsContext.restoreGraphicsState(); CVPixelBufferUnlockBaseAddress(buffer, [])
        if let i = videoInput, let a = adapter {
            while !i.isReadyForMoreMediaData {
                try require(writer!.status == .writing, "Writer stopped while awaiting frame")
                Thread.sleep(forTimeInterval: 0.003)
            }
            try require(a.append(buffer, withPresentationTime: CMTime(value: Int64(frame), timescale: fps)), "Frame encoding failed")
        }
    }
    if frame % 300 == 0 { print("Rendered \(frame / 30)s / \(plan.duration)s") }
}
if let writer = writer, let videoInput = videoInput {
    videoInput.markAsFinished(); writer.endSession(atSourceTime: CMTime(seconds: plan.duration, preferredTimescale: fps))
    let done = DispatchSemaphore(value: 0); writer.finishWriting { done.signal() }; done.wait()
    try require(writer.status == .completed, "Video export failed: \(writer.error?.localizedDescription ?? "unknown")")
    let final = output.appendingPathComponent("Orchestra-film.mp4")
    if audioAssets.isEmpty { try fm.copyItem(at: movie, to: final) }
    else {
        let composition = AVMutableComposition(), picture = AVURLAsset(url: movie)
        let duration = CMTime(seconds: plan.duration, preferredTimescale: 600)
        guard let source = picture.tracks(withMediaType: .video).first,
              let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid),
              let audioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) else { throw FilmError.invalid("Cannot create film composition") }
        try videoTrack.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: .zero)
        for (clip, asset, _) in audioAssets {
            try audioTrack.insertTimeRange(CMTimeRange(start: .zero, duration: asset.duration), of: asset.tracks(withMediaType: .audio)[0], at: CMTime(seconds: clip.start, preferredTimescale: 600))
        }
        guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { throw FilmError.invalid("Cannot create narration muxer") }
        exporter.outputURL = final; exporter.outputFileType = .mp4; exporter.shouldOptimizeForNetworkUse = true
        let finished = DispatchSemaphore(value: 0); exporter.exportAsynchronously { finished.signal() }; finished.wait()
        try require(exporter.status == .completed, "Narration mux failed: \(exporter.error?.localizedDescription ?? "unknown")")
        let result = AVURLAsset(url: final)
        try require(abs(CMTimeGetSeconds(result.duration) - plan.duration) < 0.08 && !result.tracks(withMediaType: .audio).isEmpty, "Muxed duration/audio mismatch")
    }
    print("Completed: \(final.path)")
}
func sha256(_ url: URL) throws -> String { SHA256.hash(data: try Data(contentsOf: url)).map { String(format: "%02x", $0) }.joined() }
let sourceImages: [[String: Any]] = try images.keys.sorted().map { ["file": $0, "sha256": try sha256(path($0))] }
let narration: [[String: Any]] = try audioAssets.map { ["file": $0.0.file, "start": $0.0.start, "duration": $0.2, "sha256": try sha256(path($0.0.file))] }
var actualMedia: [String: Any] = [:]
if mode == "render" {
    let final = output.appendingPathComponent("Orchestra-film.mp4"), asset = AVURLAsset(url: final)
    guard let video = asset.tracks(withMediaType: .video).first else { throw FilmError.invalid("Final film has no video track") }
    let seconds = CMTimeGetSeconds(asset.duration)
    try require(abs(seconds - plan.duration) < 0.08 && video.naturalSize == NSSize(width: width, height: height) && abs(video.nominalFrameRate - Float(fps)) < 0.01, "Final duration, dimensions or frame rate mismatch")
    actualMedia = ["duration": seconds, "width": video.naturalSize.width, "height": video.naturalSize.height, "fps": video.nominalFrameRate, "audioTracks": asset.tracks(withMediaType: .audio).count, "sha256": try sha256(final)]
}
let record: [String: Any] = ["duration": plan.duration, "width": width, "height": height, "fps": fps,
    "sceneCount": plan.scenes.count, "realAndBrandImages": images.count, "mode": mode,
    "timelineSHA256": try sha256(inputURL), "sourceImages": sourceImages, "actualMedia": actualMedia, "narration": narration,
    "disclosure": "Edited real app captures; any fictional project and synthetic narration disclosures belong with the published description. No latency or successful-action claim is created by this renderer."]
try JSONSerialization.data(withJSONObject: record, options: [.prettyPrinted, .sortedKeys]).write(to: output.appendingPathComponent("render-report.json"), options: .withoutOverwriting)
print("Review stills and timeline: \(output.path)")
