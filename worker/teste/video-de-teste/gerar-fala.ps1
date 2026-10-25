# (Salvo em UTF-8 COM BOM de propósito: sem ele o Windows PowerShell 5.1 lê o
# arquivo como ANSI, "não" vira "nÃ£o" e a voz lê o "£" como "libra".)
#
# Gera a fala do vídeo de teste com a voz pt-BR que já vem no Windows (Maria),
# sem baixar nada. Sai um WAV e um JSON com o instante de cada palavra — o
# gabarito pra conferir o que o whisper.cpp transcreveu e o que a fábrica cortou.
#
# O texto imita quem grava no celular: pausas longas, "é…", "tipo assim", e
# uma frase começada duas vezes. É o que o reel-de-bruto existe pra limpar.
#
#   powershell -File gerar-fala.ps1 -Saida <pasta>
param([Parameter(Mandatory = $true)][string]$Saida)

Add-Type -AssemblyName System.Speech
$voz = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voz.SelectVoice('Microsoft Maria Desktop')
$voz.Rate = 0

$ssml = @'
<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="pt-BR">
Oi, pessoal. Hoje eu quero falar sobre uma coisa que eu vejo toda semana no laboratório.
<break time="2500ms"/>
É, tipo assim, muita gente acha que precisa saber tudo antes de começar.
<break time="1800ms"/>
Mas não precisa. Mas não precisa mesmo.
<break time="2200ms"/>
O que funciona é começar pequeno. Escolhe um projeto, termina esse projeto, e mostra pra alguém.
<break time="2000ms"/>
Na turma nova do laboratório de redes a gente faz exatamente isso, toda sexta feira.
<break time="2600ms"/>
Cada pessoa sai com um projeto pronto, e não com uma lista de cursos pela metade.
<break time="1500ms"/>
É, então, se você quer entrar, as inscrições estão abertas até sexta.
<break time="2000ms"/>
O link está aqui no perfil. Te vejo lá.
</speak>
'@

New-Item -ItemType Directory -Force -Path $Saida | Out-Null
$wav = Join-Path $Saida 'fala.wav'
$palavras = New-Object System.Collections.ArrayList
$null = Register-ObjectEvent -InputObject $voz -EventName SpeakProgress -SourceIdentifier progresso
$voz.SetOutputToWaveFile($wav, (New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)))
$voz.SpeakSsml($ssml)
$voz.SetOutputToNull()
foreach ($e in Get-Event -SourceIdentifier progresso) {
  $a = $e.SourceEventArgs
  $null = $palavras.Add([ordered]@{ texto = $a.Text; inicio = $a.AudioPosition.TotalSeconds })
}
Unregister-Event -SourceIdentifier progresso
Get-Event | Remove-Event
$palavras | ConvertTo-Json -Depth 3 | Out-File -Encoding utf8 (Join-Path $Saida 'palavras.json')
Write-Output "fala: $wav ($($palavras.Count) palavras)"
