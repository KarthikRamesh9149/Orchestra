// Decode the actual shipped media; a filename/signature alone does not prove playback.
import Foundation
import AVFoundation
import ImageIO
guard CommandLine.arguments.count == 2 else {fatalError("Expected media directory")}
let base=URL(fileURLWithPath:CommandLine.arguments[1],isDirectory:true)
for (name,expected,width,height) in [("Orchestra-product-film.mp4",60.0,1920,1080),("orchestra-evidence-walkthrough.mp4",24.0,1440,1120)] {
    let asset=AVURLAsset(url:base.appendingPathComponent(name))
    let duration=try await asset.load(.duration).seconds
    guard abs(duration-expected)<0.05 else {fatalError("Unexpected duration: \(name)")}
    let tracks=try await asset.loadTracks(withMediaType:.video)
    guard tracks.count==1 else {fatalError("Expected one video track")}
    let size=try await tracks[0].load(.naturalSize)
    guard Int(size.width)==width,Int(size.height)==height else {fatalError("Unexpected dimensions")}
    let generator=AVAssetImageGenerator(asset:asset)
    generator.appliesPreferredTrackTransform=true
    for time in [0.1,expected*0.25,expected*0.5,expected*0.75,expected-0.5] {
        let result=try await generator.image(at:CMTime(seconds:time,preferredTimescale:600))
        guard result.image.width==width,result.image.height==height else {fatalError("Cannot decode frame")}
    }
    print("PASS \(name): \(duration)s, \(width)x\(height), 5 decoded frames")
}
for (name,count,duration) in [("orchestra-evidence-walkthrough.gif",4,24.0),("orchestra-preflight-walkthrough.gif",72,12.0)] {
    guard let source=CGImageSourceCreateWithURL(base.appendingPathComponent(name) as CFURL,nil),CGImageSourceGetCount(source)==count else {fatalError("Invalid GIF frame count")}
    var total=0.0
    for i in 0..<count {
        guard CGImageSourceCreateImageAtIndex(source,i,nil) != nil,
              let props=CGImageSourceCopyPropertiesAtIndex(source,i,nil) as? [String:Any],
              let gif=props[kCGImagePropertyGIFDictionary as String] as? [String:Any],
              let delay=gif[kCGImagePropertyGIFUnclampedDelayTime as String] as? Double ?? gif[kCGImagePropertyGIFDelayTime as String] as? Double else {fatalError("Cannot decode GIF frame")}
        total += delay
    }
    // GIF stores centiseconds, so a 6fps export accumulates rounding error.
    guard abs(total-duration)<0.5 else {fatalError("Unexpected GIF timing")}
    print("PASS \(name): \(count) decoded frames, \(total)s")
}
