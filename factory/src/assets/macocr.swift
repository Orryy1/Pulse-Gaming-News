// Words and their boxes in a picture, from the text recogniser built into macOS (Apple's Vision framework):
// the Mac's twin of winocr.ps1, local, free and nothing to install beyond the Command Line Tools that
// compile it (src/assets/ocr.ts builds it once into ~/PulseFactory/bin/pulse-ocr). Called with a JSON list
// of image paths; prints one JSON object in the same shape as the Windows engine:
// { "results": [ { "file": ..., "width": w, "height": h, "words": [ { "text", "x", "y", "w", "h" } ] } ] }
// in pixels of the picture, top-left origin. A picture it cannot read gets an empty word list and an error.
import Foundation
import Vision
import ImageIO

struct Word: Codable { let text: String; let x: Double; let y: Double; let w: Double; let h: Double }
struct Page: Codable { let file: String; var width: Int; var height: Int; var words: [Word]; var error: String? }
struct Out: Codable { let results: [Page] }

func read(_ file: String) -> Page {
  var page = Page(file: file, width: 0, height: 0, words: [], error: nil)
  guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil),
        let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    page.error = "cannot open image"
    return page
  }
  let W = Double(img.width), H = Double(img.height)
  page.width = img.width
  page.height = img.height
  let req = VNRecognizeTextRequest()
  req.recognitionLevel = .accurate
  req.usesLanguageCorrection = false
  do {
    try VNImageRequestHandler(cgImage: img, options: [:]).perform([req])
  } catch {
    page.error = error.localizedDescription
    return page
  }
  for obs in req.results ?? [] {
    guard let cand = obs.topCandidates(1).first else { continue }
    let line = cand.string
    // One box a word, as the Windows engine gives: each run of non-space characters in the line.
    var i = line.startIndex
    while i < line.endIndex {
      while i < line.endIndex && line[i].isWhitespace { i = line.index(after: i) }
      var j = i
      while j < line.endIndex && !line[j].isWhitespace { j = line.index(after: j) }
      if i < j, let box = try? cand.boundingBox(for: i..<j)?.boundingBox {
        // Vision's boxes are 0-1 with the origin bottom-left.
        page.words.append(Word(text: String(line[i..<j]), x: box.minX * W, y: (1 - box.maxY) * H,
                               w: box.width * W, h: box.height * H))
      }
      i = j
    }
  }
  return page
}

let args = CommandLine.arguments
guard args.count > 1, let data = FileManager.default.contents(atPath: args[1]),
      let files = try? JSONDecoder().decode([String].self, from: data) else {
  FileHandle.standardError.write("usage: pulse-ocr <list.json>\n".data(using: .utf8)!)
  exit(2)
}
let out = Out(results: files.map(read))
FileHandle.standardOutput.write(try! JSONEncoder().encode(out))
