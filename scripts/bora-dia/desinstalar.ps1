$nome = 'Bora - iniciar o dia'
if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $nome -Confirm:$false
  Write-Host "Tarefa '$nome' removida."
} else {
  Write-Host "A tarefa '$nome' nao existe."
}
