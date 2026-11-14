Add-Type -AssemblyName System.Drawing
$root = Join-Path $PSScriptRoot '.'
$Supplement = $args -contains '--supplement'
$dataFile = if ($Supplement) { 'responsive-supplement.json' } else { 'responsive.json' }
$prefix = if ($Supplement) { 'supplement-' } else { '' }
$rows = Get-Content -Raw (Join-Path $root $dataFile) | ConvertFrom-Json
$groups = $rows | Where-Object { $_.file } | Group-Object { "$($_.w)x$($_.h)" }
$html = [System.Text.StringBuilder]::new()
[void]$html.Append('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Pulso TV — capturas</title><style>body{background:#08121f;color:#f5f8fc;font:16px Arial;margin:24px}a{color:#45e0cf}section{margin-bottom:40px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px}img{max-width:100%;max-height:360px;object-fit:contain}figure{margin:0;padding:12px;background:#111e30}figcaption{margin:8px}</style><h1>Pulso TV — auditoria visual</h1><p>Fixtures isoladas; reprodução bloqueada. Capturas não homologam operação comercial.</p>')
foreach ($group in $groups) {
  $canvas = [System.Drawing.Bitmap]::new(1280,750)
  $graphics = [System.Drawing.Graphics]::FromImage($canvas)
  $graphics.Clear([System.Drawing.Color]::FromArgb(8,18,31))
  $font = [System.Drawing.Font]::new('Arial',12)
  $i = 0
  [void]$html.Append("<section><h2>$($group.Name)</h2><a href='${prefix}contact-$($group.Name).jpg'>Folha de contato</a><div class='grid'>")
  foreach ($row in $group.Group) {
    $img = [System.Drawing.Image]::FromFile((Join-Path $root $row.file))
    $scale = [Math]::Min(304 / $img.Width, 214 / $img.Height)
    $w = [int]($img.Width * $scale)
    $h = [int]($img.Height * $scale)
    $x = ($i % 4) * 320
    $y = [int][Math]::Floor($i / 4) * 250
    $graphics.DrawImage($img,[int]($x+(320-$w)/2),[int]($y+8),$w,$h)
    $graphics.DrawString($row.state,$font,[System.Drawing.Brushes]::White,[single]($x+8),[single]($y+225))
    $img.Dispose()
    [void]$html.Append("<figure><a href='$($row.file)'><img loading='lazy' src='$($row.file)' alt='$($row.state) em $($group.Name)'></a><figcaption>$($row.state)</figcaption></figure>")
    $i++
  }
  $canvas.Save((Join-Path $root "${prefix}contact-$($group.Name).jpg"),[System.Drawing.Imaging.ImageFormat]::Jpeg)
  $font.Dispose(); $graphics.Dispose(); $canvas.Dispose()
  [void]$html.Append('</div></section>')
}
[void]$html.Append("<h2>Fim da rolagem em bloqueios</h2><div class='grid'>")
foreach ($file in (Get-ChildItem -LiteralPath $root -Filter '*-bottom.png')) {
  [void]$html.Append("<figure><a href='$($file.Name)'><img loading='lazy' src='$($file.Name)' alt='$($file.Name)'></a><figcaption>$($file.Name)</figcaption></figure>")
}
[void]$html.Append("</div><h2>Fallbacks</h2><a href='fallback-webp.png'>Falha WebP → JPEG</a> · <a href='fallback-all.png'>Falha de ambas → cor sólida</a>")
$galleryFile = if ($Supplement) { 'gallery-supplement.html' } else { 'gallery.html' }
[void]$html.Append("<p><a href='gallery.html'>Matriz principal</a> · <a href='gallery-supplement.html'>Casos complementares</a></p></html>")
[System.IO.File]::WriteAllText((Join-Path $root $galleryFile),$html.ToString(),[System.Text.UTF8Encoding]::new($false))
