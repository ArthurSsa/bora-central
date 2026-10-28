# Bora — inicia o dia com o Claude Code.
# Roda uma vez por dia útil (ao ligar o PC ou às 7h, o que vier primeiro), monta a pauta
# em docs/progresso/hoje.md e começa a tarefa de código do dia num branch dia/AAAA-MM-DD.
param([switch]$Forcar)

# 'Continue': no Windows PowerShell 5.1, 'Stop' transforma qualquer linha que o git
# escreve no stderr em erro fatal. Os erros reais sao tratados com throw.
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
try { $Host.UI.RawUI.WindowTitle = 'Bora - iniciar o dia' } catch {}

$repo  = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$hoje  = Get-Date -Format 'yyyy-MM-dd'
$base  = Join-Path $env:LOCALAPPDATA 'bora-dia'
$logs  = Join-Path $base 'logs'
$marca = Join-Path $base 'ultimo-dia.txt'
$trava = Join-Path $base 'rodando.lock'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs "$hoje.log"

function Dizer([string]$texto) {
  $linha = '[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $texto
  Write-Host $linha
  Add-Content -Path $log -Value $linha -Encoding UTF8
}

# Linha de saida de um programa (o stderr chega como ErrorRecord no PowerShell)
function Texto($x) { if ($x -is [System.Management.Automation.ErrorRecord]) { $x.Exception.Message } else { "$x" } }

# 1. Uma vez por dia útil, sem duas execuções ao mesmo tempo
if (-not $Forcar) {
  if ((Test-Path $marca) -and ((Get-Content $marca -Raw).Trim() -eq $hoje)) { Dizer "O dia $hoje ja foi iniciado. Para rodar de novo, use rodar-agora.bat."; exit 0 }
  $dia = (Get-Date).DayOfWeek
  if ($dia -eq [DayOfWeek]::Saturday -or $dia -eq [DayOfWeek]::Sunday) { Dizer 'Fim de semana: nada a iniciar.'; exit 0 }
  $tarefas = Join-Path $repo 'docs/progresso/tarefas.json'
  if (Test-Path $tarefas) {
    $feriados = (Get-Content $tarefas -Raw -Encoding UTF8 | ConvertFrom-Json).feriados
    if ($feriados -and ($feriados.PSObject.Properties.Name -contains $hoje)) { Dizer ('Feriado: ' + $feriados.$hoje + '. Nada a iniciar.'); exit 0 }
  }
}
if (Test-Path $trava) {
  $idade = (Get-Date) - (Get-Item $trava).LastWriteTime
  if ($idade.TotalHours -lt 3) { Dizer 'Ja existe uma execucao em andamento.'; exit 0 }
}
Set-Content -Path $trava -Value $PID

$codigo = 1
try {
  Set-Location $repo
  if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    throw 'Nao achei o comando "claude". Instale o Claude Code e faca login uma vez abrindo "claude" no terminal.'
  }
  if (-not (Test-Path (Join-Path $repo 'docs/progresso/LEIA-ME.md'))) {
    throw 'Nao achei docs/progresso no repositorio. Descompacte o pacote de progresso na raiz do bora-central.'
  }

  # 2. Esperar a internet (ate 3 min), porque o PC acabou de ligar
  $online = $false
  for ($i = 0; $i -lt 18; $i++) {
    try { [void][System.Net.Dns]::GetHostEntry('api.anthropic.com'); $online = $true; break } catch { Start-Sleep -Seconds 10 }
  }
  if (-not $online) { throw 'Sem internet depois de 3 minutos.' }

  # 3. Atualizar o repositorio so quando for seguro
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  $pendente = [bool](git status --porcelain)
  if (-not $pendente -and $branch -eq 'main') {
    Dizer 'Atualizando a main...'
    git pull --ff-only 2>&1 | ForEach-Object { Dizer (Texto $_) }
  }
  if ($pendente) { $arvore = 'com mudancas nao salvas' } else { $arvore = 'limpa' }
  $situacao = "Hoje e $hoje. Branch atual: $branch. Arvore de trabalho: $arvore."

  # 4. Claude Code sem ninguem olhando: so as ferramentas necessarias
  $permitidas = @(
    'Read', 'Edit', 'Write', 'Glob', 'Grep', 'TodoWrite',
    'Bash(git status:*)', 'Bash(git diff:*)', 'Bash(git log:*)', 'Bash(git show:*)', 'Bash(git branch:*)',
    'Bash(git switch:*)', 'Bash(git checkout -b:*)', 'Bash(git add:*)', 'Bash(git commit:*)', 'Bash(git rev-parse:*)',
    'Bash(npm test:*)', 'Bash(npm run test:*)', 'Bash(npm run build:*)', 'Bash(npm run lint:*)', 'Bash(npm run typecheck:*)',
    'Bash(npm run custos:*)', 'Bash(npx vitest:*)', 'Bash(npx tsc:*)', 'Bash(npx playwright test:*)',
    'Bash(ls:*)', 'Bash(mkdir:*)', 'Bash(date:*)'
  )
  $proibidas = @(
    'Bash(git push:*)', 'Bash(git merge:*)', 'Bash(git rebase:*)', 'Bash(git reset:*)', 'Bash(git branch -D:*)',
    'Bash(npm run fabrica:*)', 'Bash(rm:*)', 'Bash(curl:*)', 'Edit(**/.env*)', 'Write(**/.env*)'
  )
  $pedido = "Siga as instrucoes de scripts/bora-dia/prompt-do-dia.md. $situacao"

  Dizer 'Claude Code montando a pauta do dia e comecando a tarefa de codigo...'
  & claude -p $pedido --permission-mode acceptEdits --allowedTools $permitidas --disallowedTools $proibidas --max-turns 80 2>&1 |
    ForEach-Object { $l = Texto $_; Write-Host $l; Add-Content -Path $log -Value $l -Encoding UTF8 }
  $codigo = $LASTEXITCODE

  if ($codigo -eq 0) {
    Set-Content -Path $marca -Value $hoje
    Dizer 'Pronto. Abrindo a pauta de hoje.'
    $pauta = Join-Path $repo 'docs/progresso/hoje.md'
    if (Test-Path $pauta) { Start-Process $pauta }
  } else {
    Dizer "O Claude Code terminou com erro ($codigo). Vai tentar de novo no proximo gatilho. Registro: $log"
  }
} catch {
  Dizer ('Erro: ' + $_.Exception.Message)
} finally {
  Remove-Item -Path $trava -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 15
exit $codigo
