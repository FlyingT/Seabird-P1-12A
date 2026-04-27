# Simple HTTP Server for BLE Explorer
# Start with: powershell -ExecutionPolicy Bypass -File serve.ps1
# Then open: http://localhost:8080

$port = 8080
$root = $PSScriptRoot

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "  BLE Explorer Server gestartet!" -ForegroundColor Green
Write-Host "  Oeffne im Browser: http://localhost:$port" -ForegroundColor Cyan
Write-Host "  Stoppen mit: Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

$mimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.woff2'= 'font/woff2'
}

try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $localPath = $request.Url.LocalPath
    if ($localPath -eq '/') { $localPath = '/index.html' }

    $filePath = Join-Path $root ($localPath.TrimStart('/').Replace('/', '\'))

    if (Test-Path $filePath -PathType Leaf) {
      $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
      $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { 'application/octet-stream' }

      $response.ContentType = $contentType
      $response.StatusCode = 200

      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $response.ContentLength64 = $bytes.Length
      $response.OutputStream.Write($bytes, 0, $bytes.Length)

      Write-Host "  200  $localPath" -ForegroundColor DarkGreen
    } else {
      $response.StatusCode = 404
      $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
      $response.ContentLength64 = $msg.Length
      $response.OutputStream.Write($msg, 0, $msg.Length)

      Write-Host "  404  $localPath" -ForegroundColor DarkRed
    }

    $response.Close()
  }
} finally {
  $listener.Stop()
  Write-Host "Server gestoppt." -ForegroundColor Yellow
}
