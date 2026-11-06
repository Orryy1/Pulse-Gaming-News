# Words and their boxes in a picture, from the OCR engine built into Windows 10 and 11 (Windows.Media.Ocr):
# local, free and nothing to install. Called by src/assets/ocr.ts with a JSON list of image paths; prints one
# JSON object: { "results": [ { "file": ..., "width": w, "height": h, "words": [ { "text", "x", "y", "w", "h" } ] } ] }
# in pixels of the picture. A picture the engine cannot read gets an empty word list.
param([Parameter(Mandatory = $true)][string]$ListFile)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
  })[0]
function Await($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
$files = Get-Content -Raw -LiteralPath $ListFile | ConvertFrom-Json
$out = @()
foreach ($f in $files) {
  $entry = @{ file = $f; width = 0; height = 0; words = @() }
  try {
    $sf = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync(($f -replace "/", "\"))) ([Windows.Storage.StorageFile])
    $stream = Await ($sf.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    $entry.width = $bitmap.PixelWidth
    $entry.height = $bitmap.PixelHeight
    if ($engine -and $bitmap.PixelWidth -le [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -and $bitmap.PixelHeight -le [Windows.Media.Ocr.OcrEngine]::MaxImageDimension) {
      $r = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
      foreach ($line in $r.Lines) {
        foreach ($w in $line.Words) {
          $b = $w.BoundingRect
          $entry.words += @{ text = $w.Text; x = $b.X; y = $b.Y; w = $b.Width; h = $b.Height }
        }
      }
    }
    $stream.Dispose()
  } catch {
    $entry.error = $_.Exception.Message
  }
  $out += $entry
}
@{ results = $out } | ConvertTo-Json -Depth 6 -Compress
