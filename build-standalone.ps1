# Bundles index.html + js/*.js into one self-contained HTML file (three.js still loads from the jsDelivr CDN).
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
$html = [System.IO.File]::ReadAllText((Join-Path $root 'index.html'), $utf8)

$modules = New-Object System.Text.StringBuilder
foreach ($f in Get-ChildItem (Join-Path $root 'js') -Filter *.js | Sort-Object Name) {
  $code = [System.IO.File]::ReadAllText($f.FullName, $utf8)
  [void]$modules.AppendLine("<script type=`"text/x-module`" data-name=`"$($f.Name)`">")
  [void]$modules.AppendLine($code)
  [void]$modules.AppendLine('</script>')
}

$loader = @'
<script>
// Turns the inlined modules into blob: URLs, rewriting their relative imports, then starts main.js.
(() => {
  const src = {};
  document.querySelectorAll('script[type="text/x-module"]').forEach((s) => { src[s.dataset.name] = s.textContent; });
  const urls = {};
  const get = (name) => {
    if (urls[name]) return urls[name];
    const code = src[name].replace(/(from\s*|import\s*\(\s*)'\.\/([\w-]+\.js)'/g, (m, pre, dep) => pre + "'" + get(dep) + "'");
    return (urls[name] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' })));
  };
  const s = document.createElement('script');
  s.type = 'module';
  s.src = get('main.js');
  document.body.appendChild(s);
})();
</script>
'@

$html = $html.Replace('<script type="module" src="js/main.js"></script>', $modules.ToString() + $loader)
# Keep photographic maps available when the standalone file is opened directly.
$textures = @{}
foreach ($f in Get-ChildItem (Join-Path $root 'assets/textures') -Filter *.jpg | Sort-Object Name) {
  $textures[$f.Name] = 'data:image/jpeg;base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($f.FullName))
}
$textureScript = '<script type="application/json" id="ocean-textures">' + (ConvertTo-Json -InputObject $textures -Compress) + '</script>'
$html = $html.Replace('<script type="importmap">', $textureScript + "`n<script type=`"importmap`">")
$head = "<!doctype html>`n<html lang=`"en`">`n<head>`n<meta charset=`"utf-8`">`n<meta name=`"viewport`" content=`"width=device-width, initial-scale=1, viewport-fit=cover`">`n"
$out = $head + $html + "`n</html>`n"
$dest = Join-Path $root 'ocean-descent.html'
[System.IO.File]::WriteAllText($dest, $out, $utf8)
"Wrote $dest ($([math]::Round((Get-Item $dest).Length / 1KB)) KB)"
