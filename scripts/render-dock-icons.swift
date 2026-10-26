// Renders the Dock status icons (app icon + status dot) from src-tauri/icons/openn.icon.
// Run from the repository root after changing the app icon: swift scripts/render-dock-icons.swift
import AppKit

let ictool = "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"
let outDir = "src-tauri/icons/dock"
let canvas: CGFloat = 1024
// macOS icon grid: an 824pt tile centred on a 1024pt canvas.
let tile: CGFloat = 824
let output = 512

// Same colours as the tray status dot in src-tauri/src/core/tray/status_icon.rs; `plain` has no dot.
let dots: [String: NSColor?] = [
    "plain": nil,
    "green": NSColor(srgbRed: 52 / 255, green: 199 / 255, blue: 89 / 255, alpha: 1),
    "red": NSColor(srgbRed: 255 / 255, green: 59 / 255, blue: 48 / 255, alpha: 1),
]

let tilePath = NSTemporaryDirectory() + "openn-tile.png"
let task = Process()
task.executableURL = URL(fileURLWithPath: ictool)
task.arguments = [
    "src-tauri/icons/openn.icon", "--export-image", "--output-file", tilePath, "--platform", "macOS",
    "--rendition", "Default", "--width", "\(Int(tile))", "--height", "\(Int(tile))", "--scale", "1",
]
task.standardOutput = FileHandle.nullDevice
try! task.run()
task.waitUntilExit()
let tileImage = NSImage(contentsOfFile: tilePath)!

try! FileManager.default.createDirectory(atPath: outDir, withIntermediateDirectories: true)
for (dotName, dotColor) in dots {
    let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil, pixelsWide: output, pixelsHigh: output, bitsPerSample: 8,
        samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
        bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: canvas, height: canvas)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    let inset = (canvas - tile) / 2
    let shadow = NSShadow()
    shadow.shadowOffset = NSSize(width: 0, height: -10)
    shadow.shadowBlurRadius = 20
    shadow.shadowColor = NSColor(white: 0, alpha: 0.3)
    NSGraphicsContext.saveGraphicsState()
    shadow.set()
    tileImage.draw(in: NSRect(x: inset, y: inset, width: tile, height: tile))
    NSGraphicsContext.restoreGraphicsState()

    if let dotColor {
        // Bottom-right of the tile, ringed in the tile colour so it reads as cut out of the logo.
        let radius: CGFloat = 75
        let ring: CGFloat = 43
        let center = NSPoint(x: inset + tile - 201, y: inset + 185)
        NSColor.white.setFill()
        NSBezierPath(ovalIn: NSRect(
            x: center.x - radius - ring, y: center.y - radius - ring,
            width: (radius + ring) * 2, height: (radius + ring) * 2)).fill()
        dotColor.setFill()
        NSBezierPath(ovalIn: NSRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
            .fill()
    }

    NSGraphicsContext.restoreGraphicsState()
    let png = rep.representation(using: .png, properties: [:])!
    try! png.write(to: URL(fileURLWithPath: "\(outDir)/\(dotName).png"))
}
