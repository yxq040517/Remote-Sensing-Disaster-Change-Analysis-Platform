function Get-StarwatchStatus {
    param([string]$Url='http://127.0.0.1:8765/api/status')
    $taskResponse = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    # Windows PowerShell 5.1 defaults to a legacy encoding for JSON without charset.
    $taskBody = [Text.Encoding]::UTF8.GetString($taskResponse.RawContentStream.ToArray())
    return ($taskBody | ConvertFrom-Json)
}
