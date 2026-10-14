# platform-sessions 端点探针（schema 3 验收）
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:8788'

$health = Invoke-RestMethod -Uri "$base/health" -Method Get
Write-Output "1. health schemaVersion=$($health.schemaVersion) supported=$($health.supportedSchemaVersions -join ',')"
if ($health.schemaVersion -ne 3) { throw 'schemaVersion is not 3' }

$regBody = @{ email = "probe-ps-$(Get-Random)@test.local"; password = 'probe-password-1' } | ConvertTo-Json
$reg = Invoke-RestMethod -Uri "$base/auth/register" -Method Post -ContentType 'application/json' -Body $regBody
$token = $reg.accessToken
$headers = @{ Authorization = "Bearer $token" }
Write-Output "2. registered, token acquired"

# PUT 正常写入
$putBody = @{ schemaVersion = 1; token = 'qqmusic_session=probe-token-abc'; updatedAt = '2026-10-14T00:00:00.000Z' } | ConvertTo-Json
$put = Invoke-RestMethod -Uri "$base/platform-sessions/qq" -Method Put -Headers $headers -ContentType 'application/json' -Body $putBody
Write-Output "3. PUT ok=$($put.ok)"

# GET 回读
$get = Invoke-RestMethod -Uri "$base/platform-sessions/qq" -Method Get -Headers $headers
Write-Output "4. GET token=$($get.token) updatedAt=$($get.updatedAt)"
if ($get.token -ne 'qqmusic_session=probe-token-abc') { throw 'token mismatch' }

# LWW：旧时间戳写入应 409
try {
  $staleBody = @{ schemaVersion = 1; token = 'old'; updatedAt = '2026-10-13T00:00:00.000Z' } | ConvertTo-Json
  Invoke-RestMethod -Uri "$base/platform-sessions/qq" -Method Put -Headers $headers -ContentType 'application/json' -Body $staleBody | Out-Null
  throw 'stale PUT should have failed'
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Output "5. stale PUT -> $status (expect 409)"
  if ($status -ne 409) { throw "expected 409 got $status" }
}

# 多余字段应 400
try {
  $extraBody = @{ schemaVersion = 1; token = 'x'; updatedAt = '2026-10-14T01:00:00.000Z'; cookie = 'MUSIC_U=leak' } | ConvertTo-Json
  Invoke-RestMethod -Uri "$base/platform-sessions/qq" -Method Put -Headers $headers -ContentType 'application/json' -Body $extraBody | Out-Null
  throw 'extra-field PUT should have failed'
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Output "6. extra-field PUT -> $status (expect 400)"
  if ($status -ne 400) { throw "expected 400 got $status" }
}

# 无鉴权应 401
try {
  Invoke-RestMethod -Uri "$base/platform-sessions/qq" -Method Get | Out-Null
  throw 'unauthenticated GET should have failed'
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Output "7. unauthenticated GET -> $status (expect 401)"
  if ($status -ne 401) { throw "expected 401 got $status" }
}

# 条件删除：错值 409
try {
  Invoke-RestMethod -Uri "$base/platform-sessions/qq`?ifUpdatedAt=wrong" -Method Delete -Headers $headers | Out-Null
  throw 'wrong ifUpdatedAt DELETE should have failed'
} catch {
  $status = $_.Exception.Response.StatusCode.value__
  Write-Output "8. DELETE wrong-ifUpdatedAt -> $status (expect 409)"
  if ($status -ne 409) { throw "expected 409 got $status" }
}

# 条件删除：对值成功
$del = Invoke-RestMethod -Uri "$base/platform-sessions/qq`?ifUpdatedAt=$($get.updatedAt)" -Method Delete -Headers $headers
Write-Output "9. DELETE ok=$($del.ok)"

# GET 应为 null
$empty = Invoke-RestMethod -Uri "$base/platform-sessions/qq" -Method Get -Headers $headers
Write-Output "10. GET after DELETE -> $empty (expect empty/null)"
if ($null -ne $empty -and $empty.token) { throw 'token still present after delete' }

Write-Output 'ALL PROBES PASSED'
