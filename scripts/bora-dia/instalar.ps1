# Cria a tarefa "Bora - iniciar o dia" no Agendador de Tarefas do Windows.
# Gatilhos: ao entrar no Windows (2 min depois) e todo dia as 7h. Se o PC estiver
# desligado as 7h, roda assim que ligar. O script garante uma execucao por dia.
$ErrorActionPreference = 'Stop'
$nome   = 'Bora - iniciar o dia'
$script = Join-Path $PSScriptRoot 'iniciar-dia.ps1'
$usuario = "$env:USERDOMAIN\$env:USERNAME"

$acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$script`"" -WorkingDirectory $PSScriptRoot
$aoEntrar = New-ScheduledTaskTrigger -AtLogOn -User $usuario
$aoEntrar.Delay = 'PT2M'
$seteHoras = New-ScheduledTaskTrigger -Daily -At '07:00'
$config = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -ExecutionTimeLimit (New-TimeSpan -Hours 3) -MultipleInstances IgnoreNew
$quem = New-ScheduledTaskPrincipal -UserId $usuario -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger @($aoEntrar, $seteHoras) -Settings $config -Principal $quem `
  -Description 'Claude Code le docs/progresso, monta a pauta do dia e comeca a tarefa de codigo no branch dia/AAAA-MM-DD.' -Force | Out-Null

Write-Host "Tarefa '$nome' criada para $usuario."
Write-Host 'Ela roda ao entrar no Windows e as 7h (uma vez por dia util). Para testar agora: rodar-agora.bat'
